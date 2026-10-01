#!/usr/bin/env node
/**
 * Build a load-test database: apply the committed migrations, seed N projects
 * (+ department reviews for the first R), and create the two load users.
 *
 *   node scripts/load/setup-db.mjs mysql://user:pass@127.0.0.1:3306 bahn_load 200000
 *
 * Data is synthetic but shaped like production: 9 Bahnhofsmanagements, real
 * station names from client/public/data.json, ~12 Projektstand values.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const [, , base, dbName = "bahn_load", nArg = "200000"] = process.argv;
if (!base) { console.error("usage: setup-db.mjs <mysql-url-without-db> [db] [rows]"); process.exit(2); }
const N = Number(nArg), REVIEWS_FOR = Math.min(N, 20000);
const root = path.resolve(import.meta.dirname, "../..");

const admin = await mysql.createConnection(base);
await admin.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
await admin.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await admin.end();

const db = await mysql.createConnection({ uri: `${base}/${dbName}`, timezone: "Z" });
for (const f of readdirSync(path.join(root, "drizzle")).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort())
  for (const stmt of readFileSync(path.join(root, "drizzle", f), "utf8").split("--> statement-breakpoint"))
    if (stmt.trim()) await db.query(stmt);

const raw = JSON.parse(readFileSync(path.join(root, "client/public/data.json"), "utf8"));
const rows = Array.isArray(raw) ? raw : raw.projects;
const stations = [...new Set(rows.map(r => r.station).filter(Boolean))];
const regions = ["Darmstadt", "Frankfurt", "Gießen", "Kaiserslautern", "Kassel", "Koblenz", "Mainz", "Saarbrücken", "übergreifend"];
const stands = ["AP", "EP", "FA", "VEP", "Gestoppt", "Mieterumbau", "realisiert", "TBQ GP", "EIGV erfolgt", "EP/ EIGV", "Mieterumbau iAG", "Mieterumbau MAG"];
const leaders = Array.from({ length: 60 }, (_, i) => `Leiter ${i + 1}`);
const depts = ["ITK", "EEA", "LST", "Vermessung", "Baubetriebstechnologie", "Baubetriebsplanung", "TBQ", "Brandschutz", "Denkmalschutz", "Statik", "Gleis", "Ausrüstung", "Umwelt", "Recht"];
const words = ["Bahnsteig", "Aufzug", "Dach", "Beleuchtung", "Barrierefreiheit", "Modernisierung", "Zugang", "Wetterschutz", "Fahrgastinformation", "Treppe"];
const pick = (a, i) => a[i % a.length];

await db.query("SET autocommit=0");
const t0 = Date.now();
for (let start = 0; start < N; start += 2000) {
  const vals = [];
  for (let i = start; i < Math.min(N, start + 2000); i++) {
    const at = new Date(Date.UTC(2024, 0, 1) + ((i * 7919) % 60_000_000) * 60);
    vals.push([`P-${100000 + i}`, pick(regions, i * 7 + 3), pick(stations, i * 13), pick(stands, i * 5), pick(leaders, i * 11),
      `${pick(words, i)} ${pick(words, i * 3 + 1)} ${pick(stations, i * 13)}`, 1, at, at]);
  }
  await db.query("INSERT INTO projects (projektnummer,bahnhofsmanagement,station,projektstand,projektleiter,projektbeschreibung,syncVersion,createdAt,updatedAt) VALUES ?", [vals]);
}
await db.query("COMMIT");
for (let start = 1; start <= REVIEWS_FOR; start += 1000) {
  const vals = [];
  for (let id = start; id < Math.min(REVIEWS_FOR + 1, start + 1000); id++)
    for (const [k, d] of depts.entries()) vals.push([id, d, `Prüfer ${k}`, k % 3 ? "in Bearbeitung" : "Zustimmung erteilt"]);
  await db.query("INSERT INTO department_reviews (projectId,department,prueferName,status) VALUES ?", [vals]);
}
await db.query("INSERT INTO users (openId,name,email,role) VALUES ('load-admin','Load Admin','a@load.test','admin'),('load-user','Load User','u@load.test','user')");
await db.query("COMMIT");
await db.query("ANALYZE TABLE projects, department_reviews, domain_events, audit_log");
const [[c]] = await db.query("SELECT COUNT(*) n FROM projects");
console.log(JSON.stringify({ db: dbName, projects: c.n, reviewsFor: REVIEWS_FOR, seconds: (Date.now() - t0) / 1000 }));
await db.end();
