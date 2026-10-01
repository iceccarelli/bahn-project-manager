/**
 * Real-database test harness. Each test file gets its own database, built by
 * applying the committed drizzle migrations in order — so the tests exercise
 * the same schema (unique keys, triggers, FULLTEXT) production runs, not a mock.
 *
 * Enabled by TEST_DATABASE_URL=mysql://user:pass@host:port (server level, no
 * database name). Without it, DB-backed suites are skipped and say so.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";

export const TEST_DB_URL = process.env.TEST_DATABASE_URL;
export const hasTestDb = Boolean(TEST_DB_URL);

export async function createTestDatabase(poolSize = 10) {
  if (!TEST_DB_URL) throw new Error("TEST_DATABASE_URL not set");
  const name = `bahn_t_${randomBytes(5).toString("hex")}`;
  const admin = await mysql.createConnection({ uri: TEST_DB_URL, multipleStatements: false });
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const dir = path.resolve(import.meta.dirname, "../../drizzle");
  const files = readdirSync(dir).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
  const conn = await mysql.createConnection({ uri: `${TEST_DB_URL}/${name}` });
  for (const f of files) {
    for (const stmt of readFileSync(path.join(dir, f), "utf8").split("--> statement-breakpoint")) {
      if (stmt.trim()) await conn.query(stmt);
    }
  }
  await conn.end();
  const pool = mysql.createPool({ uri: `${TEST_DB_URL}/${name}`, connectionLimit: poolSize, timezone: "Z" });
  const db = drizzle({ client: pool });
  return {
    name,
    pool,
    db,
    async drop() {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await admin.end();
    },
  };
}
