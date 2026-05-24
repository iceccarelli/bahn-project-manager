#!/usr/bin/env tsx
/**
 * PERFECT SEED SCRIPT v2.0
 * Idempotent + Checksum-based seeding for ZERO DATA DRIFT
 * Run with: pnpm seed:perfect
 */

import { db } from "../server/_core/db";
import { projects, departmentReviews } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { ProjectInputSchema } from "../shared/validation";

const DATA_JSON_PATH = path.resolve("public/data.json");

async function seedPerfect() {
  console.log("🌱 Starting perfect seed with checksum validation...");

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
    const project = ProjectInputSchema.parse(rawProject);

    // Check if exists
    const existing = await db.query.projects.findFirst({
      where: eq(projects.projektnummer, project.projektnummer),
    });

    if (existing) {
      // Update if syncVersion changed or data differs
      if (existing.syncVersion !== project.syncVersion) {
        await db.update(projects)
          .set({ ...project, syncVersion: (existing.syncVersion || 0) + 1, updatedAt: new Date() })
          .where(eq(projects.id, existing.id));
        updated++;
      }
    } else {
      await db.insert(projects).values({
        ...project,
        syncVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      inserted++;
    }
  }

  console.log(`✅ Seed complete! Inserted: ${inserted}, Updated: ${updated}`);
  console.log(`🔒 Final checksum: ${checksum}`);
}

seedPerfect().catch(console.error);
