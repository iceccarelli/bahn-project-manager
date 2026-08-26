import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { buildReel, type ReelAuditEntry } from "./gewerk-reel";
import { DEPARTMENT_LIST } from "./validation";
import { normalizeReviewStatus } from "./review-status";
import { toDate } from "./date";

const DATA = JSON.parse(fs.readFileSync("client/public/data.json", "utf8")) as {
  projects: Array<Record<string, unknown>>;
};
const PROJECTS = DATA.projects as never;

const auditEntry = (over: Partial<ReelAuditEntry> = {}): ReelAuditEntry => ({
  id: "a1",
  timestamp: "2026-08-24T09:15:00.000Z",
  user: "I. Ceccarelli",
  action: "Status geändert",
  details: "EEA: offen → zugestimmt",
  meta: { projektnummer: "P-0001", station: "Fulda", department: "EEA" },
  ...over,
});

describe("a card plays records, never a summary of them", () => {
  it("plays something for every one of the fourteen Gewerke, or says why not", () => {
    for (const department of DEPARTMENT_LIST) {
      const reel = buildReel(PROJECTS, [], department);
      // Either there are entries, or the department genuinely has no dated,
      // required row — and the card renders a sentence saying so.
      const dated = (DATA.projects as Array<{ reviews?: Array<Record<string, unknown>> }>).some(
        (p) =>
          (p.reviews ?? []).some((r) => {
            if (r.department !== department) return false;
            const s = normalizeReviewStatus(r.status as string);
            return s !== null && s !== "nicht erforderlich" && toDate(r.pruefDatum) !== null;
          }),
      );
      expect(reel.length > 0, department).toBe(dated);
    }
  });

  it("never plays a row from another Gewerk", () => {
    const rows = (DATA.projects as Array<{ reviews?: Array<Record<string, unknown>> }>).flatMap(
      (p) => p.reviews ?? [],
    );
    const eeaWhere = new Set(
      (DATA.projects as Array<{ id: number; station?: string; projektnummer?: string; reviews?: Array<Record<string, unknown>> }>)
        .filter((p) => (p.reviews ?? []).some((r) => r.department === "EEA"))
        .map((p) => p.station || p.projektnummer || `Projekt ${p.id}`),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const entry of buildReel(PROJECTS, [], "EEA")) {
      expect(eeaWhere.has(entry.where)).toBe(true);
    }
  });

  it("orders the stored rows newest first", () => {
    const reel = buildReel(PROJECTS, [], "EEA");
    const times = reel.map((e) => Date.parse(e.when));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("puts this session's changes ahead of anything on file, and labels both", () => {
    const reel = buildReel(PROJECTS, [auditEntry()], "EEA");
    expect(reel[0]?.source).toBe("historie");
    expect(reel[0]?.what).toContain("Status geändert");
    expect(reel.slice(1).every((e) => e.source === "bestand")).toBe(true);
  });

  it("ignores changes made to a different Gewerk", () => {
    const reel = buildReel(PROJECTS, [auditEntry({ meta: { department: "ITK" } })], "EEA");
    expect(reel.every((e) => e.source === "bestand")).toBe(true);
  });

  it("never exceeds the limit it was given", () => {
    expect(buildReel(PROJECTS, [], "EEA", 3)).toHaveLength(3);
    const many = Array.from({ length: 12 }, (_, i) => auditEntry({ id: `a${i}` }));
    expect(buildReel(PROJECTS, many, "EEA", 4)).toHaveLength(4);
  });

  it("gives every entry a distinct key, so a cross-fade cannot drop one", () => {
    const reel = buildReel(PROJECTS, [auditEntry()], "EEA");
    expect(new Set(reel.map((e) => e.id)).size).toBe(reel.length);
  });

  it("never invents a date: an undated row is left out rather than placed", () => {
    const undated = [
      {
        id: 99_001,
        station: "Teststation",
        reviews: [{ department: "EEA", status: "offen", pruefDatum: null }],
      },
    ] as never;
    expect(buildReel(undated, [], "EEA")).toHaveLength(0);
  });

  it("leaves out rows this Gewerk is not required on", () => {
    const notRequired = [
      {
        id: 99_002,
        station: "Teststation",
        reviews: [{ department: "EEA", status: "nicht erforderlich", pruefDatum: "2026-08-01" }],
      },
    ] as never;
    expect(buildReel(notRequired, [], "EEA")).toHaveLength(0);
  });
});
