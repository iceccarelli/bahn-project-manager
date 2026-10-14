import { describe, expect, it } from "vitest";
import { derivePdfCode, samePdfCode } from "./pdf-code";
import { edgeCaseReportSheets } from "./edge-fixtures";
import { importWorkbookSheets } from "./pruefbericht-import";

describe("Prüfbericht edge-case fixtures reproduce what was measured on the real workbook", () => {
  it("the reports: odd Technik values are reported not rewritten; year-specific formulas; the deviating stored code is flagged", () => {
    const res = importWorkbookSheets(edgeCaseReportSheets("G.TEST"));
    expect(Object.keys(res.report.vocabulary.technikUnknown).sort()).toEqual(["Rückbau", "ZIM ELA", "ZIM/ElA"]);
    expect(res.records.map((r) => r.laufendeNummer).filter((n) => n.startsWith("25.010"))).toEqual(["25.010", "25.010/2"]);
    const by = (nr: string) => res.records.find((r) => r.laufendeNummer === nr)!;
    expect(derivePdfCode(by("814"))).toMatch(/^20180205-814 Betzdorf\(Sieg\) ELA Fertigstellung$/); // the 2018 formula (stored 20180131 deviates)
    expect(samePdfCode(by("814").beschriftung, derivePdfCode(by("814")))).toBe(false);
    expect(derivePdfCode(by("901"))).toContain("901");                                                  // the 2019 formula
    expect(derivePdfCode(by("22.001"))).toBe("P22.001 - Beispieldorf");
    expect(samePdfCode(by("22.001").beschriftung, derivePdfCode(by("22.001")))).toBe(false);          // stored "A22.001": drift is shown, not normalised
  });
});
