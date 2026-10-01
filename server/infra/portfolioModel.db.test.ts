/** Portfolio read model against a REAL database: workspace scoping is authoritative and figures are exact. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasTestDb, createTestDatabase } from "../testing/testDb";
import { loadPortfolioProjects } from "./portfolioModel";
import { buildPortfolio } from "@shared/portfolio-view";
import { drillProjectIds, startOfDayUtc } from "@shared/drilldown";
import { MysqlProjectStore } from "./mysqlProjectStore";

describe.skipIf(!hasTestDb)("portfolio read model (real DB)", () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  const NOW = Date.parse("2026-06-15T12:00:00Z");

  beforeAll(async () => {
    t = await createTestDatabase(10);
    const mk = async (nr: string, bm: string | null, termin: string | null) =>
      ((await t.pool.query("INSERT INTO projects (projektnummer, station, bahnhofsmanagement, terminProjektvorstellung) VALUES (?,?,?,?)", [nr, `St-${nr}`, bm, termin])) as any)[0].insertId as number;
    const a = await mk("A", "Kassel", "2026-01-01");   // delayed: past Termin + open review
    const b = await mk("B", "Kassel", "2027-01-01");
    const c = await mk("C", "Frankfurt", "2026-01-01");
    const d = await mk("D", null, null);
    const rev = (p: number, dep: string, st: string | null, who: string | null, datum: string | null) =>
      t.pool.query("INSERT INTO department_reviews (projectId, department, status, prueferName, datum) VALUES (?,?,?,?,?)", [p, dep, st, who, datum]);
    await rev(a, "EEA", "offen", "Paula", "2026-05-01");      // overdue open
    await rev(a, "ITK", "Zustimmung erteilt", "Paula", "2026-04-01");
    await rev(b, "EEA", "abgelehnt", null, null);              // blocked, unassigned
    await rev(c, "EEA", "in Bearbeitung", "Anna", "2026-07-01"); // open, future
    await rev(d, "ITK", "offen", "Anna", null);
  });
  afterAll(async () => { await t?.drop(); });

  it("unrestricted scope sees every project; figures are exact", async () => {
    const v = buildPortfolio(await loadPortfolioProjects(t.pool, null), NOW);
    expect(v.metrics.total).toBe(4);
    expect(v.totalReviews).toBe(5);
    expect(v.delayedProjects).toBe(2); // A and C (past Termin, open review); D has no Termin
    expect(v.withoutRegion).toBe(1);
    expect(v.regions).toEqual([{ region: "Kassel", count: 2 }, { region: "Frankfurt", count: 1 }]);
    expect(v.upcoming.map(u => u.projectId + u.department)).toEqual([expect.stringMatching(/EEA$/), expect.stringMatching(/EEA$/)]);
    expect(v.upcoming[0]!.overdue).toBe(true);
    expect(v.upcoming[1]!.overdue).toBe(false);
    expect(v.workload.find(w => w.name === "Paula")).toMatchObject({ incoming: 1, completed: 1, total: 2 });
    expect(v.bedarf.find(x => x.key === "blocked")!.rows).toBe(1);
    expect(v.bedarf.find(x => x.key === "unassigned")!.projects).toBe(0); // unassigned = OPEN and no Prüfer; B is blocked, not open
  });

  it("a restricted scope is computed over its own workspaces only (nothing of the others leaks)", async () => {
    const v = buildPortfolio(await loadPortfolioProjects(t.pool, ["Kassel"]), NOW);
    expect(v.metrics.total).toBe(2);
    expect(v.totalReviews).toBe(3);
    expect(v.regions).toEqual([{ region: "Kassel", count: 2 }]);
    expect(v.workload.map(w => w.name)).toEqual(["Paula"]); // Anna only works in other workspaces
    expect(JSON.stringify(v)).not.toContain("St-C");
    expect(JSON.stringify(v)).not.toContain("Anna");
  });

  it("an empty workspace list yields an empty portfolio", async () => {
    const v = buildPortfolio(await loadPortfolioProjects(t.pool, []), NOW);
    expect(v.metrics.total).toBe(0);
    expect(v.workload).toEqual([]);
  });

  it("a drill-down lists EXACTLY the projects its Dashboard number counted (same predicates, same day), scoped", async () => {
    const rows = await loadPortfolioProjects(t.pool, null);
    const today = startOfDayUtc(NOW);
    const view = buildPortfolio(rows, NOW);
    const store = new MysqlProjectStore(t.db as never);
    for (const key of ["overdue", "blocked", "nachforderung", "unassigned"] as const) {
      const ids = drillProjectIds(rows, { bedarf: key }, today)!;
      expect(ids.size, key).toBe(view.bedarf.find(b => b.key === key)!.projects);
      const page = await store.list({ limit: 50, sort: "id", dir: "asc", expand: [], includeTotal: true } as never, { workspaces: null }, { ids });
      expect(new Set(page.items.map((i: any) => i.id)), key).toEqual(ids);
      expect(page.total).toBe(ids.size);
    }
    // a tone slice narrowed to one Gewerk inside the predicate
    const eea = drillProjectIds(rows, { tone: "pending", department: "EEA" }, today)!;
    expect(eea.size).toBe(view.gewerke.find(g => g.name === "EEA")!.slices.find(sl => sl.tone === "pending")?.projects ?? 0);
    // authorization is intersected: a restricted caller cannot reach another workspace's id even by naming it
    const kasselRows = await loadPortfolioProjects(t.pool, ["Kassel"]);
    const other = rows.find(r => r.bahnhofsmanagement === "Frankfurt")!.id;
    const ids = drillProjectIds(kasselRows, { ids: [other] }, today)!;
    expect(ids.size).toBe(0);
    const page = await store.list({ limit: 50, sort: "id", dir: "asc", expand: [] } as never, { workspaces: ["Kassel"] }, { ids: new Set([other]) });
    expect(page.items).toEqual([]);
  });
});
