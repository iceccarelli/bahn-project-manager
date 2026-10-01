// server/_core/migrate.ts
import "dotenv/config";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
var url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}
var conn = await mysql.createConnection({ uri: url, multipleStatements: false });
try {
  const [[lock]] = await conn.query("SELECT GET_LOCK('bahn:migrate', 120) AS got");
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
