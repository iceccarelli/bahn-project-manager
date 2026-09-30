/**
 * Full data plane, real components, no mocks between them:
 *   ProjectService → MariaDB (tx + outbox) → OutboxRelay → bus → SSE gateway
 *   → RealtimeConnection (fetch) → ProjectSyncEngine
 *
 * The four scenarios from the brief:
 *   A changes → B sees it without reload
 *   A and B edit simultaneously → one wins, the other gets a conflict
 *   B disconnects, A changes, B reconnects → B receives the missed state
 *   (fan-out at 10k connections is scripts/load/realtime-fanout.mjs)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { hasTestDb, createTestDatabase } from "../testing/testDb";
import { MysqlProjectStore } from "../infra/mysqlProjectStore";
import { MysqlOutbox } from "../infra/mysqlOutbox";
import { ProjectService } from "../domain/projectService";
import { ConflictError } from "../domain/errors";
import { InProcessBus } from "./hub";
import { OutboxRelay } from "./relay";
import { registerRealtimeGateway } from "./gateway";
import { admin, markus, lena, mitteOnly, ctx } from "../domain/testFixtures";
import type { Principal } from "../domain/permissions";
import { ProjectSyncEngine } from "../../client/src/realtime/projectSyncEngine";
import { RealtimeConnection } from "../../client/src/realtime/connection";
import type { DomainEvent } from "@shared/domain-events";

const users: Record<string, Principal> = Object.fromEntries([admin, markus, lena, mitteOnly].map(p => [p.id, p]));
const key = () => `e2e-${randomUUID()}`;
const until = async (fn: () => boolean, ms = 3000, what = "condition") => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise(r => setTimeout(r, 5));
  }
  return Date.now() - t0;
};

describe.skipIf(!hasTestDb)("realtime data plane (real DB, real HTTP/SSE)", () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let server: Server, url: string;
  let svc: ProjectService, store: MysqlProjectStore, relay: OutboxRelay, bus: InProcessBus;
  const cleanup: Array<() => void> = [];

  beforeAll(async () => {
    t = await createTestDatabase(20);
    store = new MysqlProjectStore(t.db as never);
    bus = new InProcessBus();
    relay = new OutboxRelay(new MysqlOutbox(t.pool), bus, { pollMs: 50 });
    svc = new ProjectService(store, relay.nudge);
    relay.start();
    const app = express();
    registerRealtimeGateway(app, {
      subscriber: bus, store, heartbeatMs: 200,
      resolve: async req => {
        const p = users[String(req.headers["x-test-user"])];
        return p ? { principal: p } : null;
      },
    });
    await new Promise<void>(r => (server = app.listen(0, "127.0.0.1", r)));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/realtime/stream`;
  });
  afterAll(async () => {
    cleanup.forEach(c => c());
    await relay.stop();
    server.closeAllConnections();
    await new Promise(r => server.close(r));
    await t.drop();
  });

  const mk = async (fields = {}) =>
    (await svc.create(admin, { fields: { station: "Köln Hbf", projektstand: "EP", bahnhofsmanagement: "Frankfurt", ...fields }, idempotencyKey: key() }, ctx())).project;

  /** a simulated browser: engine + connection, authenticated as `who` */
  function client(who: Principal, scopes: string[], seedIds: number[] = []) {
    const received: DomainEvent[] = [];
    const engine = new ProjectSyncEngine({ sync: async known => svc.sync(who, known) });
    const conn = new RealtimeConnection({
      url, heartbeatMs: 200, backoff: { baseMs: 20, maxMs: 100 },
      getHeaders: () => ({ "x-test-user": who.id }),
      onEvent: e => { received.push(e); engine.applyEvent(e); },
      onReconnect: () => engine.resync(),
    });
    conn.setScopes(scopes);
    cleanup.push(() => conn.stop());
    return { engine, conn, received, seed: async () => { for (const id of seedIds) engine.seed((await store.detail(id))!); } };
  }
  const connected = (c: { conn: RealtimeConnection }) => until(() => c.conn.getStatus().state === "connected", 3000, "connected");

  it("A changes a project → B sees it without reload, well under the 500 ms target (single node, local)", async () => {
    const p = await mk();
    const B = client(markus, [`project:${p.id}`], [p.id]);
    await B.seed();
    B.conn.start();
    await connected(B);

    const t0 = performance.now();
    await svc.update(lena, { id: p.id, expectedVersion: 1, changes: { projektstand: "AP" }, idempotencyKey: key() }, ctx());
    await until(() => B.engine.get(p.id)!.projektstand === "AP", 2000, "B to see AP");
    const ms = performance.now() - t0;
    console.info(`[measure] commit→remote engine state: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(500);
    expect(B.engine.get(p.id)).toMatchObject({ version: 2, projektstand: "AP" });
    expect(B.engine.recentChanges(p.id)[0]).toMatchObject({ field: "projektstand", from: "EP", to: "AP", actorName: "Lena" });
    // the event arrived once and was processed by the outbox exactly once
    expect(B.received.filter(e => e.aggregateVersion === 2)).toHaveLength(1);
    const [[row]] = (await t.pool.query("SELECT processedAt FROM domain_events WHERE aggregateId=? AND aggregateVersion=2", [p.id])) as any;
    expect(row.processedAt).not.toBeNull();
  });

  it("A and B edit the same project simultaneously → exactly one succeeds, the other gets a conflict; both UIs converge", async () => {
    const p = await mk();
    const A = client(markus, [`project:${p.id}`], [p.id]);
    const B = client(lena, [`project:${p.id}`], [p.id]);
    await A.seed(); await B.seed();
    A.conn.start(); B.conn.start();
    await Promise.all([connected(A), connected(B)]);

    A.engine.optimistic(p.id, "mA", { projektstand: "AP" });
    B.engine.optimistic(p.id, "mB", { projektstand: "FA" });
    const settle = (who: Principal, e: ProjectSyncEngine, mid: string, v: string) =>
      svc.update(who, { id: p.id, expectedVersion: 1, changes: { projektstand: v }, idempotencyKey: key() }, ctx()).then(
        r => { e.confirm(p.id, mid, r.project); return "ok" as const; },
        err => { if (err instanceof ConflictError) { e.rollback(p.id, mid, err.info); return err; } throw err; },
      );
    const [ra, rb] = await Promise.all([settle(markus, A.engine, "mA", "AP"), settle(lena, B.engine, "mB", "FA")]);
    expect([ra, rb].filter(r => r === "ok")).toHaveLength(1);
    const loser = [ra, rb].find(r => r !== "ok") as ConflictError;
    expect(loser.info).toMatchObject({ expectedVersion: 1, currentVersion: 2, conflictingFields: ["projektstand"] });

    const truth = (await store.detail(p.id))!;
    await until(() => A.engine.get(p.id)!.version === 2 && B.engine.get(p.id)!.version === 2, 2000, "convergence");
    expect(A.engine.get(p.id)!.projektstand).toBe(truth.projektstand);
    expect(B.engine.get(p.id)!.projektstand).toBe(truth.projektstand);
    expect(A.engine.pendingCount() + B.engine.pendingCount()).toBe(0);
  });

  it("B disconnects, A changes 3×, B reconnects → B is resynchronized to the server state", async () => {
    const p = await mk();
    const B = client(markus, [`project:${p.id}`], [p.id]);
    await B.seed();
    const states: string[] = [];
    B.conn.subscribe(s => states.push(s.state));
    B.conn.start();
    await connected(B);

    // network interruption for B (its stream is aborted; backoff timers keep it retrying)
    B.conn.stop();
    let v = 1;
    for (const c of ["one", "two", "three"]) {
      v = (await svc.update(lena, { id: p.id, expectedVersion: v, changes: { kommentar: c }, idempotencyKey: key() }, ctx())).project.version;
    }
    expect(B.engine.get(p.id)!.version).toBe(1); // nothing arrived while offline

    B.conn.start();
    await until(() => B.conn.getStatus().state === "connected" && B.conn.getStatus().lastSyncedChanges !== null, 3000, "resync");
    expect(B.engine.get(p.id)).toMatchObject({ version: 4, kommentar: "three" });
    expect(B.conn.getStatus().lastSyncedChanges).toBe(1); // "Wiederverbunden · 1 Änderung synchronisiert"
    expect(states).toContain("resynchronizing");
    // the UI never said "connected" between reconnecting and finishing resync
    const i = states.lastIndexOf("resynchronizing");
    expect(states.slice(states.lastIndexOf("reconnecting"), i)).not.toContain("connected");
  });

  it("lost live event (gap) is detected and repaired through the sync endpoint", async () => {
    const p = await mk();
    const B = client(markus, [`project:${p.id}`], [p.id]);
    await B.seed();
    B.conn.start(); await connected(B);
    const dropped: string[] = [];
    // simulate a transport that loses exactly version 3
    const realApply = B.engine.applyEvent.bind(B.engine);
    B.engine.applyEvent = e => { if (e.aggregateVersion === 3) { dropped.push(e.eventId); return "ignored"; } return realApply(e); };
    let v = 1;
    for (const c of ["a", "b", "c"]) v = (await svc.update(lena, { id: p.id, expectedVersion: v, changes: { kommentar: c }, idempotencyKey: key() }, ctx())).project.version;
    await until(() => B.engine.get(p.id)!.version === 4, 3000, "gap repair");
    expect(dropped).toHaveLength(1);
    expect(B.engine.get(p.id)!.kommentar).toBe("c");
    expect(B.engine.metrics.gaps).toBe(1);
  });

  it("isolation: unauthenticated → 401, wildcard/invalid → 400, out-of-workspace project → denied, other scopes never delivered", async () => {
    const ffm = await mk({ bahnhofsmanagement: "Frankfurt" });
    const kas = await mk({ bahnhofsmanagement: "Kassel" });

    expect((await fetch(`${url}?scopes=project:${ffm.id}`)).status).toBe(401);
    for (const bad of ["*", "project:*", "", "workspace:frankfurt,;drop"]) {
      expect((await fetch(`${url}?scopes=${encodeURIComponent(bad)}`, { headers: { "x-test-user": "1" } })).status).toBe(400);
    }
    // Mia may only see Frankfurt: Kassel project scope is denied → nothing authorized → 403
    const res = await fetch(`${url}?scopes=project:${kas.id}`, { headers: { "x-test-user": mitteOnly.id } });
    expect(res.status).toBe(403);
    expect((await res.json()).denied).toEqual([`project:${kas.id}`]);
    // …and mixed requests subscribe only the allowed part
    const ac = new AbortController();
    const mixed = await fetch(`${url}?scopes=project:${ffm.id},project:${kas.id}`, { headers: { "x-test-user": mitteOnly.id }, signal: ac.signal });
    const reader = mixed.body!.pipeThrough(new TextDecoderStream()).getReader();
    let text = "";
    while (!text.includes("hello")) text += (await reader.read()).value ?? "";
    ac.abort();
    expect(text).toContain(`"denied":["project:${kas.id}"]`);
    expect(text).toContain(`"scopes":["project:${ffm.id}"]`);

    // Mia listening on Frankfurt never receives a Kassel event
    const M = client(mitteOnly, [`workspace:frankfurt`]);
    M.conn.start(); await connected(M);
    await svc.update(admin, { id: kas.id, expectedVersion: 1, changes: { kommentar: "secret" }, idempotencyKey: key() }, ctx());
    await svc.update(admin, { id: ffm.id, expectedVersion: 1, changes: { kommentar: "visible" }, idempotencyKey: key() }, ctx());
    await until(() => M.received.length >= 1, 2000, "frankfurt event");
    await new Promise(r => setTimeout(r, 150));
    expect(M.received.map(e => e.aggregateId)).toEqual([String(ffm.id)]);
  });

  it("outbox relay: publish failure → retried in order, nothing lost, nothing marked processed early", async () => {
    const p = await mk();
    const sent: number[] = [];
    let failOnce = true;
    const flaky = { publish: async (e: DomainEvent) => { if (failOnce && e.aggregateVersion === 3) { failOnce = false; throw new Error("bus down"); } sent.push(e.aggregateVersion); } };
    await relay.stop();                       // take the shared relay out of the way
    await t.pool.query("UPDATE domain_events SET processedAt = NOW(3) WHERE processedAt IS NULL"); // start clean
    let v = 1;
    for (const c of ["x", "y", "z"]) v = (await svc.update(lena, { id: p.id, expectedVersion: v, changes: { kommentar: c }, idempotencyKey: key() }, ctx())).project.version;

    const r = new OutboxRelay(new MysqlOutbox(t.pool), flaky, { pollMs: 10, maxBackoffMs: 50 });
    r.start();
    await until(() => sent.length >= 3, 3000, "3 published");
    await r.stop();
    expect(sent).toEqual([2, 3, 4]);           // v2 once, v3 retried after failure, v4 after v3
    const [[{ n }]] = (await t.pool.query("SELECT COUNT(*) n FROM domain_events WHERE processedAt IS NULL")) as any;
    expect(Number(n)).toBe(0);
    relay.start();
  });

  it("a poison (schema-invalid) outbox row is dead-lettered and does NOT block later events", async () => {
    await relay.stop();
    await t.pool.query("UPDATE domain_events SET processedAt = NOW(3) WHERE processedAt IS NULL");
    const p = await mk();
    await t.pool.query(
      "INSERT INTO domain_events (eventId,eventType,aggregateType,aggregateId,aggregateVersion,envelope,createdAt) VALUES (?, 'x','project',?,50,'{}',NOW(3))",
      [randomUUID(), p.id],
    );
    await svc.update(lena, { id: p.id, expectedVersion: 1, changes: { kommentar: "after poison" }, idempotencyKey: key() }, ctx());
    const sent: number[] = [];
    const r = new OutboxRelay(new MysqlOutbox(t.pool), { publish: async e => { sent.push(e.aggregateVersion); } }, { pollMs: 10 });
    r.start();
    await until(() => sent.length >= 2, 3000, "creation + update published");
    await r.stop();
    expect(sent).toEqual([1, 2]);
    const [[bad]] = (await t.pool.query("SELECT failedAt, failureReason, processedAt FROM domain_events WHERE aggregateVersion=50 AND aggregateId=?", [p.id])) as any;
    expect(bad.failedAt).not.toBeNull();
    expect(bad.processedAt).not.toBeNull();
    expect(bad.failureReason).toContain("schemaVersion");
    relay.start();
  });

  it("two relays on one outbox never publish the same event twice (cluster-wide lock)", async () => {
    await relay.stop();
    await t.pool.query("UPDATE domain_events SET processedAt = NOW(3) WHERE processedAt IS NULL");
    const ids = await Promise.all(Array.from({ length: 30 }, () => mk()));
    const count = new Map<string, number>();
    const pub = { publish: async (e: DomainEvent) => { count.set(e.eventId, (count.get(e.eventId) ?? 0) + 1); await new Promise(r => setTimeout(r, 1)); } };
    const outbox = new MysqlOutbox(t.pool);
    const r1 = new OutboxRelay(outbox, pub, { pollMs: 5, batch: 7 }), r2 = new OutboxRelay(outbox, pub, { pollMs: 5, batch: 7 });
    r1.start(); r2.start();
    await until(() => count.size >= ids.length, 5000, "all published");
    await new Promise(r => setTimeout(r, 100));
    await r1.stop(); await r2.stop();
    expect(count.size).toBe(30);
    expect([...count.values()].every(n => n === 1)).toBe(true);
    relay.start();
  });
});
