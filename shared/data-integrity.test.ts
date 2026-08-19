/**
 * Regression tests over the real shipped dataset.
 *
 * These run without a DATABASE_URL, which is what makes them different from the
 * six skipped server tests: they exercise the data and the schemas that actually
 * reach users, so a regression in either fails the build.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BAHNHOFSMANAGEMENT } from "./bahnhofsmanagement";
import { parseStoredDate } from "./date";
import { normalizeReviewStatus } from "./review-status";
import { DEPARTMENTS, ProjectSchema } from "./validation";

const ROOT = path.resolve(import.meta.dirname, "..");
const data = JSON.parse(
  fs.readFileSync(path.join(ROOT, "client", "public", "data.json"), "utf8"),
) as {
  projects: Array<Record<string, unknown> & { reviews: Array<Record<string, unknown>> }>;
  stats: { regionStats: Array<{ region: string; count: number }> };
  filters: { regions: string[] };
};
const stations = JSON.parse(
  fs.readFileSync(path.join(ROOT, "client", "public", "stations.json"), "utf8"),
) as Array<{ BM: string; Station: string; "Bf. Nr.": number; retired?: true }>;

describe("data.json shape", () => {
  it("holds 1,298 projects and 18,172 reviews", () => {
    expect(data.projects).toHaveLength(1298);
    expect(data.projects.reduce((n, p) => n + p.reviews.length, 0)).toBe(18172);
  });

  it("gives every project exactly the 14 departments, once each", () => {
    for (const p of data.projects) {
      const depts = p.reviews.map((r) => r.department as string);
      expect(depts).toHaveLength(14);
      expect(new Set(depts).size).toBe(14);
      expect([...depts].sort()).toEqual([...DEPARTMENTS].sort());
    }
  });

  it("has unique project ids", () => {
    const ids = data.projects.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("validates every row against ProjectSchema", () => {
    // Before Stage 2 this rejected almost every row: projektnummer was required
    // (15 are null), projektstand was an 18-value enum (81 values exist) and
    // projektLink demanded a URL.
    const failures = data.projects
      .map((p) => ({ id: p.id, result: ProjectSchema.safeParse(p) }))
      .filter((r) => !r.result.success);
    expect(failures).toHaveLength(0);
  });
});

describe("canonical vocabularies", () => {
  it("uses only canonical Bahnhofsmanagement values", () => {
    const bad = new Set<string>();
    for (const p of data.projects) {
      const bm = p.bahnhofsmanagement as string | null;
      if (bm !== null && !(BAHNHOFSMANAGEMENT as readonly string[]).includes(bm)) bad.add(bm);
    }
    expect([...bad]).toEqual([]);
  });

  it("maps every stored review status onto the canonical vocabulary", () => {
    const bad = new Set<string>();
    for (const p of data.projects) {
      for (const r of p.reviews) {
        const s = r.status as string | null;
        if (s && normalizeReviewStatus(s) === null) bad.add(s);
      }
    }
    expect([...bad]).toEqual([]);
  });

  it("keeps the derived blocks in step with the rows", () => {
    const counts = new Map<string, number>();
    for (const p of data.projects) {
      const bm = p.bahnhofsmanagement as string | null;
      if (bm) counts.set(bm, (counts.get(bm) ?? 0) + 1);
    }
    expect([...data.filters.regions].sort()).toEqual([...counts.keys()].sort());
    for (const { region, count } of data.stats.regionStats) {
      expect(count).toBe(counts.get(region));
    }
  });
});

describe("dates", () => {
  it("parses every terminProjektvorstellung or explains why not", () => {
    const reasons = new Map<string, number>();
    for (const p of data.projects) {
      const r = parseStoredDate(p.terminProjektvorstellung);
      reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
    }
    // No German-format values may remain: Stage 2 converted all 253 to ISO.
    expect(reasons.get("german") ?? 0).toBe(0);
    // Everything that carries a date is ISO; the rest is empty or explicitly odd.
    const unusable = (reasons.get("ambiguous") ?? 0) + (reasons.get("unrecognised") ?? 0);
    expect(unusable).toBeLessThanOrEqual(7);
    expect(reasons.get("invalid-date") ?? 0).toBe(0);
  });
});

describe("stations.json", () => {
  it("uses only canonical Bahnhofsmanagement values", () => {
    const bad = new Set(
      stations.map((s) => s.BM).filter((bm) => !(BAHNHOFSMANAGEMENT as readonly string[]).includes(bm)),
    );
    expect([...bad]).toEqual([]);
  });

  it("keeps (BM, Station) unique among selectable stations", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const s of stations) {
      if (s.retired) continue;
      const key = `${s.BM}␟${s.Station}`;
      if (seen.has(key)) dupes.push(key);
      seen.add(key);
    }
    expect(dupes).toEqual([]);
  });

  it("has unique Bf. Nr.", () => {
    const nrs = stations.map((s) => s["Bf. Nr."]);
    expect(new Set(nrs).size).toBe(nrs.length);
  });
});
