/**
 * Production migration runner (the image has no drizzle-kit): applies drizzle/*.sql through
 * drizzle's own migrator, so it is compatible with databases already migrated by `drizzle-kit migrate`.
 *
 *   node dist/migrate.js          (DATABASE_URL required; MIGRATIONS_DIR defaults to ./drizzle)
 *
 * Idempotent and safe to run from several instances at once: it takes a named lock first.
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required"); process.exit(2); }

const conn = await mysql.createConnection({ uri: url, multipleStatements: false });
try {
  const [[lock]] = (await conn.query("SELECT GET_LOCK('bahn:migrate', 120) AS got")) as any;
  if (Number(lock.got) !== 1) throw new Error("could not obtain migration lock within 120 s");
  await migrate(drizzle({ client: conn }), { migrationsFolder: process.env.MIGRATIONS_DIR ?? "drizzle" });
  await conn.query("SELECT RELEASE_LOCK('bahn:migrate')");
  console.log("migrations applied");
} catch (e) {
  console.error("migration failed:", e);
  process.exitCode = 1;
} finally {
  await conn.end();
}
