import { describe, expect, it } from "vitest";
import { importWorkbookSheets } from "../itk/pruefbericht-import";
import { H2020, row2020 } from "../itk/testing";
import { eligibleReports, needsChoice, protocolReference, referenceOf, selectReport, technikMatches, type AbnahmeReport } from "./pruefbericht";

const reports = importWorkbookSheets([{
  name: "2025",
  rows: [[...H2020],
    row2020("25.001", { bauform: "ZIM", bahnhof: "Alpha", taetigkeit: "fachtechnische Prüfung EP" }),
    row2020("25.002", { bauform: "ZIM", bahnhof: "Alpha", taetigkeit: "Abnahmeprüfung" }),
    row2020("25.003", { bauform: "Video", bahnhof: "Alpha" }),
    row2020("25.004", { bauform: "ELA AN2", bahnhof: "Alpha" }),
    row2020("25.005", { bauform: "-", bahnhof: "Alpha" }),
  ],
}]).records.map((r, i) => ({ ...r, id: i + 1, technikArt: r.bauformBezeichnung === "-" ? null : r.bauformBezeichnung })) as AbnahmeReport[];

describe("Abnahme ↔ Prüfbericht", () => {
  it("offers only reports of this Technik (and those whose Technik is unknown, labelled by the UI)", () => {
    expect(eligibleReports("ZIM", reports).map((r) => r.laufendeNummer)).toEqual(["25.001", "25.002", "25.005"]);
    expect(eligibleReports("Video", reports).map((r) => r.laufendeNummer)).toEqual(["25.003", "25.005"]);
    expect(eligibleReports("ELA", reports).map((r) => r.laufendeNummer)).toEqual(["25.004", "25.005"]);
    expect(eligibleReports("dBOS", reports).map((r) => r.laufendeNummer)).toEqual(["25.005"]);
    expect(technikMatches("DSA+", "DSA")).toBe(false);
  });

  it("zero → none; one → single; several → the user must choose, and nothing is preselected", () => {
    expect(selectReport([], null)).toEqual({ status: "none" });
    expect(selectReport([reports[2]!], null)).toMatchObject({ status: "single", report: { laufendeNummer: "25.003" } });
    const several = eligibleReports("ZIM", reports);
    const s = selectReport(several, null);
    expect(s.status).toBe("choose");
    expect(needsChoice(s)).toBe(true);
    expect(selectReport(several, 2)).toMatchObject({ status: "chosen", report: { laufendeNummer: "25.002" } });
    // a stale choice (not among the eligible ones) is not honoured
    expect(selectReport(several, 3).status).toBe("choose");
  });

  it("the reference carries the running number and the canonical derived PDF-Code, not the workbook text", () => {
    const stored = { ...reports[1]!, beschriftung: "irgendein anderer Text" } as AbnahmeReport;
    expect(referenceOf(stored)).toEqual({ year: 2025, laufendeNummer: "25.002", pdfCode: "A25.002 - Alpha" });
  });

  it("the protocol reference: nothing for none/unchosen, the number and the DERIVED code for one/chosen — year-specific formulas included", () => {
    expect(protocolReference(null)).toBeNull();
    expect(protocolReference({ status: "none" })).toBeNull();
    const several = eligibleReports("ZIM", reports);
    expect(protocolReference(selectReport(several, null))).toBeNull(); // must choose first: no reference, and the PDF button is disabled
    expect(protocolReference(selectReport(several, 2))).toEqual({ nummer: "25.002 (2025)", pdfCode: "A25.002 - Alpha" });
    expect(protocolReference(selectReport([reports[2]!], null))).toEqual({ nummer: "25.003 (2025)", pdfCode: "P25.003 - Alpha" });
    // the 2018 sheet's formula is a different one (yyyymmdd-NNN …); the reference follows the report's own year
    const legacy = { id: 90, year: 2018, laufendeNummer: "814", layout: "2018-2019", datum: null, bahnhofStrecke: "Betzdorf(Sieg)", technik: "ELA", projektname: null, phase: "Fertigstellung", abschlusstermin: null, taetigkeitsbereich: null, bauformBezeichnung: null, beschriftung: null, technikArt: "ELA" } as unknown as AbnahmeReport;
    expect(protocolReference(selectReport([legacy], null))?.nummer).toBe("814 (2018)");
  });
});
