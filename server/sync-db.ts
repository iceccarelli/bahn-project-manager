import fs from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import { projects } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { SYNC_VERSION, DATA_JSON_PATH } from "@shared/const";
import { seedFromJson } from "../drizzle/seed-from-json"; // re-use the heavy lifting

/**
 * Real-time / scheduled sync between client/public/data.json and DB.
 * Call this from a cron job, webhook, or on server start.
 * Compares syncVersion and only re-seeds changed projects.
 */
export async function syncDataJsonToDb(options: { force?: boolean; dryRun?: boolean } = {}) {
  const { force = false, dryRun = false } = options;
  console.log(`🔄 Starting data.json ↔ DB sync (force=${force}, dryRun=${dryRun})`);

  const dataPath = path.resolve(process.cwd(), DATA_JSON_PATH);
  const raw = await fs.readFile(dataPath, "utf-8");
  const data = JSON.parse(raw);
  const projectsData = Array.isArray(data) ? data : data.projects || [];

  let synced = 0;
  let skipped = 0;

  for (const p of projectsData) {
    const existing = await db.query.projects.findFirst({
      where: eq(projects.id, p.id),
    });

    if (!force && existing?.syncVersion === SYNC_VERSION) {
      skipped++;
      continue;
    }

    if (!dryRun) {
      // Delegate to the full seed logic (idempotent upsert + reviews + audit)
      await seedFromJson([p]); // pass single project subset if supported, else full re-seed is fine for small dataset
    }
    synced++;
  }

  console.log(`✅ Sync complete — synced: ${synced}, skipped (up-to-date): ${skipped}`);
  return { synced, skipped };
}

/**
 * Quick health check for CI / monitoring
 */
export async function getSyncHealth() {
  const [{ count: totalDb }] = await db.select({ count: sql`count(*)` }).from(projects);
  const data = JSON.parse(await fs.readFile(path.resolve(process.cwd(), DATA_JSON_PATH), "utf-8"));
  const totalJson = Array.isArray(data) ? data.length : (data.projects?.length || 0);

  return {
    dbCount: totalDb,
    jsonCount: totalJson,
    version: SYNC_VERSION,
    inSync: totalDb === totalJson,
  };
}
