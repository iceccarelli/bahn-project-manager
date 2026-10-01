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
