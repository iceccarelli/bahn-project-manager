/**
 * Seed a database with the REAL dataset (client/public/data.json, 1,298 projects,
 * ids preserved — so "Project 481" is the real Koblenz Hbf Kaisertreppe project).
 *   tsx scripts/e2e/seed-real.ts mysql://user:pass@host:3306/dbname   (schema must already exist)
 */
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { ingestProjects } from "../../shared/ingest";

const url = process.argv[2];
if (!url) { console.error("usage: seed-real.ts <mysql-url-with-db>"); process.exit(2); }
const raw = JSON.parse(readFileSync("client/public/data.json", "utf8"));
const { projects, rejected } = ingestProjects(raw);
if (rejected.length) console.warn(`[seed] ${rejected.length} rows rejected by validation`);

const db = await mysql.createConnection({ uri: url, timezone: "Z" });
const date = (v: unknown) => (typeof v === "string" && v ? new Date(v) : null);
for (let i = 0; i < projects.length; i += 200) {
  const chunk = projects.slice(i, i + 200) as any[];
  await db.query(
    "INSERT INTO projects (id,projektnummer,bahnhofsmanagement,station,bahnhofsnummer,streckennummer,projektbeschreibung,projektstand,projektleiter,terminProjektvorstellung,kommentar,projektLink,syncVersion) VALUES ?",
    [chunk.map(p => [p.id, p.projektnummer, p.bahnhofsmanagement, p.station, p.bahnhofsnummer, p.streckennummer, p.projektbeschreibung, p.projektstand, p.projektleiter, date(p.terminProjektvorstellung), p.kommentar, p.projektLink, 1])],
  );
  const reviews = chunk.flatMap(p => (p.reviews ?? []).map((r: any) => [p.id, r.department, r.prueferName ?? null, date(r.pruefDatum), r.status ?? null]));
  if (reviews.length) await db.query("INSERT IGNORE INTO department_reviews (projectId,department,prueferName,datum,status) VALUES ?", [reviews]);
}
const [[c]] = (await db.query("SELECT COUNT(*) n, (SELECT COUNT(*) FROM department_reviews) r FROM projects")) as any;
console.log(JSON.stringify({ projects: c.n, reviews: c.r }));
await db.end();
