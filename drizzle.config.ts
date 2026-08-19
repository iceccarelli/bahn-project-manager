import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  // The committed migrations and meta/_journal.json live in ./drizzle, not in
  // ./drizzle/migrations (which held only a .gitkeep). With the old value
  // `drizzle-kit generate` produced a fresh baseline and never saw them.
  out: "./drizzle",
  dialect: "mysql", // TODO: Migrate to 'pg' for full-text search + better performance (Neon/Vercel Postgres recommended)
  dbCredentials: {
    url: connectionString,
  },
  // Perfect consistency: migrations folder + strict mode
  migrations: {
    table: "__drizzle_migrations",
    // NOTE: no `schema` key — that is a Postgres concept and this project is
    // MySQL. Setting it here was silently ignored at best.
  },
  // Enhanced for perfect seeding & relations
  strict: true,
  verbose: true,
  // Future-proof: enable when switching to Postgres
  // dialect: "pg",
  // dbCredentials: { url: connectionString },
});
