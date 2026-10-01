/**
 * Authorized row loader for the Dashboard portfolio (the derivation itself is shared/portfolio-view.ts).
 * One lean scan per authorization scope per TTL (see KeyedCache in routers.ts); no free-text columns.
 */
import type { Pool } from "mysql2/promise";
import type { PortfolioProject } from "@shared/portfolio-metrics";

const day = (d: Date | null): string | null => {
  if (!d) return null;
  const s = d.toISOString();
  return s.endsWith("T00:00:00.000Z") ? s.slice(0, 10) : s;
};

interface Row { id: number; projektnummer: string | null; station: string | null; bm: string | null; termin: Date | null; department: string | null; status: string | null; pruefer: string | null; datum: Date | null }

/** Authorized rows → PortfolioProject[] (reviews attached). `workspaces` null = unrestricted, [] = nothing. */
export async function loadPortfolioProjects(pool: Pool, workspaces: readonly string[] | null): Promise<PortfolioProject[]> {
  if (workspaces !== null && workspaces.length === 0) return [];
  const [rows] = (await pool.query(
    `SELECT p.id, p.projektnummer, p.station, p.bahnhofsmanagement AS bm, p.terminProjektvorstellung AS termin,
            r.department, r.status, r.prueferName AS pruefer, r.datum
       FROM projects p LEFT JOIN department_reviews r ON r.projectId = p.id${workspaces ? " WHERE p.bahnhofsmanagement IN (?)" : ""}
      ORDER BY p.id`,
    workspaces ? [[...workspaces]] : [],
  )) as unknown as [Row[]];
  const out: PortfolioProject[] = [];
  let cur: PortfolioProject | null = null;
  for (const r of rows) {
    if (!cur || cur.id !== r.id) {
      cur = { id: r.id, projektnummer: r.projektnummer, station: r.station, bahnhofsmanagement: r.bm, terminProjektvorstellung: day(r.termin), reviews: [] };
      out.push(cur);
    }
    if (r.department !== null) cur.reviews!.push({ department: r.department, status: r.status, prueferName: r.pruefer, pruefDatum: day(r.datum) });
  }
  return out;
}
