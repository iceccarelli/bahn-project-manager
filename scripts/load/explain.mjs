#!/usr/bin/env node
/**
 * Measure the production list/search/outbox queries: plan (EXPLAIN) + wall-clock
 * latency over repeated runs (median / p95 / max), so an index is kept or dropped
 * on evidence.   node scripts/load/explain.mjs mysql://user:pass@host:3306/bahn_load
 */
import mysql from "mysql2/promise";

const db = await mysql.createConnection({ uri: process.argv[2], timezone: "Z" });
const RUNS = Number(process.env.RUNS ?? 40);
const CUR = "'2024-02-10 00:00:00'";
const cases = [
  ["list p1: ORDER BY updatedAt,id LIMIT 51", "SELECT * FROM projects ORDER BY updatedAt DESC, id DESC LIMIT 51"],
  ["  · without projects_updatedAt_id_idx", "SELECT * FROM projects IGNORE INDEX (projects_updatedAt_id_idx) ORDER BY updatedAt DESC, id DESC LIMIT 51"],
  ["list keyset page mid-table", `SELECT * FROM projects WHERE (updatedAt < ${CUR} OR (updatedAt = ${CUR} AND id < 100000)) ORDER BY updatedAt DESC, id DESC LIMIT 51`],
  ["  · without projects_updatedAt_id_idx", `SELECT * FROM projects IGNORE INDEX (projects_updatedAt_id_idx) WHERE (updatedAt < ${CUR} OR (updatedAt = ${CUR} AND id < 100000)) ORDER BY updatedAt DESC, id DESC LIMIT 51`],
  ["  · OFFSET 100000 (old style)", "SELECT * FROM projects ORDER BY updatedAt DESC, id DESC LIMIT 51 OFFSET 100000"],
  ["filter region, order updatedAt", "SELECT * FROM projects WHERE bahnhofsmanagement='Frankfurt' ORDER BY updatedAt DESC, id DESC LIMIT 51"],
  ["  · without projects_updatedAt_id_idx", "SELECT * FROM projects IGNORE INDEX (projects_updatedAt_id_idx) WHERE bahnhofsmanagement='Frankfurt' ORDER BY updatedAt DESC, id DESC LIMIT 51"],
  ["filter region+stand, order updatedAt", "SELECT * FROM projects WHERE bahnhofsmanagement='Frankfurt' AND projektstand='AP' ORDER BY updatedAt DESC, id DESC LIMIT 51"],
  ["filter projektleiter, order updatedAt", "SELECT * FROM projects WHERE projektleiter='Leiter 7' ORDER BY updatedAt DESC, id DESC LIMIT 51"],
  ["search: FULLTEXT 2 terms", "SELECT * FROM projects WHERE MATCH(projektnummer,station,projektbeschreibung,projektleiter) AGAINST ('+aufzug* +marburg*' IN BOOLEAN MODE) ORDER BY updatedAt DESC, id DESC LIMIT 51"],
  ["search: FULLTEXT 1 common term", "SELECT * FROM projects WHERE MATCH(projektnummer,station,projektbeschreibung,projektleiter) AGAINST ('+bahnsteig*' IN BOOLEAN MODE) ORDER BY updatedAt DESC, id DESC LIMIT 51"],
  ["search: OLD %term% x5 columns", "SELECT * FROM projects WHERE projektnummer LIKE '%aufzug%' OR station LIKE '%aufzug%' OR projektbeschreibung LIKE '%aufzug%' OR projektleiter LIKE '%aufzug%' OR bahnhofsmanagement LIKE '%aufzug%' ORDER BY id LIMIT 51"],
  ["search: prefix LIKE 'Mar%'", "SELECT * FROM projects WHERE station LIKE 'Mar%' ORDER BY updatedAt DESC, id DESC LIMIT 51"],
  ["shell: COUNT(*), MAX(updatedAt)", "SELECT COUNT(*), MAX(updatedAt) FROM projects"],
  ["detail: reviews by project", "SELECT * FROM department_reviews WHERE projectId=777 ORDER BY department"],
  ["events since (aggregate, version)", "SELECT envelope FROM domain_events WHERE aggregateType='project' AND aggregateId=777 AND aggregateVersion>1 ORDER BY aggregateVersion LIMIT 25"],
  ["outbox scan (current index)", "SELECT id, envelope FROM domain_events WHERE processedAt IS NULL ORDER BY id LIMIT 200"],
  ["  · forced PRIMARY (no outbox index)", "SELECT id, envelope FROM domain_events FORCE INDEX (PRIMARY) WHERE processedAt IS NULL ORDER BY id LIMIT 200"],
];
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
console.log(`rows: projects=${(await db.query("SELECT COUNT(*) n FROM projects"))[0][0].n} domain_events=${(await db.query("SELECT COUNT(*) n FROM domain_events"))[0][0].n}  runs/query=${RUNS}\n`);
console.log("query".padEnd(44), "median".padStart(9), "p95".padStart(9), " plan");
for (const [label, sql] of cases) {
  const [plan] = await db.query(`EXPLAIN ${sql}`);
  const t = [];
  for (let i = 0; i < RUNS; i++) { const s = performance.now(); await db.query(sql); t.push(performance.now() - s); }
  t.sort((a, b) => a - b);
  const p = plan[0];
  console.log(label.padEnd(44), `${pct(t, .5).toFixed(2)} ms`.padStart(9), `${pct(t, .95).toFixed(2)} ms`.padStart(9), ` ${p.type ?? ""}/${p.key ?? "-"} rows≈${p.rows}${/filesort/.test(p.Extra ?? "") ? " FILESORT" : ""}`);
}
await db.end();
