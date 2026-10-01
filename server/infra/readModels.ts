/**
 * Dashboard read models (rm_* tables): counters updated in the SAME transaction as the write that changes
 * them, so reads are tiny indexed lookups and never a GROUP BY over department_reviews per request.
 *
 *   rm_project_stats(workspace)                      projects per workspace
 *   rm_review_stats(workspace, department, status)   reviews per workspace/department/status
 *   rm_pruefer_load(workspace, pruefer)              assigned reviews per Prüfer
 *
 * Authorization: a restricted principal reads ONLY the rows of its own workspaces; the aggregation across
 * them happens over those rows. Drift is impossible to ignore: `rebuildReadModels` recomputes everything
 * from the base tables (repair + test oracle) and `verifyReadModels` reports any difference.
 */
import { sql } from "drizzle-orm";

type Exec = { execute(q: ReturnType<typeof sql>): Promise<unknown> };
const ws = (w: string | null | undefined) => w ?? "";
const st = (s: string | null | undefined) => s ?? "";
const NO_PRUEFER = new Set(["", "Zuordnung erforderlich"]);

export async function projectDelta(x: Exec, workspace: string | null, delta: 1 | -1): Promise<void> {
  await x.execute(sql`INSERT INTO rm_project_stats (workspace, projects) VALUES (${ws(workspace)}, ${delta < 0 ? 0 : 1})
    ON DUPLICATE KEY UPDATE projects = GREATEST(0, projects + ${delta})`);
}

export async function reviewDelta(x: Exec, r: { workspace: string | null; department: string; status: string | null; pruefer: string | null }, delta: 1 | -1): Promise<void> {
  await x.execute(sql`INSERT INTO rm_review_stats (workspace, department, status, n) VALUES (${ws(r.workspace)}, ${r.department}, ${st(r.status)}, ${delta < 0 ? 0 : 1})
    ON DUPLICATE KEY UPDATE n = GREATEST(0, n + ${delta})`);
  const p = (r.pruefer ?? "").trim();
  if (!NO_PRUEFER.has(p)) {
    await x.execute(sql`INSERT INTO rm_pruefer_load (workspace, pruefer, n) VALUES (${ws(r.workspace)}, ${p}, ${delta < 0 ? 0 : 1})
      ON DUPLICATE KEY UPDATE n = GREATEST(0, n + ${delta})`);
  }
}

/** A project changed workspace: every review and the project row move with it. */
export async function moveWorkspace(x: Exec, projectId: number, from: string | null, to: string | null): Promise<void> {
  if (ws(from) === ws(to)) return;
  const rows = (await x.execute(sql`SELECT department, status, prueferName FROM department_reviews WHERE projectId = ${projectId}`)) as unknown as [Array<{ department: string; status: string | null; prueferName: string | null }>];
  await projectDelta(x, from, -1);
  await projectDelta(x, to, 1);
  for (const r of rows[0]) {
    await reviewDelta(x, { workspace: from, department: r.department, status: r.status, pruefer: r.prueferName }, -1);
    await reviewDelta(x, { workspace: to, department: r.department, status: r.status, pruefer: r.prueferName }, 1);
  }
}

/** Remove a project's contribution (call BEFORE its rows are deleted). */
export async function removeProject(x: Exec, projectId: number, workspace: string | null): Promise<void> {
  const rows = (await x.execute(sql`SELECT department, status, prueferName FROM department_reviews WHERE projectId = ${projectId}`)) as unknown as [Array<{ department: string; status: string | null; prueferName: string | null }>];
  await projectDelta(x, workspace, -1);
  for (const r of rows[0]) await reviewDelta(x, { workspace, department: r.department, status: r.status, pruefer: r.prueferName }, -1);
}

type Pool = { query(sql: string, args?: unknown[]): Promise<unknown> };

/** Full recompute from the base tables. Idempotent; the single repair path. */
export async function rebuildReadModels(pool: Pool): Promise<void> {
  await pool.query("DELETE FROM rm_project_stats");
  await pool.query("DELETE FROM rm_review_stats");
  await pool.query("DELETE FROM rm_pruefer_load");
  await pool.query("INSERT INTO rm_project_stats (workspace, projects) SELECT COALESCE(bahnhofsmanagement, ''), COUNT(*) FROM projects GROUP BY COALESCE(bahnhofsmanagement, '')");
  await pool.query(`INSERT INTO rm_review_stats (workspace, department, status, n)
    SELECT COALESCE(p.bahnhofsmanagement, ''), r.department, COALESCE(r.status, ''), COUNT(*)
    FROM department_reviews r JOIN projects p ON p.id = r.projectId GROUP BY COALESCE(p.bahnhofsmanagement, ''), r.department, COALESCE(r.status, '')`);
  await pool.query(`INSERT INTO rm_pruefer_load (workspace, pruefer, n)
    SELECT COALESCE(p.bahnhofsmanagement, ''), TRIM(r.prueferName), COUNT(*)
    FROM department_reviews r JOIN projects p ON p.id = r.projectId
    WHERE r.prueferName IS NOT NULL AND TRIM(r.prueferName) NOT IN ('', 'Zuordnung erforderlich')
    GROUP BY COALESCE(p.bahnhofsmanagement, ''), TRIM(r.prueferName)`);
}

/** Differences between the read models and a recompute from the base tables (empty = consistent). */
export async function verifyReadModels(pool: Pool): Promise<string[]> {
  const q = async <T>(s: string) => ((await pool.query(s)) as unknown as [T[]])[0];
  const diffs: string[] = [];
  const cmp = (name: string, live: Array<Record<string, unknown>>, truth: Array<Record<string, unknown>>) => {
    const key = (r: Record<string, unknown>) => JSON.stringify(Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v]));
    const a = new Set(live.filter(r => Number(r.n ?? r.projects) > 0).map(key)), b = new Set(truth.map(key));
    for (const k of a) if (!b.has(k)) diffs.push(`${name}: read model has ${k}`);
    for (const k of b) if (!a.has(k)) diffs.push(`${name}: recompute has ${k}`);
  };
  cmp("rm_project_stats",
    await q("SELECT workspace, CAST(projects AS SIGNED) AS projects FROM rm_project_stats"),
    await q("SELECT COALESCE(bahnhofsmanagement,'') AS workspace, CAST(COUNT(*) AS SIGNED) AS projects FROM projects GROUP BY COALESCE(bahnhofsmanagement,'')"));
  cmp("rm_review_stats",
    await q("SELECT workspace, department, status, CAST(n AS SIGNED) AS n FROM rm_review_stats"),
    await q("SELECT COALESCE(p.bahnhofsmanagement,'') AS workspace, r.department AS department, COALESCE(r.status,'') AS status, CAST(COUNT(*) AS SIGNED) AS n FROM department_reviews r JOIN projects p ON p.id=r.projectId GROUP BY COALESCE(p.bahnhofsmanagement,''), r.department, COALESCE(r.status,'')"));
  cmp("rm_pruefer_load",
    await q("SELECT workspace, pruefer, CAST(n AS SIGNED) AS n FROM rm_pruefer_load"),
    await q("SELECT COALESCE(p.bahnhofsmanagement,'') AS workspace, TRIM(r.prueferName) AS pruefer, CAST(COUNT(*) AS SIGNED) AS n FROM department_reviews r JOIN projects p ON p.id=r.projectId WHERE r.prueferName IS NOT NULL AND TRIM(r.prueferName) NOT IN ('','Zuordnung erforderlich') GROUP BY COALESCE(p.bahnhofsmanagement,''), TRIM(r.prueferName)"));
  return diffs;
}

export interface DashboardStats {
  totalProjects: number;
  statusDistribution: Array<{ status: string | null; count: number }>;
  departmentStats: Array<{ department: string; status: string | null; count: number }>;
  regionStats: Array<{ region: string | null; count: number }>;
  prueferWorkload: Array<{ name: string; count: number }>;
}

/** Same shape the legacy GROUP BY produced — served from the counters. `workspaces` null = unrestricted. */
export async function readDashboard(pool: Pool, workspaces: readonly string[] | null): Promise<DashboardStats> {
  if (workspaces !== null && workspaces.length === 0) return { totalProjects: 0, statusDistribution: [], departmentStats: [], regionStats: [], prueferWorkload: [] };
  const where = workspaces === null ? "" : " WHERE workspace IN (?)";
  const args = workspaces === null ? [] : [[...workspaces]];
  const q = async <T>(s: string) => ((await pool.query(s, args)) as unknown as [T[]])[0];
  const proj = await q<{ workspace: string; projects: number }>(`SELECT workspace, projects FROM rm_project_stats${where}`);
  const rev = await q<{ department: string; status: string; n: number }>(`SELECT department, status, SUM(n) AS n FROM rm_review_stats${where} GROUP BY department, status HAVING SUM(n) > 0`);
  const load = await q<{ pruefer: string; n: number }>(`SELECT pruefer, SUM(n) AS n FROM rm_pruefer_load${where} GROUP BY pruefer HAVING SUM(n) > 0 ORDER BY SUM(n) DESC, pruefer LIMIT 20`);
  const statusDist = new Map<string, number>();
  for (const r of rev) statusDist.set(r.status, (statusDist.get(r.status) ?? 0) + Number(r.n));
  return {
    totalProjects: proj.reduce((a, r) => a + Number(r.projects), 0),
    statusDistribution: [...statusDist].map(([status, count]) => ({ status: status === "" ? null : status, count })),
    departmentStats: rev.map(r => ({ department: r.department, status: r.status === "" ? null : r.status, count: Number(r.n) })),
    regionStats: proj.filter(r => Number(r.projects) > 0).map(r => ({ region: r.workspace === "" ? null : r.workspace, count: Number(r.projects) })),
    prueferWorkload: load.map(r => ({ name: r.pruefer, count: Number(r.n) })),
  };
}
