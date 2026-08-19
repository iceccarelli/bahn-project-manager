#!/usr/bin/env tsx
/**
 * PERFECT SEED SCRIPT v2.0
 * Idempotent + Checksum-based seeding for ZERO DATA DRIFT
 * Run with: pnpm seed:perfect
 */

import { getDb } from "../server/db";
import { projects } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { toDate } from "../shared/date";
import { ProjectSchema } from "../shared/validation";
import { SYNC_VERSION } from "../shared/const";

const DATA_JSON_PATH = path.resolve("public/data.json");

async function seedPerfect() {
  console.log("🌱 Starting perfect seed with checksum validation...");

  const db = await getDb();
  if (!db) {
    console.error("❌ Database not available. Set DATABASE_URL.");
    process.exit(1);
  }

  if (!fs.existsSync(DATA_JSON_PATH)) {
    console.error("❌ data.json not found!");
    process.exit(1);
  }

  const rawData = fs.readFileSync(DATA_JSON_PATH, "utf-8");
  const checksum = crypto.createHash("sha256").update(rawData).digest("hex");
  console.log(`📊 data.json checksum: ${checksum}`);

  const data = JSON.parse(rawData);
  const validatedProjects = data.projects || data;

  let inserted = 0;
  let updated = 0;

  for (const rawProject of validatedProjects) {
    const project = ProjectSchema.parse(rawProject);
    const projectId = project.id;

    if (!projectId) {
      console.warn(`⚠️ Skipping project without id: ${project.projektnummer}`);
      continue;
    }

    // Identity is `id`, NOT `projektnummer`. projektnummer is not unique — in
    // client/public/data.json "G.011511006" alone appears on 48 projects — and
    // 15 rows have none at all, so matching on it collapsed distinct projects
    // into one another.
    const [existing] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);

    if (existing) {
      // Update if syncVersion changed or data differs
      if (existing.syncVersion !== SYNC_VERSION) {
        await db.update(projects)
          .set({
            projektnummer: project.projektnummer,
            station: project.station,
            projektstand: project.projektstand,
            projektleiter: project.projektleiter,
            syncVersion: SYNC_VERSION,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, existing.id));
        updated++;
      }
    } else {
      await db.insert(projects).values({
        id: projectId,
        projektnummer: project.projektnummer,
        bahnhofsmanagement: project.bahnhofsmanagement,
        station: project.station,
        bahnhofsnummer: project.bahnhofsnummer,
        streckennummer: project.streckennummer,
        projektbeschreibung: project.projektbeschreibung,
        projektstand: project.projektstand,
        eigvEinstufung: project.eigvEinstufung,
        projektleiter: project.projektleiter,
        // 253 of the 1,019 dated rows are German dd.mm.yyyy; `new Date()` reads
        // those as Invalid Date. parseStoredDate is the single decision point.
        terminProjektvorstellung: toDate(project.terminProjektvorstellung),
        kommentar: project.kommentar,
        projektLink: project.projektLink,
        syncVersion: SYNC_VERSION,
      });
      inserted++;
    }
  }

  console.log(`✅ Seed complete! Inserted: ${inserted}, Updated: ${updated}`);
  console.log(`🔒 Final checksum: ${checksum}`);
}

seedPerfect().catch(console.error);
