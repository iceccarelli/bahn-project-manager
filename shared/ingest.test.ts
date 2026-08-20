import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { cleanStr, describeIngest, ingestProjects } from "./ingest";

const raw = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../client/public/data.json"), "utf-8"),
);

describe("ingestProjects", () => {
  it("accepts all 1,298 production rows with nothing rejected", () => {
    const r = ingestProjects(raw);
    expect(r.projects).toHaveLength(1298);
    expect(r.rejected).toEqual([]);
    expect(r.clean).toBe(true);
  });

  it("accepts both the bare array and the { projects } envelope", () => {
    const rows = Array.isArray(raw) ? raw : raw.projects;
    expect(ingestProjects(rows).projects).toHaveLength(1298);
    expect(ingestProjects({ projects: rows }).projects).toHaveLength(1298);
  });

  it("keeps fields the schema does not declare, instead of stripping them", () => {
    // Zod's z.object drops undeclared keys. Normalising Zod's output rather
    // than the original row would be silent data loss wearing a validation hat.
    const r = ingestProjects([{ id: 1, reviews: [], eigeneSpalte: "behalten" }]);
    expect(r.projects[0]).toHaveProperty("eigeneSpalte", "behalten");
  });

  it("reports a bad row rather than dropping or admitting it silently", () => {
    const r = ingestProjects([
      { id: 1, reviews: [] },
      { id: 2, projektnummer: 12345, reviews: [] }, // number, not string
      "nicht einmal ein Objekt",
    ]);
    expect(r.projects).toHaveLength(1);
    expect(r.rejected).toHaveLength(2);
    expect(r.clean).toBe(false);
    expect(r.rejected[0]?.id).toBe(2);
    expect(r.rejected[0]?.reason).toContain("projektnummer");
    expect(r.rejected[1]?.reason).toContain("not an object");
  });

  it("canonicalises Bahnhofsmanagement and never guesses", () => {
    const r = ingestProjects([
      { id: 1, bahnhofsmanagement: "Frankfurt a. M.", reviews: [] },
      { id: 2, bahnhofsmanagement: "Koblenz LOS 2", reviews: [] },
      { id: 3, bahnhofsmanagement: "Irgendwo Unbekanntes", reviews: [] },
    ]);
    expect(r.projects[0]?.bahnhofsmanagement).toBe("Frankfurt");
    expect(r.projects[1]?.bahnhofsmanagement).toBe("Koblenz");
    expect(r.projects[2]?.bahnhofsmanagement).toBeNull();
  });

  it("treats workbook placeholders as absent, not as text", () => {
    for (const p of ["", "-", "???", "Bitte auswählen", "n/a"]) {
      expect(cleanStr(p), `"${p}" should be null`).toBeNull();
    }
    expect(cleanStr("  Frankfurt   Hbf ")).toBe("Frankfurt Hbf");
  });

  it("returns empty rather than throwing on junk input", () => {
    for (const junk of [null, undefined, 42, "text", {}]) {
      expect(ingestProjects(junk).projects).toEqual([]);
    }
  });

  it("says the rejected count out loud", () => {
    const clean = ingestProjects([{ id: 1, reviews: [] }]);
    expect(describeIngest(clean)).toBe("1 Projekte geladen");
    const dirty = ingestProjects([{ id: 1, reviews: [] }, 7]);
    expect(describeIngest(dirty)).toContain("1 verworfen");
  });
});
