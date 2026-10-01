/**
 * Map read model maintenance. The station master (stations.json — a public station directory, not project
 * data) is resolved ONCE per project write into `project_geo`; map queries then never touch names again.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { buildStationGeo, type ResolvedStation, type StationGeoIndex, type StationRecord } from "@shared/stationGeo";

const CANDIDATES = () => [
  process.env.STATIONS_JSON,
  path.resolve(process.cwd(), "dist/public/stations.json"),
  path.resolve(process.cwd(), "public/stations.json"),
  path.resolve(process.cwd(), "client/public/stations.json"),
  path.resolve(import.meta.dirname ?? ".", "public/stations.json"),
].filter((x): x is string => !!x);

let cached: StationGeoIndex | null | undefined;
/** The station index, built once per process. null when no station master is available (map stays empty, loudly). */
export function geoIndex(): StationGeoIndex | null {
  if (cached !== undefined) return cached;
  for (const f of CANDIDATES()) {
    if (!existsSync(f)) continue;
    try { cached = buildStationGeo(JSON.parse(readFileSync(f, "utf8")) as StationRecord[]); return cached; } catch (e) { console.error("[geo] unreadable station master", f, e); }
  }
  console.error("[geo] no stations.json found: the map read model cannot be maintained (set STATIONS_JSON)");
  cached = null;
  return cached;
}
/** test hook */
export function setGeoIndexForTests(i: StationGeoIndex | null | undefined) { cached = i; }

export const resolveGeo = (station: string | null, bm: string | null): ResolvedStation | null => geoIndex()?.resolve(station, bm) ?? null;

type Exec = { execute(q: ReturnType<typeof sql>): Promise<unknown> };

/** Upsert (or remove, when the station cannot be placed) one project's geo row. Runs inside the caller's transaction. */
export async function syncProjectGeo(x: Exec, projectId: number, station: string | null, bm: string | null): Promise<void> {
  const g = resolveGeo(station, bm);
  if (!g) { await x.execute(sql`DELETE FROM project_geo WHERE projectId = ${projectId}`); return; }
  await x.execute(sql`INSERT INTO project_geo (projectId, lat, lng, stationKey, stationName, \`precision\`)
    VALUES (${projectId}, ${g.lat}, ${g.lng}, ${g.key}, ${g.name.slice(0, 255)}, ${g.precision})
    ON DUPLICATE KEY UPDATE lat = VALUES(lat), lng = VALUES(lng), stationKey = VALUES(stationKey), stationName = VALUES(stationName), \`precision\` = VALUES(\`precision\`)`);
}

/** Fill/repair geo rows for every project (idempotent; used by the migration step and as the repair tool). */
export async function rebuildGeo(pool: { query(sql: string, args?: unknown[]): Promise<unknown> }): Promise<{ placed: number; unplaced: number }> {
  const idx = geoIndex();
  if (!idx) return { placed: 0, unplaced: -1 };
  const [rows] = (await pool.query("SELECT id, station, bahnhofsmanagement AS bm FROM projects")) as unknown as [Array<{ id: number; station: string | null; bm: string | null }>];
  let placed = 0, unplaced = 0;
  const values: unknown[][] = [];
  const keep: number[] = [];
  for (const r of rows) {
    const g = idx.resolve(r.station, r.bm);
    if (!g) { unplaced++; continue; }
    placed++; keep.push(r.id);
    values.push([r.id, g.lat, g.lng, g.key, g.name.slice(0, 255), g.precision]);
  }
  for (let i = 0; i < values.length; i += 500) {
    await pool.query(
      "INSERT INTO project_geo (projectId, lat, lng, stationKey, stationName, `precision`) VALUES ? ON DUPLICATE KEY UPDATE lat = VALUES(lat), lng = VALUES(lng), stationKey = VALUES(stationKey), stationName = VALUES(stationName), `precision` = VALUES(`precision`)",
      [values.slice(i, i + 500)],
    );
  }
  // rows for projects that no longer exist or can no longer be placed
  await pool.query("DELETE g FROM project_geo g LEFT JOIN projects p ON p.id = g.projectId WHERE p.id IS NULL");
  if (unplaced) {
    const ids = rows.filter(r => !keep.includes(r.id)).map(r => r.id);
    for (let i = 0; i < ids.length; i += 1000) await pool.query("DELETE FROM project_geo WHERE projectId IN (?)", [ids.slice(i, i + 1000)]);
  }
  return { placed, unplaced };
}
