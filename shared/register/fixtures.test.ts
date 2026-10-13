import { describe, expect, it } from "vitest";
import { EDGE_CASE_REGISTER, edgeCaseRegisterSheet } from "./fixtures";
import { analyzeSource, parseRegisterWorkbook } from "./register-import";
import { planRegister, summarizePlan } from "./register-plan";

describe("register edge-case fixtures reproduce what was measured on the real workbook", () => {
  const parsed = parseRegisterWorkbook([edgeCaseRegisterSheet()]);
  const source = analyzeSource(parsed.records);

  it("the register: repeated numbers, no number, undecidable groups, odd dates and statuses", () => {
    expect(parsed.report.rows).toBe(EDGE_CASE_REGISTER.rows);
    expect(parsed.report.withoutProjektnummer).toBe(EDGE_CASE_REGISTER.withoutProjektnummer);
    expect(parsed.report.repeatedProjektnummern).toBeGreaterThanOrEqual(2);
    expect(parsed.records.filter((r) => r.fields.projektnummer === "G.F0001")).toHaveLength(11);
    expect(source.heldDuplicates).toHaveLength(EDGE_CASE_REGISTER.heldGroups);
    expect(source.identicalDropped).toHaveLength(EDGE_CASE_REGISTER.identicalDropped);
    expect(parsed.report.issues.filter((i) => i.kind === "date-unparseable")).toHaveLength(EDGE_CASE_REGISTER.unparseableDates);
    expect(parsed.report.unknownStatuses.map((u) => [u.value, u.department]).sort()).toEqual([["Protokoll erstellt", "TBQ"], ["planungsbegleitend", "UM"]]);
    // vocabulary variants are kept as written, lots collapse to the Bahnhofsmanagement, placeholders are empty
    const byStation = (s: string) => parsed.records.find((r) => r.fields.station === s)!;
    expect(byStation("Statusfall").reviews.EEA?.status).toBe("Niederschrift erstellt (LP05-05-01-F31)");
    expect(byStation("Statusfall").reviews.ITK?.status).toBe("Projektkonfiguration");
    expect([byStation("Los 1"), byStation("Los 2"), byStation("Los 3")].map((r) => r.fields.bahnhofsmanagement)).toEqual(["Darmstadt", null, null]);
    expect(byStation("Datumsfall 4").fields.terminProjektvorstellung).toBe("2026-02-17");
  });

  it("planned against an empty database: the undecidable groups become explicit questions, nothing is merged", () => {
    const plan = planRegister(source.forPlanning, []);
    const s = summarizePlan(plan);
    expect(s.ambiguous).toBe(4); // 2 groups × 2 rows
    expect(s.add).toBe(parsed.records.length - source.identicalDropped.length - 4);
    expect(plan.filter((p) => p.sourceRows).map((p) => p.sourceDiff?.map((d) => d.key))).toEqual([
      ["review.ITK.status", "review.ITK.datum"], ["review.ITK.status", "review.ITK.datum"], ["kommentar"], ["kommentar"],
    ]);
  });
});
