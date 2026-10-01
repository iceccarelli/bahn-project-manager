/**
 * Subscribe barrier + dynamic scopes + fanout topology (no database; Redis parts need TEST_REDIS_URL).
 *
 * The invariant under test: the gateway announces `hello` (and reads the feed head) only AFTER the
 * transport has confirmed every subscription. Anything numbered after that head is therefore guaranteed
 * to reach the stream; anything at or before it is recovered from the durable feed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import IORedis from "ioredis";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { InProcessBus } from "./hub";
import { RedisBus } from "./redisBus";
import { registerRealtimeGateway } from "./gateway";
import { admin, mitteOnly } from "../domain/testFixtures";
import { event } from "../../client/src/realtime/testUtils";
import { isMembershipEvent, scopesForEvent } from "@shared/domain-events";
import type { Principal } from "../domain/permissions";
import type { RealtimeSubscriber, Subscription } from "../domain/ports";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** minimal SSE reader */
async function openSse(url: string, headers: Record<string, string>) {
  const ac = new AbortController();
  const res = await fetch(url, { headers, signal: ac.signal });
  const frames: { event: string; data: any }[] = [];
  const waiters: { pred: (f: { event: string; data: any }) => boolean; res: (f: any) => void }[] = [];
  if (res.status === 200) {
    void (async () => {
      const rd = res.body!.getReader(), td = new TextDecoder(); let buf = "";
      try {
        for (;;) {
          const c = await rd.read(); if (c.done) break; buf += td.decode(c.value);
          let i: number;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const raw = buf.slice(0, i); buf = buf.slice(i + 2);
            const ev = /^event: (.*)$/m.exec(raw)?.[1], d = /^data: (.*)$/m.exec(raw)?.[1];
            if (!ev || !d) continue;
            const f = { event: ev, data: JSON.parse(d) }; frames.push(f);
            for (const w of [...waiters]) if (w.pred(f)) { waiters.splice(waiters.indexOf(w), 1); w.res(f); }
          }
        }
      } catch { /* aborted */ }
    })();
  }
  return {
    status: res.status, frames, close: () => ac.abort(),
    until: (pred: (f: { event: string; data: any }) => boolean, ms = 3000) => frames.find(pred) ? Promise.resolve(frames.find(pred)!) : new Promise<any>((ok, no) => { const w = { pred, res: ok }; waiters.push(w); setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); no(new Error(`no frame in ${ms} ms; saw ${frames.map(f => f.event).join(",")}`)); }, ms); }),
    none: async (pred: (f: { event: string; data: any }) => boolean, ms = 250) => { await sleep(ms); return !frames.some(pred); },
  };
}
const who = (req: express.Request): Principal | undefined => (req.headers["x-u"] === "mia" ? mitteOnly : req.headers["x-u"] === "admin" ? admin : undefined);

describe("subscribe barrier (gateway)", () => {
  it("reads the feed head and says hello only AFTER the transport confirmed the subscription", async () => {
    const log: string[] = [];
    const bus = new InProcessBus();
    const slow: RealtimeSubscriber = {
      control: bus.control,
      subscribe(scope): Subscription {
        const inner = bus.subscribe(scope);
        return { [Symbol.asyncIterator]() { const it = inner[Symbol.asyncIterator](); return Object.assign(it, { ready: sleep(300).then(() => { log.push("ready"); }) }); } } as Subscription;
      },
    };
    const app = express(); app.use(express.json());
    registerRealtimeGateway(app, { subscriber: slow, store: { versions: async () => new Map(), feedHead: async () => { log.push("head"); return 42; } }, resolve: async r => { const p = who(r); return p ? { principal: p } : null; } });
    const server: Server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const t0 = Date.now();
    const s = await openSse(`${base}/api/realtime/stream?scopes=collection:all`, { "x-u": "admin" });
    const hello = await s.until(f => f.event === "hello");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(280);   // the response was held back for the confirmation
    expect(log).toEqual(["ready", "head"]);                 // never head-before-ready
    expect(hello.data.headSeq).toBe(42);
    s.close(); server.closeAllConnections(); server.close();
  });

  it("refuses the stream (503 + Retry-After) when the transport never confirms, instead of announcing a hello it cannot honour", async () => {
    const bus = new InProcessBus();
    const never: RealtimeSubscriber = { subscribe(scope): Subscription { const inner = bus.subscribe(scope); return { [Symbol.asyncIterator]() { return Object.assign(inner[Symbol.asyncIterator](), { ready: new Promise<void>(() => {}) }); } } as Subscription; } };
    const app = express(); app.use(express.json());
    registerRealtimeGateway(app, { subscriber: never, readyTimeoutMs: 120, store: { versions: async () => new Map(), feedHead: async () => 1 }, resolve: async r => { const p = who(r); return p ? { principal: p } : null; } });
    const server: Server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/realtime/stream?scopes=collection:all`, { headers: { "x-u": "admin" } });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("2");
    server.closeAllConnections(); server.close();
  });
});

describe("fanout topology", () => {
  it("a plain field edit is delivered ONLY on the project channel; membership changes also reach the compact collection feed", () => {
    const edit = event(12, 2, { kommentar: { from: null, to: "x" } });
    expect(isMembershipEvent(edit)).toBe(false);
    expect(scopesForEvent(edit).filter(s => s.startsWith("collection:"))).toEqual([]);
    const created = event(12, 1, { station: { from: null, to: "A" } }, { eventType: "project.created" });
    expect(scopesForEvent(created)).toEqual(expect.arrayContaining(["project:12", "collection:all", "collection:frankfurt"]));
    const moved = event(12, 3, { bahnhofsmanagement: { from: "Kassel", to: "Frankfurt" } }, { context: { workspace: "Frankfurt", workspaceBefore: "Kassel" } });
    expect(isMembershipEvent(moved)).toBe(true);
    expect(scopesForEvent(moved)).toEqual(expect.arrayContaining(["collection:all", "collection:frankfurt", "collection:kassel"]));
    expect(isMembershipEvent(event(12, 4, {}, { eventType: "project.deleted" }))).toBe(true);
  });

  it("an unrestricted user watching the global list receives only the events for rows they hold plus membership changes — not every project's edits", async () => {
    const bus = new InProcessBus();
    const app = express(); app.use(express.json());
    registerRealtimeGateway(app, { subscriber: bus, store: { versions: async () => new Map(), feedHead: async () => 1 }, resolve: async r => { const p = who(r); return p ? { principal: p } : null; } });
    const server: Server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const s = await openSse(`${base}/api/realtime/stream?scopes=collection:all,project:1,project:2`, { "x-u": "admin" });
    await s.until(f => f.event === "hello");
    for (let id = 1; id <= 50; id++) await bus.publish(event(id, 2, { kommentar: { from: null, to: "x" } }));
    await bus.publish(event(99, 1, { station: { from: null, to: "New" } }, { eventType: "project.created" }));
    await sleep(200);
    const ids = s.frames.filter(f => f.event === "domain").map(f => f.data.aggregateId).sort();
    expect(ids).toEqual(["1", "2", "99"]); // 3 of 51 events, not 51
    s.close(); server.closeAllConnections(); server.close();
  });
});

describe("dynamic scopes on a live stream", () => {
  let server: Server, base: string, bus: InProcessBus;
  beforeAll(async () => {
    bus = new InProcessBus();
    const app = express(); app.use(express.json());
    registerRealtimeGateway(app, {
      subscriber: bus, nodeId: "nodeA", maxStreamScopes: 6,
      store: { versions: async ids => new Map(ids.map(i => [i, { version: 1, bahnhofsmanagement: i === 7 ? "Kassel" : "Frankfurt" }])), feedHead: async () => 1 },
      resolve: async r => { const p = who(r); return p ? { principal: p } : null; },
    });
    server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server.closeAllConnections(); server.close(); });
  const post = (who: string, body: unknown) => fetch(`${base}/api/realtime/scopes`, { method: "POST", headers: { "x-u": who, "content-type": "application/json" }, body: JSON.stringify(body) });

  it("add/remove take effect without reconnecting, and `scopes` is acknowledged only once the channels are confirmed", async () => {
    const s = await openSse(`${base}/api/realtime/stream?scopes=collection:all`, { "x-u": "admin" });
    const { streamId } = (await s.until(f => f.event === "hello")).data;
    expect(streamId).toMatch(/^nodeA\./);
    expect((await post("admin", { streamId, requestId: "r1", add: ["project:5"] })).status).toBe(202);
    const ack = await s.until(f => f.event === "scopes" && f.data.requestId === "r1");
    expect(ack.data.accepted).toEqual(["project:5"]);
    await bus.publish(event(5, 2, { kommentar: { from: null, to: "a" } }));
    await s.until(f => f.event === "domain" && f.data.aggregateId === "5");
    await post("admin", { streamId, requestId: "r2", remove: ["project:5"] });
    await s.until(f => f.event === "scopes" && f.data.requestId === "r2");
    const before = s.frames.length;
    await bus.publish(event(5, 3, { kommentar: { from: "a", to: "b" } }));
    await sleep(150);
    expect(s.frames.length).toBe(before); // no longer delivered
    s.close();
  });

  it("is authorized per scope, per principal, and bounded", async () => {
    const m = await openSse(`${base}/api/realtime/stream?scopes=project:1`, { "x-u": "mia" });
    const { streamId } = (await m.until(f => f.event === "hello")).data;
    // Mia is Frankfurt-only: project 7 is Kassel, collection:all is unrestricted-only, collection:kassel is another workspace
    await post("mia", { streamId, requestId: "a", add: ["project:7", "collection:all", "collection:kassel", "project:2", "collection:frankfurt"] });
    const ack = (await m.until(f => f.event === "scopes" && f.data.requestId === "a")).data;
    expect(ack.accepted.sort()).toEqual(["collection:frankfurt", "project:2"]);
    expect(ack.denied.sort()).toEqual(["collection:all", "collection:kassel", "project:7"]);
    // someone else's stream id is a 404, not a way to alter another user's subscriptions
    expect((await post("admin", { streamId, requestId: "b", add: ["project:3"] })).status).toBe(404);
    expect((await post("mia", { streamId: "nodeA.doesnotexist", requestId: "c", add: ["project:3"] })).status).toBe(404);
    expect((await post("mia", { streamId, requestId: "d", add: ["bogus:scope"] })).status).toBe(400);
    // ceiling (maxStreamScopes = 6): 3 held + 3 more fit, the 4th is denied
    await post("mia", { streamId, requestId: "e", add: ["project:10", "project:11", "project:12", "project:13"] });
    const ack2 = (await m.until(f => f.event === "scopes" && f.data.requestId === "e")).data;
    expect(ack2.accepted.length).toBe(3);
    expect(ack2.denied.length).toBe(1);
    m.close();
  });
});

const url = process.env.TEST_REDIS_URL;
describe.skipIf(!url)("barrier + routing over real Redis", () => {
  const conns: IORedis[] = [];
  const mk = () => { const c = new IORedis(url!); c.on("error", () => {}); conns.push(c); return c; };
  afterAll(async () => { await Promise.all(conns.map(c => c.quit().catch(() => {}))); });

  it("RedisBus.ready settles only after Redis acknowledged SUBSCRIBE; an event published after ready is never missed", async () => {
    const real = mk();
    let ackDelay = 250, acked = 0;
    // a subscriber connection whose SUBSCRIBE acknowledgement is slow
    const slowSub = new Proxy(real, { get(t, p, r) { if (p === "subscribe") return async (...a: any[]) => { await sleep(ackDelay); const x = await (t as any).subscribe(...a); acked++; return x; }; const v = Reflect.get(t, p, t); return typeof v === "function" ? v.bind(t) : v; } });
    const bus = new RedisBus(mk(), slowSub as unknown as IORedis);
    const it = bus.subscribe({ channels: ["project:77"] })[Symbol.asyncIterator]();
    let settled = false; void it.ready.then(() => { settled = true; });
    await sleep(80);
    expect(settled).toBe(false);          // Redis has not acknowledged yet
    await it.ready;
    expect(acked).toBe(1);
    const publisher = new RedisBus(mk(), mk());
    const e = event(77, 2, { kommentar: { from: null, to: "x" } });
    await publisher.publish(e);           // immediately after ready: no sleep, no hoping
    expect((await Promise.race([it.next(), sleep(1500).then(() => "timeout")])) as any).toMatchObject({ value: { eventId: e.eventId } });
    await it.return!();
  });

  it("a scopes request sent to the WRONG instance is routed to the stream's owner over Redis", async () => {
    const mkNode = async (nodeId: string) => {
      const bus = new RedisBus(mk(), mk());
      const app = express(); app.use(express.json());
      registerRealtimeGateway(app, { subscriber: bus, nodeId, store: { versions: async () => new Map(), feedHead: async () => 1 }, resolve: async r => { const p = who(r); return p ? { principal: p } : null; } });
      const server: Server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
      await sleep(80); // the node's own control-channel SUBSCRIBE
      return { bus, server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
    };
    const A = await mkNode("nodeA"), B = await mkNode("nodeB");
    const s = await openSse(`${A.base}/api/realtime/stream?scopes=collection:all`, { "x-u": "admin" });
    const { streamId } = (await s.until(f => f.event === "hello")).data;
    const r = await fetch(`${B.base}/api/realtime/scopes`, { method: "POST", headers: { "x-u": "admin", "content-type": "application/json" }, body: JSON.stringify({ streamId, requestId: "x1", add: ["project:31"] }) });
    expect(r.status).toBe(202);
    await s.until(f => f.event === "scopes" && f.data.requestId === "x1");
    await B.bus.publish(event(31, 2, { kommentar: { from: null, to: "z" } })); // published via the OTHER node
    await s.until(f => f.event === "domain" && f.data.aggregateId === "31");
    const ghost = await fetch(`${B.base}/api/realtime/scopes`, { method: "POST", headers: { "x-u": "admin", "content-type": "application/json" }, body: JSON.stringify({ streamId: "nodeZ.abc", requestId: "x2", add: ["project:1"] }) });
    expect(ghost.status).toBe(404);
    s.close(); for (const n of [A, B]) { n.server.closeAllConnections(); n.server.close(); }
  });
});
