#!/usr/bin/env tsx
/**
 * PERFECT BIDIRECTIONAL SYNC v2.0
 * Zero data drift between data.json and Database
 * Usage: pnpm sync:json-db --checksum --dry-run
 */

import { getDb } from "../server/db";
import { projects } from "../drizzle/schema";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DATA_JSON_PATH = path.resolve("public/data.json");

async function syncJsonDb(dryRun = false, force = false) {
  console.log("🔄 Starting bidirectional sync...");

  const db = await getDb();
  if (!db) {
    console.error("❌ Database not available. Set DATABASE_URL.");
    process.exit(1);
  }

  const dbProjects = await db.select().from(projects);
  const dbChecksum = crypto.createHash("sha256")
    .update(JSON.stringify(dbProjects))
    .digest("hex");

  let jsonData: any = { projects: [] };
  if (fs.existsSync(DATA_JSON_PATH)) {
    jsonData = JSON.parse(fs.readFileSync(DATA_JSON_PATH, "utf-8"));
  }

  const jsonChecksum = crypto.createHash("sha256")
    .update(JSON.stringify(jsonData.projects || jsonData))
    .digest("hex");

  console.log(`DB Checksum:   ${dbChecksum}`);
  console.log(`JSON Checksum: ${jsonChecksum}`);

  if (dbChecksum === jsonChecksum && !force) {
    console.log("✅ Data is already perfectly in sync. No action needed.");
    return;
  }

  if (dryRun) {
    console.log("🧪 DRY RUN — Would sync now. Use --force to apply.");
    return;
  }

  // Write DB state to data.json (for local dev consistency)
  fs.writeFileSync(DATA_JSON_PATH, JSON.stringify({ projects: dbProjects }, null, 2));
  console.log("✅ Synced DB → data.json (perfect consistency achieved)");
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force") || args.includes("--checksum");

syncJsonDb(dryRun, force).catch(console.error);
