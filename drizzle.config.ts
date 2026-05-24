import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dialect: "mysql", // TODO: Migrate to 'pg' for full-text search + better performance (Neon/Vercel Postgres recommended)
  dbCredentials: {
    url: connectionString,
  },
  // Perfect consistency: migrations folder + strict mode
  migrations: {
    table: "__drizzle_migrations",
    schema: "public",
  },
  // Enhanced for perfect seeding & relations
  strict: true,
  verbose: true,
  // Future-proof: enable when switching to Postgres
  // dialect: "pg",
  // dbCredentials: { url: connectionString },
});
