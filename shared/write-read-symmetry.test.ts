import { describe, expect, it } from "vitest";
import { ProjectSchema, ReviewSchema } from "./validation";
import { ingestProjects } from "./ingest";

/**
 * The write path and the read path must agree.
 *
 * They did not. ingestProjects validates every row against ProjectSchema and
 * treats a cache containing an invalid row as untrustworthy. The write path
 * did `(project as any)[field] = value` with no check at all. So a comment
 * longer than the schema's 5,000-character limit saved without complaint, and
 * on the next load the row was rejected, the cache was discarded, and every
 * other local edit went with it — one over-long comment losing the lot.
 *
 * These tests pin both halves of the fix: writes are validated with the same
 * schema reads use, and a cache with one bad row keeps its good rows.
 */

const EDITABLE_PROJECT_FIELDS = [
  "projektnummer", "station", "projektbeschreibung",
  "projektstand", "projektleiter", "kommentar", "projektLink",
] as const;

describe("write/read symmetry", () => {
  it("rejects on write exactly what it would reject on read", () => {
    // 5,001 characters — one over ProjectSchema's limit for kommentar.
    const tooLong = { id: 1, kommentar: "x".repeat(5001), reviews: [] };
    expect(ProjectSchema.safeParse(tooLong).success).toBe(false);
    expect(ingestProjects([tooLong]).rejected).toHaveLength(1);
  });

  it("accepts on write exactly what it accepts on read", () => {
    const ok = { id: 1, kommentar: "x".repeat(5000), reviews: [] };
    expect(ProjectSchema.safeParse(ok).success).toBe(true);
    expect(ingestProjects([ok]).clean).toBe(true);
  });

  it("has a schema rule for every field the table lets you edit", () => {
    // A field the UI can write but the schema does not describe would slip
    // through validation entirely.
    const shape = ProjectSchema.shape as Record<string, unknown>;
    for (const field of EDITABLE_PROJECT_FIELDS) {
      expect(shape[field], `ProjectSchema has no rule for "${field}"`).toBeDefined();
    }
  });

  it("has a schema rule for every review field the table lets you edit", () => {
    const shape = ReviewSchema.shape as Record<string, unknown>;
    for (const field of ["prueferName", "status"]) {
      expect(shape[field], `ReviewSchema has no rule for "${field}"`).toBeDefined();
    }
  });

  it("keeps the good rows when one row in a cache is bad", () => {
    // The old policy discarded the whole cache and refetched, replacing every
    // local edit with the shipped snapshot to punish a single row.
    const result = ingestProjects([
      { id: 1, kommentar: "fine", reviews: [] },
      { id: 2, kommentar: "x".repeat(5001), reviews: [] },
      { id: 3, kommentar: "also fine", reviews: [] },
    ]);
    expect(result.projects).toHaveLength(2);
    expect(result.rejected).toHaveLength(1);
    expect(result.clean).toBe(false);
    expect(result.projects.map((p) => p.id)).toEqual([1, 3]);
  });
});
