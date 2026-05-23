#!/usr/bin/env tsx
/**
 * Perfect round-trip seed script: client/public/data.json → Drizzle MySQL.
 * 
 * Features:
 * - Idempotent upserts (project + reviews)
 * - Zod validation against shared types
 * - Sync version tracking for change detection
 * - Audit logging of all inserts/updates
 * - Progress logging + error handling for 1,298+ projects
 * - Can be run via `pnpm seed:json` or `tsx drizzle/seed-from-json.ts`
 * 
 * Usage:
 *   pnpm seed:json                 # full seed
 *   pnpm seed:json --dry-run       # validate only
 *   pnpm seed:json --project 42    # seed single project (dev)
 */

import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ProjectUISchema, ReviewSchema, type ProjectUI, type Review, DEPARTMENTS } from "../shared/types";
import { projects, departmentReviews, auditLog } from "./schema";
import { eq } from "drizzle-orm";
import { SYNC_VERSION, DATA_JSON_PATH } from "../shared/const";

const DRY_RUN = process.argv.includes("--dry-run");
const SINGLE_PROJECT = process.argv.find(a => a.startsWith("--project="))?.split("=")[1];

async function main() {
  console.log("🌱 Starting perfect data.json → DB seed (sync v" + SYNC_VERSION + ")");

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL env var required");
  }

  const connection = await mysql.createConnection(dbUrl);
  const db = drizzle(connection, { schema: { projects, departmentReviews, auditLog } });

  // Load and parse data.json (supports both array root or {projects: []})
  const dataPath = path.resolve(process.cwd(), DATA_JSON_PATH);
  const raw = await fs.readFile(dataPath, "utf-8");
  const parsed = JSON.parse(raw);
  let projectsData: any[] = Array.isArray(parsed) ? parsed : parsed.projects || [];

  if (SINGLE_PROJECT) {
    projectsData = projectsData.filter((p: any) => String(p.id) === SINGLE_PROJECT);
    console.log(`🔍 Filtering to single project id=${SINGLE_PROJECT}`);
  }

  console.log(`📦 Loaded ${projectsData.length} projects from ${DATA_JSON_PATH}`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const rawProject of projectsData) {
    try {
      // Normalize to ProjectUI shape (reviews as array)
      const normalized: ProjectUI = {
        id: Number(rawProject.id),
        originalRowIndex: rawProject.originalRowIndex ?? null,
        projektnummer: rawProject.projektnummer ?? null,
        bahnhofsmanagement: rawProject.bahnhofsmanagement ?? null,
        station: rawProject.station ?? null,
        bahnhofsnummer: rawProject.bahnhofsnummer ?? null,
        streckennummer: rawProject.streckennummer ?? null,
        projektbeschreibung: rawProject.projektbeschreibung ?? null,
        projektstand: rawProject.projektstand ?? null,
        eigvEinstufung: rawProject.eigvEinstufung ?? null,
        projektleiter: rawProject.projektleiter ?? null,
        terminProjektvorstellung: rawProject.terminProjektvorstellung ?? null,
        kommentar: rawProject.kommentar ?? null,
        projektLink: rawProject.projektLink ?? null,
        reviews: (rawProject.reviews || []).map((r: any, idx: number) => ({
          department: (r.department || DEPARTMENTS[idx]) as any, // fallback
          status: r.status ?? null,
          prueferName: r.prueferName ?? null,
          pruefDatum: r.pruefDatum ?? null,
        })),
        createdAt: rawProject.createdAt ?? null,
        updatedAt: rawProject.updatedAt ?? null,
      };

      // Validate with Zod
      const validated = ProjectUISchema.parse(normalized);

      // Check existing
      const existing = await db.query.projects.findFirst({
        where: eq(projects.id, validated.id),
        with: { reviews: true },
      });

      const projectData = {
        originalRowIndex: validated.originalRowIndex,
        fullRowData: rawProject, // keep raw for fidelity
        projektnummer: validated.projektnummer,
        bahnhofsmanagement: validated.bahnhofsmanagement,
        station: validated.station,
        bahnhofsnummer: validated.bahnhofsnummer,
        streckennummer: validated.streckennummer,
        projektbeschreibung: validated.projektbeschreibung,
        projektstand: validated.projektstand,
        eigvEinstufung: validated.eigvEinstufung,
        projektleiter: validated.projektleiter,
        terminProjektvorstellung: validated.terminProjektvorstellung ? new Date(validated.terminProjektvorstellung) : null,
        kommentar: validated.kommentar,
        projektLink: validated.projektLink,
        syncVersion: SYNC_VERSION,
      };

      if (DRY_RUN) {
        console.log(`✅ [dry] Would upsert project ${validated.id} (${validated.station})`);
        skipped++;
        continue;
      }

      if (existing) {
        // Update project
        await db.update(projects)
          .set({ ...projectData, updatedAt: new Date() })
          .where(eq(projects.id, validated.id));

        // Delete old reviews and re-insert (simpler than diff for seed)
        await db.delete(departmentReviews).where(eq(departmentReviews.projectId, validated.id));

        updated++;
      } else {
        await db.insert(projects).values({ id: validated.id, ...projectData });
        inserted++;
      }

      // Insert reviews (always fresh for seed)
      if (validated.reviews.length > 0) {
        const reviewInserts = validated.reviews.map((r: Review) => ({
          projectId: validated.id,
          department: r.department,
          prueferName: r.prueferName,
          datum: r.pruefDatum ? new Date(r.pruefDatum) : null,
          status: r.status,
        }));
        await db.insert(departmentReviews).values(reviewInserts);
      }

      // Audit
      await db.insert(auditLog).values({
        userId: 0, // system
        userName: "seed-from-json",
        entityType: "project",
        entityId: validated.id,
        action: existing ? "update" : "insert",
        field: "sync",
        oldValue: existing ? JSON.stringify({ syncVersion: existing.syncVersion }) : null,
        newValue: JSON.stringify({ syncVersion: SYNC_VERSION }),
      });

      if ((inserted + updated) % 100 === 0) {
        console.log(`  ... processed ${inserted + updated} / ${projectsData.length}`);
      }
    } catch (err: any) {
      errors++;
      console.error(`❌ Error on project ${rawProject.id} (${rawProject.station}):`, err.message);
      if (errors > 5) {
        console.error("Too many errors, aborting.");
        break;
      }
    }
  }

  console.log(`
✅ Seed complete!
   Inserted: ${inserted}
   Updated:  ${updated}
   Skipped (dry): ${skipped}
   Errors:   ${errors}
   Total processed: ${inserted + updated + skipped + errors}
`);

  await connection.end();
}

main().catch((e) => {
  console.error("Fatal seed error:", e);
  process.exit(1);
});
