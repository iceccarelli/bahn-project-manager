import { afterAll, describe, expect, it } from "vitest";
import IORedis from "ioredis";
import { MemoryPresenceStore, RedisPresenceStore, PresenceService, presenceEvent, type PresenceStore } from "./presence";
import { InProcessBus } from "./hub";
import { eventForPrincipal } from "../domain/eventVisibility";
import { admin, markus, mitteOnly } from "../domain/testFixtures";
import { DomainEventSchema } from "@shared/domain-events";

const redisUrl = process.env.TEST_REDIS_URL;
const conns: IORedis[] = [];
afterAll(async () => { await Promise.all(conns.map(c => c.quit().catch(() => {}))); });

function contract(name: string, make: () => PresenceStore) {
  describe(`PresenceStore (${name})`, () => {
    const who = (userId: string, tabId: string, state: "online" | "viewing" | "editing" | "idle" | "away" = "viewing") => ({ userId, tabId, name: `U${userId}`, state });
    it("aggregates tabs per user (most active state wins) and orders by activity", async () => {
      const s = make(); const scope = `project:${Math.floor(Math.random() * 1e9)}`;
      await s.heartbeat(scope, who("1", "a", "idle"), 45_000);
      await s.heartbeat(scope, who("1", "b", "editing"), 45_000);
      await s.heartbeat(scope, who("2", "a", "viewing"), 45_000);
      const l = await s.list(scope);
      expect(l.map(e => [e.userId, e.state, e.tabs])).toEqual([["1", "editing", 2], ["2", "viewing", 1]]);
    });
    it("reports change only when the visible snapshot changes; keeps `since` while the state is stable", async () => {
      const s = make(); const scope = `project:${Math.floor(Math.random() * 1e9)}`;
      expect(await s.heartbeat(scope, who("1", "a"), 45_000, 1_000)).toBe(true);
      expect(await s.heartbeat(scope, who("1", "a"), 45_000, 20_000)).toBe(false);   // plain heartbeat
      const since = (await s.list(scope, 20_000))[0]!.since;
      expect(since).toBe(new Date(1_000).toISOString());
      expect(await s.heartbeat(scope, who("1", "a", "editing"), 45_000, 21_000)).toBe(true);
    });
    it("TTL: a member that stops heartbeating disappears; sweep names the scope; leave is immediate", async () => {
      const s = make(); const scope = `project:${Math.floor(Math.random() * 1e9)}`;
      const t0 = Date.now();
      await s.heartbeat(scope, who("1", "a"), 1_000, t0);
      await s.heartbeat(scope, who("2", "a"), 60_000, t0);
      expect((await s.list(scope, t0 + 500)).length).toBe(2);
      expect((await s.sweep(t0 + 2_000))).toContain(scope);
      expect((await s.list(scope, t0 + 2_000)).map(e => e.userId)).toEqual(["2"]);
      expect(await s.leave(scope, "2", "a")).toBe(true);
      expect(await s.list(scope, t0 + 2_000)).toEqual([]);
    });
  });
}
contract("memory", () => new MemoryPresenceStore());
describe.skipIf(!redisUrl)("real Redis", () => contract("redis", () => { const c = new IORedis(redisUrl!); conns.push(c); return new RedisPresenceStore(c, `test:${Math.random()}:`); }));

describe("PresenceService → event envelope → recipient filtering", () => {
  it("publishes a valid, scoped, ephemeral event and never touches SQL (no store other than Redis/memory)", async () => {
    const bus = new InProcessBus();
    const svc = new PresenceService(new MemoryPresenceStore(), bus);
    const it = bus.subscribe({ channels: ["project:12"] })[Symbol.asyncIterator]();
    await svc.heartbeat("project:12", { userId: "2", name: "Markus", tabId: "t", state: "editing" }, "Frankfurt");
    const e = (await it.next()).value;
    expect(DomainEventSchema.safeParse(e).success).toBe(true);
    expect(e).toMatchObject({ aggregateType: "presence", eventType: "presence.changed", aggregateId: "project:12" });
    expect(JSON.parse(e.changes.members.to)).toMatchObject([{ userId: "2", state: "editing" }]);
    await it.return!();
  });
  it("project presence is only visible to principals who can see the project's workspace", () => {
    const e = presenceEvent("project:12", [], "Kassel");
    expect(eventForPrincipal(admin, e)).not.toBeNull();
    expect(eventForPrincipal(markus, e)).not.toBeNull();       // ALL
    expect(eventForPrincipal(mitteOnly, e)).toBeNull();        // Frankfurt only
    expect(eventForPrincipal(mitteOnly, presenceEvent("project:12", [], "Frankfurt"))).not.toBeNull();
    expect(eventForPrincipal(mitteOnly, presenceEvent("workspace:kassel", [], null))).toBeNull();
  });
});

describe("presence limits (never a write hotspot)", () => {
  const mkSvc = (limits?: Partial<import("./presence").PresenceLimits>) => {
    let now = 1_000_000; const published: unknown[] = []; const store = new MemoryPresenceStore();
    let beats = 0; const orig = store.heartbeat.bind(store); store.heartbeat = async (...a) => { beats++; return orig(...a); };
    const svc = new PresenceService(store, { publish: async e => { published.push(e); } }, { minHeartbeatIntervalMs: 5000, coalesceMs: 500, perUserMax: 6, perUserWindowMs: 10_000, ...limits }, () => now);
    return { svc, published, beats: () => beats, advance: (ms: number) => { now += ms; } };
  };
  const who = (tabId = "tab-0001", state: "viewing" | "editing" = "viewing") => ({ userId: "u1", name: "U", tabId, state });

  it("drops duplicate heartbeats before they reach the store, but never a state change", async () => {
    const t = mkSvc();
    await t.svc.heartbeat("project:1", who(), "Frankfurt");
    await t.svc.heartbeat("project:1", who(), "Frankfurt");
    await t.svc.heartbeat("project:1", who(), "Frankfurt");
    expect(t.beats()).toBe(1);
    await t.svc.heartbeat("project:1", who("tab-0001", "editing"), "Frankfurt"); // state change passes
    expect(t.beats()).toBe(2);
    t.advance(6000);
    await t.svc.heartbeat("project:1", who("tab-0001", "editing"), "Frankfurt"); // window elapsed: keeps the TTL alive
    expect(t.beats()).toBe(3);
    expect(t.svc.stats.throttled).toBe(2);
  });

  it("caps one user's call rate across all scopes with a 429-class error", async () => {
    const t = mkSvc();
    for (let i = 0; i < 6; i++) await t.svc.heartbeat(`project:${i + 1}`, who(), "Frankfurt");
    await expect(t.svc.heartbeat("project:99", who(), "Frankfurt")).rejects.toThrow();
    t.advance(11_000);
    await expect(t.svc.heartbeat("project:99", who(), "Frankfurt")).resolves.toBeUndefined();
  });

  it("coalesces a join storm into one leading and one trailing publish carrying the latest snapshot", async () => {
    const t = mkSvc({ perUserMax: 1000, coalesceMs: 50 });
    for (let i = 0; i < 20; i++) await t.svc.heartbeat("project:7", { userId: `u${i}`, name: `U${i}`, tabId: `tab-${1000 + i}`, state: "viewing" }, "Frankfurt");
    await new Promise(r => setTimeout(r, 200));
    expect(t.published.length).toBeLessThanOrEqual(3);          // not 20
    const last = t.published.at(-1) as { changes: { members: { to: string } } };
    expect(JSON.parse(last.changes.members.to)).toHaveLength(20); // the trailing snapshot is complete
  });
});
