/**
 * The Project slice against a REAL database (MariaDB/MySQL).
 * Skipped without TEST_DATABASE_URL — see server/testing/testDb.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { hasTestDb, createTestDatabase } from "../testing/testDb";
import { MysqlProjectStore } from "../infra/mysqlProjectStore";
import { ProjectService } from "./projectService";
import { ConflictError, ForbiddenError, IdempotencyKeyReuseError, NotFoundError, ValidationError } from "./errors";
import { admin, markus, lena, viewer, mitteOnly, ctx } from "./testFixtures";
import type { ConflictInfo } from "@shared/project-contract";

const key = () => `k-${randomUUID()}`;

describe.skipIf(!hasTestDb)("ProjectService (real DB)", () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let store: MysqlProjectStore;
  let svc: ProjectService;
  let nudges = 0;

  beforeAll(async () => {
    t = await createTestDatabase(20);
    store = new MysqlProjectStore(t.db as never);
    svc = new ProjectService(store, () => { nudges++; });
  });
  afterAll(async () => { await t?.drop(); });

  const count = async (table: string, where = "1=1") => {
    const [rows] = await t.pool.query(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`);
    return Number((rows as { n: number }[])[0]!.n);
  };
  const mk = (fields = {}) =>
    svc.create(admin, { fields: { station: "Köln Hbf", projektstand: "AP", bahnhofsmanagement: "Frankfurt", ...fields }, idempotencyKey: key() }, ctx());

  it("create → version 1, audit row, outbox event, all committed together", async () => {
    const before = { a: await count("audit_log"), e: await count("domain_events") };
    const { project, eventId } = await mk();
    expect(project.version).toBe(1);
    expect(project.projektstand).toBe("AP");
    expect(await count("domain_events", `eventId='${eventId}' AND processedAt IS NULL`)).toBe(1);
    expect(await count("audit_log")).toBeGreaterThan(before.a);
    expect(await count("audit_log", `eventId='${eventId}' AND traceId='trace-test-0001'`)).toBeGreaterThan(0);
    expect(await count("domain_events")).toBe(before.e + 1);
    expect(nudges).toBeGreaterThan(0);
  });

  it("update with the right expectedVersion: increments atomically, records old→new", async () => {
    const { project } = await mk();
    const res = await svc.update(markus, { id: project.id, expectedVersion: 1, changes: { projektstand: "EP" }, idempotencyKey: key() }, ctx());
    expect(res.project.version).toBe(2);
    expect(res.project.projektstand).toBe("EP");
    const ev = await store.eventsSince(project.id, 1, 10);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ aggregateVersion: 2, actorId: "2", eventType: "project.updated", changes: { projektstand: { from: "AP", to: "EP" } } });
    expect(await count("audit_log", `entityId=${project.id} AND field='projektstand' AND oldValue='AP' AND newValue='EP' AND aggregateVersion=2`)).toBe(1);
  });

  it("stale expectedVersion → structured conflict, nothing written", async () => {
    const { project } = await mk();
    await svc.update(markus, { id: project.id, expectedVersion: 1, changes: { projektstand: "EP" }, idempotencyKey: key() }, ctx());
    const events = await count("domain_events"), audits = await count("audit_log");

    const err = await svc
      .update(lena, { id: project.id, expectedVersion: 1, changes: { projektstand: "FA", kommentar: "x" }, idempotencyKey: key() }, ctx())
      .catch(e => e);
    expect(err).toBeInstanceOf(ConflictError);
    const info: ConflictInfo = err.info;
    expect(info).toMatchObject({
      expectedVersion: 1, currentVersion: 2,
      serverValues: { projektstand: "EP", kommentar: null },
      localValues: { projektstand: "FA", kommentar: "x" },
      conflictingFields: ["projektstand"],
      disjoint: false,
    });
    expect(info.lastChange).toMatchObject({ actorId: "2", actorName: "Markus" });
    expect(info.current.version).toBe(2);
    expect(await count("domain_events")).toBe(events);
    expect(await count("audit_log")).toBe(audits);
    expect((await store.detail(project.id))!.projektstand).toBe("EP");
  });

  it("conflict on disjoint fields is flagged so the client can rebase — the server never merges silently", async () => {
    const { project } = await mk();
    await svc.update(markus, { id: project.id, expectedVersion: 1, changes: { kommentar: "A" }, idempotencyKey: key() }, ctx());
    const err = await svc.update(lena, { id: project.id, expectedVersion: 1, changes: { projektleiter: "B" }, idempotencyKey: key() }, ctx()).catch(e => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.info.disjoint).toBe(true);
    expect((await store.detail(project.id))!.projektleiter).toBeNull();
  });

  it("20 simultaneous writers on the same version: exactly one wins, 19 get conflicts", async () => {
    const { project } = await mk();
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        svc.update(i % 2 ? markus : lena, { id: project.id, expectedVersion: 1, changes: { kommentar: `w${i}` }, idempotencyKey: key() }, ctx())),
    );
    const ok = results.filter(r => r.status === "fulfilled");
    const conflicts = results.filter(r => r.status === "rejected" && r.reason instanceof ConflictError);
    expect(ok).toHaveLength(1);
    expect(conflicts).toHaveLength(19);
    expect((await store.detail(project.id))!.version).toBe(2);
    expect(await count("domain_events", `aggregateId=${project.id} AND aggregateVersion=2`)).toBe(1);
  });

  it("simultaneous writes to DIFFERENT projects all succeed", async () => {
    const ps = await Promise.all(Array.from({ length: 15 }, () => mk()));
    const rs = await Promise.allSettled(
      ps.map(p => svc.update(markus, { id: p.project.id, expectedVersion: 1, changes: { kommentar: "parallel" }, idempotencyKey: key() }, ctx())),
    );
    expect(rs.every(r => r.status === "fulfilled")).toBe(true);
  });

  it("sequential writers using fresh versions never conflict and versions are gapless", async () => {
    const { project } = await mk();
    let v = 1;
    for (let i = 0; i < 10; i++) {
      const r = await svc.update(markus, { id: project.id, expectedVersion: v, changes: { kommentar: `c${i}` }, idempotencyKey: key() }, ctx());
      v = r.project.version;
    }
    const evs = await store.eventsSince(project.id, 0, 50);
    expect(evs.map(e => e.aggregateVersion)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("idempotency: same key + same body replays the original response with no new side effects", async () => {
    const { project } = await mk();
    const k = key();
    const input = { id: project.id, expectedVersion: 1, changes: { projektstand: "FA" }, idempotencyKey: k };
    const first = await svc.update(markus, input, ctx());
    const events = await count("domain_events"), audits = await count("audit_log");
    const second = await svc.update(markus, input, ctx());
    expect(second.replayed).toBe(true);
    expect(second.eventId).toBe(first.eventId);
    expect(second.project.version).toBe(2);
    expect(await count("domain_events")).toBe(events);
    expect(await count("audit_log")).toBe(audits);
  });

  it("idempotency: 10 concurrent retries of one request → one write", async () => {
    const { project } = await mk();
    const input = { id: project.id, expectedVersion: 1, changes: { kommentar: "once" }, idempotencyKey: key() };
    const rs = await Promise.all(Array.from({ length: 10 }, () => svc.update(markus, input, ctx())));
    expect(new Set(rs.map(r => r.eventId)).size).toBe(1);
    expect(rs.filter(r => !r.replayed)).toHaveLength(1);
    expect(await count("domain_events", `aggregateId=${project.id} AND aggregateVersion=2`)).toBe(1);
    expect(await count("audit_log", `entityId=${project.id} AND aggregateVersion=2`)).toBe(1);
  });

  it("idempotency: same key with a different body is rejected", async () => {
    const { project } = await mk();
    const k = key();
    await svc.update(markus, { id: project.id, expectedVersion: 1, changes: { kommentar: "a" }, idempotencyKey: k }, ctx());
    await expect(
      svc.update(markus, { id: project.id, expectedVersion: 2, changes: { kommentar: "b" }, idempotencyKey: k }, ctx()),
    ).rejects.toBeInstanceOf(IdempotencyKeyReuseError);
  });

  it("a conflict does not consume the idempotency key (a rebased retry may reuse it)", async () => {
    const { project } = await mk();
    await svc.update(markus, { id: project.id, expectedVersion: 1, changes: { kommentar: "A" }, idempotencyKey: key() }, ctx());
    const k = key();
    await expect(svc.update(lena, { id: project.id, expectedVersion: 1, changes: { projektleiter: "L" }, idempotencyKey: k }, ctx())).rejects.toBeInstanceOf(ConflictError);
    expect(await count("idempotency_keys", `idempotencyKey='${k}'`)).toBe(0);
  });

  it("atomicity: if the outbox insert fails, the project change, audit and key are all rolled back", async () => {
    const { project } = await mk();
    // Force the event insert to fail by pre-occupying (project, version 2).
    await t.pool.query(
      `INSERT INTO domain_events (eventId,eventType,aggregateType,aggregateId,aggregateVersion,envelope,createdAt) VALUES (?, 'x','project',?,2,'{}',NOW(3))`,
      [randomUUID(), project.id],
    );
    const audits = await count("audit_log", `entityId=${project.id}`);
    const k = key();
    await expect(svc.update(markus, { id: project.id, expectedVersion: 1, changes: { projektstand: "EP" }, idempotencyKey: k }, ctx())).rejects.toThrow();
    const after = await store.detail(project.id);
    expect(after!.version).toBe(1);
    expect(after!.projektstand).toBe("AP");
    expect(await count("audit_log", `entityId=${project.id}`)).toBe(audits);
    expect(await count("idempotency_keys", `idempotencyKey='${k}'`)).toBe(0);
  });

  it("authorization: viewer cannot edit; out-of-workspace principal cannot even see it (NotFound, no oracle)", async () => {
    const { project } = await mk({ bahnhofsmanagement: "Kassel" });
    await expect(svc.update(viewer, { id: project.id, expectedVersion: 1, changes: { kommentar: "x" }, idempotencyKey: key() }, ctx())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.update(mitteOnly, { id: project.id, expectedVersion: 1, changes: { kommentar: "x" }, idempotencyKey: key() }, ctx())).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.get(mitteOnly, project.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await store.detail(project.id))!.version).toBe(1);
  });

  it("authorization: cannot move a project into a workspace you may not edit", async () => {
    const { project } = await mk({ bahnhofsmanagement: "Frankfurt" });
    await expect(
      svc.update(mitteOnly, { id: project.id, expectedVersion: 1, changes: { bahnhofsmanagement: "Kassel" }, idempotencyKey: key() }, ctx()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("only admins delete; delete is versioned, audited and evented", async () => {
    const { project } = await mk();
    await expect(svc.delete(markus, { id: project.id, expectedVersion: 1, idempotencyKey: key() }, ctx())).rejects.toBeInstanceOf(ForbiddenError);
    const r = await svc.delete(admin, { id: project.id, expectedVersion: 1, idempotencyKey: key() }, ctx());
    expect(await store.detail(project.id)).toBeNull();
    const evs = await store.eventsSince(project.id, 0, 10);
    expect(evs.at(-1)).toMatchObject({ eventType: "project.deleted", aggregateVersion: 2, eventId: r.eventId });
  });

  it("normalisation is server-side and canonical; unknown region is rejected", async () => {
    const { project } = await mk();
    const r = await svc.update(markus, { id: project.id, expectedVersion: 1, changes: { bahnhofsmanagement: "  frankfurt ", station: "  Köln   Hbf ", projektleiter: "???" }, idempotencyKey: key() }, ctx());
    expect(r.project.bahnhofsmanagement).toBe("Frankfurt");
    expect(r.project.projektleiter).toBeNull();
    await expect(
      svc.update(markus, { id: project.id, expectedVersion: r.project.version, changes: { bahnhofsmanagement: "Atlantis" }, idempotencyKey: key() }, ctx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("no-op edit writes nothing", async () => {
    const { project } = await mk();
    const events = await count("domain_events");
    const r = await svc.update(markus, { id: project.id, expectedVersion: 1, changes: { projektstand: "AP" }, idempotencyKey: key() }, ctx());
    expect(r.project.version).toBe(1);
    expect(await count("domain_events")).toBe(events);
  });

  it("audit_log is append-only at the database level", async () => {
    await mk();
    await expect(t.pool.query("UPDATE audit_log SET newValue='tampered'")).rejects.toThrow(/append-only/);
    await expect(t.pool.query("DELETE FROM audit_log")).rejects.toThrow(/append-only/);
  });

  it("sync(): returns contiguous missed events, snapshots for large gaps, deletions", async () => {
    const a = (await mk()).project, b = (await mk()).project, c = (await mk()).project;
    await svc.update(markus, { id: a.id, expectedVersion: 1, changes: { kommentar: "1" }, idempotencyKey: key() }, ctx());
    await svc.update(markus, { id: a.id, expectedVersion: 2, changes: { kommentar: "2" }, idempotencyKey: key() }, ctx());
    let v = 1;
    for (let i = 0; i < 30; i++) v = (await svc.update(markus, { id: b.id, expectedVersion: v, changes: { kommentar: `n${i}` }, idempotencyKey: key() }, ctx())).project.version;
    await svc.delete(admin, { id: c.id, expectedVersion: 1, idempotencyKey: key() }, ctx());

    const out = await svc.sync(markus, [{ id: a.id, version: 1 }, { id: b.id, version: 1 }, { id: c.id, version: 1 }]);
    expect(out.events.map(e => e.aggregateVersion)).toEqual([2, 3]);
    expect(out.snapshots.map(s => s.id)).toEqual([b.id]);
    expect(out.deleted).toEqual([c.id]);
  });

  describe("department reviews on the project aggregate", () => {
    const itk: import("./permissions").Principal = { ...markus, departments: ["ITK"] };
    const addReview = async (projectId: number, department = "ITK") => {
      await t.pool.query("INSERT INTO department_reviews (projectId, department, status, prueferName) VALUES (?, ?, 'offen', 'Alt')", [projectId, department]);
    };

    it("edit → project version +1, audit key review.ITK.status, one project.updated event; replay is free", async () => {
      const { project } = await mk(); await addReview(project.id);
      const k = key();
      const input = { projectId: project.id, department: "ITK", expectedVersion: 1, changes: { status: "in Bearbeitung" }, idempotencyKey: k };
      const r = await svc.updateReview(itk, input, ctx());
      expect(r.project.version).toBe(2);
      expect(r.project.reviews.find(x => x.department === "ITK")).toMatchObject({ status: "in Bearbeitung", prueferName: "Alt" });
      const [ev] = await store.eventsSince(project.id, 1, 5);
      expect(ev).toMatchObject({ eventType: "project.updated", aggregateVersion: 2, changes: { "review.ITK.status": { from: "offen", to: "in Bearbeitung" } } });
      expect(await count("audit_log", `entityId=${project.id} AND field='review.ITK.status' AND oldValue='offen' AND newValue='in Bearbeitung'`)).toBe(1);
      const again = await svc.updateReview(itk, input, ctx());
      expect(again.replayed).toBe(true);
      expect(await count("domain_events", `aggregateId=${project.id}`)).toBe(2);
    });

    it("stale project version → structured conflict with review-keyed values; department membership is enforced", async () => {
      const { project } = await mk(); await addReview(project.id);
      await svc.update(markus, { id: project.id, expectedVersion: 1, changes: { kommentar: "x" }, idempotencyKey: key() }, ctx());
      const err = await svc.updateReview(itk, { projectId: project.id, department: "ITK", expectedVersion: 1, changes: { status: "prüffähig" }, idempotencyKey: key() }, ctx()).catch(e => e);
      expect(err).toBeInstanceOf(ConflictError);
      expect(err.info).toMatchObject({ currentVersion: 2, serverValues: { "review.ITK.status": "offen" }, localValues: { "review.ITK.status": "prüffähig" }, disjoint: true });
      // lena is EEA-only: cannot touch ITK
      await expect(svc.updateReview(lena, { projectId: project.id, department: "ITK", expectedVersion: 2, changes: { status: "x" }, idempotencyKey: key() }, ctx())).rejects.toBeInstanceOf(ForbiddenError);
      await expect(svc.updateReview(admin, { projectId: project.id, department: "GA", expectedVersion: 2, changes: { status: "x" }, idempotencyKey: key() }, ctx())).rejects.toBeInstanceOf(NotFoundError);
    });

    it("concurrent review + field edits on one project: exactly one wins per version", async () => {
      const { project } = await mk(); await addReview(project.id);
      const rs = await Promise.allSettled([
        svc.updateReview(itk, { projectId: project.id, department: "ITK", expectedVersion: 1, changes: { status: "a" }, idempotencyKey: key() }, ctx()),
        svc.update(markus, { id: project.id, expectedVersion: 1, changes: { kommentar: "b" }, idempotencyKey: key() }, ctx()),
      ]);
      expect(rs.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect((await store.detail(project.id))!.version).toBe(2);
    });
  });

  describe("list / search (server-side)", () => {
    beforeAll(async () => {
      for (let i = 0; i < 25; i++)
        await mk({ station: i % 5 === 0 ? `Marburg Nord ${i}` : `Station ${i}`, projektbeschreibung: "Bahnsteig Modernisierung" });
    });

    it("keyset pagination walks every row exactly once and caps page size", async () => {
      const seen = new Set<number>();
      let cursor: string | undefined;
      let pages = 0;
      do {
        const r = await store.list({ expand: [], limit: 10, sort: "updatedAt", dir: "desc", cursor, includeTotal: pages === 0 }, { workspaces: null });
        if (pages === 0) expect(r.total).toBeGreaterThan(25);
        for (const it of r.items) { expect(seen.has(it.id)).toBe(false); seen.add(it.id); expect(it).not.toHaveProperty("reviews"); }
        cursor = r.nextCursor ?? undefined;
        pages++;
      } while (cursor);
      expect(seen.size).toBe(await count("projects"));
      expect(pages).toBeGreaterThan(3);
    });

    it("fulltext search matches word prefixes; short input uses prefix LIKE", async () => {
      const r = await store.list({ expand: [], limit: 50, sort: "id", dir: "asc", search: "marbu", includeTotal: false }, { workspaces: null });
      expect(r.items.length).toBe(5);
      const r2 = await store.list({ expand: [], limit: 50, sort: "id", dir: "asc", search: "Ma", includeTotal: false }, { workspaces: null });
      expect(r2.items.length).toBeGreaterThanOrEqual(5);
    });

    it("search input is inert: operators and SQL metacharacters cannot change the query", async () => {
      const r = await store.list({ expand: [], limit: 50, sort: "id", dir: "asc", search: `x'; DROP TABLE projects; --`, includeTotal: false }, { workspaces: null });
      expect(r.items).toEqual([]);
      expect(await count("projects")).toBeGreaterThan(0);
    });

    it("workspace visibility restricts rows server-side", async () => {
      await mk({ bahnhofsmanagement: "Kassel", station: "Nur Kassel" });
      const r = await store.list({ expand: [], limit: 100, sort: "id", dir: "asc", includeTotal: false }, { workspaces: ["Kassel"] });
      expect(r.items.every(i => i.bahnhofsmanagement === "Kassel")).toBe(true);
    });
  });
});
