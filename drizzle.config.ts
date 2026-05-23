import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    url: connectionString,
  },
  // NEW: Point to seeding migration for perfect data.json ↔ DB round-trip sync
  // Run with: pnpm db:push && pnpm seed:json
  // This ensures migrations include seed-from-json logic for initial 1,298+ projects
  migrations: {
    table: "__drizzle_migrations",
    schema: "public", // adjust if using different DB schema
  },
  // Strict for perfect consistency
  strict: true,
  verbose: true,
});
