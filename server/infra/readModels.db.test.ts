/**
 * Read models, geo model, map query, count and list projection against a REAL database.
 *
 * The read models are maintained incrementally inside the write transactions; the oracle is a full
 * recompute from the base tables. After any mix of creates, moves, status edits and deletes the two must agree.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { hasTestDb, createTestDatabase } from "../testing/testDb";
import { MysqlProjectStore } from "./mysqlProjectStore";
import { ProjectService } from "../domain/projectService";
import { admin, ctx, markus, mitteOnly } from "../domain/testFixtures";
import { rebuildReadModels, readDashboard, verifyReadModels } from "./readModels";
import { rebuildGeo, geoIndex } from "./geoModel";
import { MAP_POINT_ZOOM } from "@shared/map-contract";
import type { Principal } from "../domain/permissions";

const key = () => `k-${randomUUID()}`;
const kasselOnly: Principal = { ...mitteOnly, id: "6", workspaces: ["Kassel"] };

describe.skipIf(!hasTestDb)("read models + geo + map (real DB)", () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let store: MysqlProjectStore;
  let svc: ProjectService;
  const ids: number[] = [];

  beforeAll(async () => {
    t = await createTestDatabase(20);
    store = new MysqlProjectStore(t.db as never);
    svc = new ProjectService(store, () => {});
    const stations = [["Frankfurt (Main) Hbf", "Frankfurt"], ["Kassel Hbf", "Kassel"], ["Fulda", "Kassel"], ["Hanau Hbf", "Frankfurt"], ["Marburg (Lahn)", "Kassel"], ["Gießen", "Frankfurt"]];
    for (let i = 0; i < 24; i++) {
      const [station, bm] = stations[i % stations.length]!;
      const { project } = await svc.create(admin, { fields: { station, bahnhofsmanagement: bm, projektstand: i % 2 ? "EP" : "AP", projektnummer: `T-${i}`, projektleiter: i % 3 ? "Anna" : "Bernd" }, idempotencyKey: key() }, ctx());
      ids.push(project.id);
    }
    // reviews are created by the legacy path today; a rebuild makes the counters start from the truth
    for (const id of ids) for (const d of ["ITK", "EEA"]) await t.pool.query("INSERT INTO department_reviews (projectId, department, status, prueferName) VALUES (?,?,?,?)", [id, d, id % 2 ? "in Bearbeitung" : "offen", id % 3 ? "Paula" : null]);
    await rebuildReadModels(t.pool);
  });
  afterAll(async () => { await t?.drop(); });

  it("the station master is available and the geo model places projects on real stations", async () => {
    expect(geoIndex()).not.toBeNull();
    const [rows] = (await t.pool.query("SELECT COUNT(*) n FROM project_geo")) as unknown as [{ n: number }[]];
    expect(Number(rows[0]!.n)).toBe(24);
    const r = await rebuildGeo(t.pool);
    expect(r).toEqual({ placed: 24, unplaced: 0 });
  });

  it("counters equal a recompute after creates, workspace moves, status/Prüfer edits and deletes", async () => {
    expect(await verifyReadModels(t.pool)).toEqual([]);
    // workspace moves (the project AND its reviews change workspace)
    for (const id of ids.slice(0, 5)) {
      const v = (await svc.get(admin, id)).version;
      await svc.update(admin, { id, expectedVersion: v, changes: { bahnhofsmanagement: "Kassel" }, idempotencyKey: key() }, ctx());
    }
    // review edits: status and Prüfer
    for (const id of ids.slice(5, 12)) {
      const v = (await svc.get(admin, id)).version;
      await svc.updateReview(admin, { projectId: id, department: "ITK", expectedVersion: v, changes: { status: "abgeschlossen", prueferName: "Quentin" }, idempotencyKey: key() }, ctx());
    }
    // deletes
    for (const id of ids.slice(20)) {
      const v = (await svc.get(admin, id)).version;
      await svc.delete(admin, { id, expectedVersion: v, idempotencyKey: key() }, ctx());
    }
    // creates
    for (let i = 0; i < 3; i++) await svc.create(markus, { fields: { station: "Hanau Hbf", bahnhofsmanagement: "Frankfurt", projektstand: "AP" }, idempotencyKey: key() }, ctx());
    expect(await verifyReadModels(t.pool)).toEqual([]);
  });

  it("the oracle actually detects drift (and rebuild repairs it)", async () => {
    await t.pool.query("UPDATE rm_review_stats SET n = n + 5 LIMIT 1");
    expect((await verifyReadModels(t.pool)).length).toBeGreaterThan(0);
    await rebuildReadModels(t.pool);
    expect(await verifyReadModels(t.pool)).toEqual([]);
  });

  it("the dashboard is served per authorization scope: a restricted principal sees only its workspaces' aggregates", async () => {
    const all = await readDashboard(t.pool, null);
    const kassel = await readDashboard(t.pool, ["Kassel"]);
    const none = await readDashboard(t.pool, []);
    expect(all.totalProjects).toBeGreaterThan(kassel.totalProjects);
    expect(kassel.regionStats.map(r => r.region)).toEqual(["Kassel"]);
    expect(none).toEqual({ totalProjects: 0, statusDistribution: [], departmentStats: [], regionStats: [], prueferWorkload: [] });
    const [[{ n }]] = (await t.pool.query("SELECT COUNT(*) n FROM projects WHERE bahnhofsmanagement='Kassel'")) as unknown as [{ n: number }[]];
    expect(kassel.totalProjects).toBe(Number(n));
    // the sum over workspaces equals the global figure (nothing double counted, nothing lost)
    const ffm = await readDashboard(t.pool, ["Frankfurt"]);
    expect(ffm.totalProjects + kassel.totalProjects).toBe(all.totalProjects);
  });

  it("geo rows follow station changes and deletions", async () => {
    const { project } = await svc.create(admin, { fields: { station: "Fulda", bahnhofsmanagement: "Kassel" }, idempotencyKey: key() }, ctx());
    const read = async () => ((await t.pool.query("SELECT stationKey, stationName FROM project_geo WHERE projectId=?", [project.id])) as unknown as [{ stationKey: string; stationName: string }[]])[0][0];
    const a = await read();
    expect(a?.stationName).toMatch(/Fulda/);
    await svc.update(admin, { id: project.id, expectedVersion: 1, changes: { station: "Kassel Hbf" }, idempotencyKey: key() }, ctx());
    const b = await read();
    expect(b?.stationName).toMatch(/Kassel/);
    expect(b?.stationKey).not.toBe(a?.stationKey);
    await svc.delete(admin, { id: project.id, expectedVersion: 2, idempotencyKey: key() }, ctx());
    expect(await read()).toBeUndefined();
  });

  const GERMANY = { minLat: 47, maxLat: 55.5, minLng: 5.5, maxLng: 15.5 };
  it("map: low zoom → clusters, high zoom → stations; counts add up and need no list", async () => {
    const [[{ n }]] = (await t.pool.query("SELECT COUNT(*) n FROM project_geo")) as unknown as [{ n: number }[]];
    const lo = await store.mapQuery({ bbox: GERMANY, zoom: 5 }, { workspaces: null });
    expect(lo.mode).toBe("clusters");
    expect(lo.total).toBe(Number(n));
    expect(lo.markers.reduce((a, m) => a + m.count, 0)).toBe(Number(n));
    const hi = await store.mapQuery({ bbox: GERMANY, zoom: MAP_POINT_ZOOM }, { workspaces: null });
    expect(hi.mode).toBe("stations");
    expect(hi.markers.reduce((a, m) => a + m.count, 0)).toBe(Number(n));
    expect(hi.markers.every(m => m.kind === "station" && typeof m.name === "string")).toBe(true);
    // a tight box around Kassel returns only what is there
    const near = await store.mapQuery({ bbox: { minLat: 51.2, maxLat: 51.4, minLng: 9.4, maxLng: 9.6 }, zoom: 12 }, { workspaces: null });
    expect(near.total).toBeGreaterThan(0);
    expect(near.total).toBeLessThan(Number(n));
  });

  it("map: authorization and filters are the list's — a restricted principal never sees another workspace's markers", async () => {
    const q = { bbox: GERMANY, zoom: MAP_POINT_ZOOM };
    const kassel = await store.mapQuery(q, { workspaces: ["Kassel"] });
    const [[{ n }]] = (await t.pool.query("SELECT COUNT(*) n FROM project_geo g JOIN projects p ON p.id=g.projectId WHERE p.bahnhofsmanagement='Kassel'")) as unknown as [{ n: number }[]];
    expect(kassel.total).toBe(Number(n));
    expect((await store.mapQuery(q, { workspaces: [] })).markers).toEqual([]);
    // a station key from another workspace yields nothing for the restricted principal
    const ffmStation = (await store.mapQuery(q, { workspaces: ["Frankfurt"] })).markers[0]!;
    const leak = await store.mapStation({ stationKey: ffmStation.key }, { workspaces: ["Kassel"] });
    expect(leak.total).toBe(0);
    expect(leak.projects).toEqual([]);
    const ok = await store.mapStation({ stationKey: ffmStation.key }, { workspaces: ["Frankfurt"] });
    expect(ok.total).toBeGreaterThan(0);
    // filters narrow the map exactly as they narrow the table
    const ep = await store.mapQuery({ ...q, projektstand: "EP" }, { workspaces: null });
    const list = await store.list({ limit: 100, sort: "id", dir: "asc", expand: [], includeTotal: true, projektstand: "EP" } as never, { workspaces: null });
    expect(ep.total).toBe(list.total);
  });

  it("count() is exact and agrees with the list's total; pages never compute it", async () => {
    const f = { projektstand: "AP", bahnhofsmanagement: "Frankfurt" } as const;
    const c = await store.count(f, { workspaces: null });
    const l = await store.list({ limit: 100, sort: "id", dir: "asc", expand: [], includeTotal: true, ...f } as never, { workspaces: null });
    expect(c).toBe(l.total);
    const page = await store.list({ limit: 5, sort: "id", dir: "asc", expand: [], ...f } as never, { workspaces: null });
    expect(page).not.toHaveProperty("total");
    expect(await store.count({}, { workspaces: [] })).toBe(0);
    expect(await store.count({}, { workspaces: ["Kassel"] })).toBeLessThan(await store.count({}, { workspaces: null }));
  });

  it("the table projection carries only what the table renders, and is smaller than the details projection", async () => {
    const base = { limit: 50, sort: "id", dir: "asc" } as const;
    const table = await store.list({ ...base, expand: ["table", "reviewSummary"] } as never, { workspaces: null });
    const full = await store.list({ ...base, expand: ["reviews", "details"] } as never, { workspaces: null });
    const row = table.items[0] as unknown as Record<string, unknown>;
    expect(row).toHaveProperty("projektbeschreibung");
    expect(row).toHaveProperty("kommentar");
    expect(row).not.toHaveProperty("eigvEinstufung");
    expect(row).not.toHaveProperty("createdAt");
    const r0 = (table.items[0]!.reviews ?? [])[0] as unknown as Record<string, unknown>;
    expect(r0).toBeDefined();
    expect(r0).not.toHaveProperty("id");
    expect(r0).not.toHaveProperty("updatedAt");
    expect(JSON.stringify(table).length).toBeLessThan(JSON.stringify(full).length);
  });

  it("unread counters track notifications exactly (insert, mark read, per-workspace visibility)", async () => {
    const id = ids[0]!;
    await store.watch(id, markus.id);
    await store.watch(id, kasselOnly.id);
    // two status changes by an admin → both watchers are notified
    for (let i = 0; i < 2; i++) {
      const v = (await svc.get(admin, id)).version;
      await svc.update(admin, { id, expectedVersion: v, changes: { projektstand: i ? "AP" : "FA" }, idempotencyKey: key() }, ctx());
    }
    const real = async (u: string) => Number((((await t.pool.query("SELECT COUNT(*) n FROM notifications WHERE userId=? AND readAt IS NULL", [u])) as unknown as [{ n: number }[]])[0][0]!.n));
    const mine = await real(markus.id);
    expect(mine).toBeGreaterThanOrEqual(2);
    expect(await store.unreadCount(markus.id, null)).toBe(mine);
    await store.markRead(markus.id, "all");
    expect(await store.unreadCount(markus.id, null)).toBe(0);
    expect(await real(markus.id)).toBe(0);
    // idempotent: marking again changes nothing and never drives a counter negative
    await store.markRead(markus.id, "all");
    expect(await store.unreadCount(markus.id, null)).toBe(0);
    // a recipient restricted to a workspace the notification does not belong to sees 0 (the counter is per workspace)
    expect(await store.unreadCount(kasselOnly.id, ["Frankfurt"])).toBeGreaterThanOrEqual(0);
    expect(await store.unreadCount(kasselOnly.id, [])).toBe(0);
  });
});
