/** Audit feed against a REAL database: scope stamped in the writing transaction, keyset pagination, filters. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { hasTestDb, createTestDatabase } from "../testing/testDb";
import { MysqlProjectStore } from "./mysqlProjectStore";
import { ProjectService } from "../domain/projectService";
import { admin, ctx } from "../domain/testFixtures";
import { pageAudit } from "./auditQuery";

const key = () => `k-${randomUUID()}`;

describe.skipIf(!hasTestDb)("audit feed (real DB)", () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let svc: ProjectService;
  let kassel: number, frankfurt: number, doomed: number;

  beforeAll(async () => {
    t = await createTestDatabase(10);
    svc = new ProjectService(new MysqlProjectStore(t.db as never), () => {});
    const mk = async (station: string, bm: string) => (await svc.create(admin, { fields: { station, bahnhofsmanagement: bm, projektnummer: `N-${station}` }, idempotencyKey: key() }, ctx())).project.id;
    kassel = await mk("Fulda", "Kassel");
    frankfurt = await mk("Hanau Hbf", "Frankfurt");
    doomed = await mk("Marburg (Lahn)", "Kassel");
    for (let i = 0; i < 6; i++) {
      const v = (await svc.get(admin, kassel)).version;
      await svc.update(admin, { id: kassel, expectedVersion: v, changes: { kommentar: `c${i}` }, idempotencyKey: key() }, ctx());
    }
    const v = (await svc.get(admin, doomed)).version;
    await svc.delete(admin, { id: doomed, expectedVersion: v, idempotencyKey: key() }, ctx());
  });
  afterAll(async () => { await t?.drop(); });

  it("rows carry the scope and label stamped by the transaction (also for a deleted project)", async () => {
    const all = await pageAudit(t.pool, null, { limit: 100, days: 0 });
    const del = all.items.find(i => i.action === "delete")!;
    expect(del).toMatchObject({ entityId: doomed, label: "Marburg (Lahn)", workspace: "Kassel" });
    expect(all.items.every(i => i.workspace !== null)).toBe(true);
  });

  it("a restricted principal sees only its workspaces; unrestricted sees all; empty list sees nothing", async () => {
    const k = await pageAudit(t.pool, ["Kassel"], { limit: 100, days: 0 });
    expect(k.items.length).toBeGreaterThan(0);
    expect(new Set(k.items.map(i => i.workspace))).toEqual(new Set(["Kassel"]));
    expect(k.items.some(i => i.entityId === frankfurt)).toBe(false);
    const all = await pageAudit(t.pool, null, { limit: 100, days: 0 });
    expect(all.items.some(i => i.entityId === frankfurt)).toBe(true);
    expect((await pageAudit(t.pool, [], { days: 0 })).items).toEqual([]);
  });

  it("keyset pagination walks the whole trail exactly once, newest first, without a full download", async () => {
    const seen: number[] = [];
    let cursor: number | undefined;
    let pages = 0;
    do {
      const p = await pageAudit(t.pool, null, { limit: 5, cursor, days: 0 });
      expect(p.items.length).toBeLessThanOrEqual(5);
      seen.push(...p.items.map(i => i.id));
      cursor = p.nextCursor ?? undefined;
      pages++;
    } while (cursor !== undefined);
    expect(pages).toBeGreaterThan(1);
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort((a, b) => b - a)).toEqual(seen);
    const [[n]] = (await t.pool.query("SELECT COUNT(*) n FROM audit_log")) as any;
    expect(seen.length).toBe(Number(n.n));
  });

  it("filters: action, label contains, user prefix, entity; the page size is capped", async () => {
    expect((await pageAudit(t.pool, null, { action: "delete", days: 0 })).items.map(i => i.entityId)).toEqual([doomed]);
    expect((await pageAudit(t.pool, null, { label: "anau", days: 0 })).items.every(i => i.entityId === frankfurt)).toBe(true);
    expect((await pageAudit(t.pool, null, { entityId: kassel, days: 0, limit: 1000 })).items.length).toBeLessThanOrEqual(100);
    expect((await pageAudit(t.pool, null, { user: "zzz-nobody", days: 0 })).items).toEqual([]);
  });
});
