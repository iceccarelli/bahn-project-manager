import fs from "node:fs/promises";
import path from "node:path";
import { getDb } from "./db";
import { projects } from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { SYNC_VERSION, DATA_JSON_PATH } from "@shared/const";

/**
 * Real-time / scheduled sync between client/public/data.json and DB.
 * Call this from a cron job, webhook, or on server start.
 * Compares syncVersion and only re-seeds changed projects.
 */
export async function syncDataJsonToDb(options: { force?: boolean; dryRun?: boolean } = {}) {
  const { force = false, dryRun = false } = options;
  console.log(`🔄 Starting data.json ↔ DB sync (force=${force}, dryRun=${dryRun})`);

  const db = await getDb();
  if (!db) {
    console.warn("[sync-db] Database not available, skipping sync.");
    return { synced: 0, skipped: 0 };
  }

  const dataPath = path.resolve(process.cwd(), DATA_JSON_PATH);
  const raw = await fs.readFile(dataPath, "utf-8");
  const data = JSON.parse(raw);
  const projectsData: any[] = Array.isArray(data) ? data : data.projects || [];

  let synced = 0;
  let skipped = 0;

  for (const p of projectsData) {
    const [existing] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, p.id))
      .limit(1);

    if (!force && existing && existing.syncVersion === SYNC_VERSION) {
      skipped++;
      continue;
    }

    if (!dryRun) {
      // Upsert the project row
      await db
        .insert(projects)
        .values({
          id: p.id,
          projektnummer: p.projektnummer ?? null,
          bahnhofsmanagement: p.bahnhofsmanagement ?? null,
          station: p.station ?? null,
          bahnhofsnummer: p.bahnhofsnummer ?? null,
          streckennummer: p.streckennummer ?? null,
          projektbeschreibung: p.projektbeschreibung ?? null,
          projektstand: p.projektstand ?? null,
          projektleiter: p.projektleiter ?? null,
          terminProjektvorstellung: p.terminProjektvorstellung ?? null,
          kommentar: p.kommentar ?? null,
          projektLink: p.projektLink ?? null,
          syncVersion: SYNC_VERSION,
        })
        .onDuplicateKeyUpdate({
          set: {
            projektnummer: p.projektnummer ?? null,
            station: p.station ?? null,
            projektstand: p.projektstand ?? null,
            projektleiter: p.projektleiter ?? null,
            syncVersion: SYNC_VERSION,
          },
        });
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
  const db = await getDb();
  if (!db) {
    return { dbCount: 0, jsonCount: 0, version: SYNC_VERSION, inSync: false };
  }

  const [countRow] = await db.select({ count: sql<number>`count(*)` }).from(projects);
  const totalDb = countRow?.count ?? 0;
  const data = JSON.parse(await fs.readFile(path.resolve(process.cwd(), DATA_JSON_PATH), "utf-8"));
  const totalJson = Array.isArray(data) ? data.length : (data.projects?.length || 0);

  return {
    dbCount: totalDb,
    jsonCount: totalJson,
    version: SYNC_VERSION,
    inSync: totalDb === totalJson,
  };
}
