import { describe, expect, it } from "vitest";
import { importWorkbookSheets } from "./itk/pruefbericht-import";
import { indexProjects, matchPruefbericht } from "./itk/project-link";
import { edgeCaseRegisterSheet, edgeCaseReportSheets } from "./link-fixtures";
import { analyzeSource, parseRegisterWorkbook } from "./register/register-import";

describe("the link rule on the paired edge-case fixtures", () => {
  const source = analyzeSource(parseRegisterWorkbook([edgeCaseRegisterSheet()]).records);
  it("the link rule on these reports: unique through spelling, ambiguous across phases, and every other kind of 'no' with its reason", () => {
    const reports = importWorkbookSheets(edgeCaseReportSheets()).records;
    const idx = indexProjects(source.accepted.map((r) => ({ id: r.ref, projektnummer: r.fields.projektnummer, station: r.fields.station })));
    const verdict = (nr: string) => matchPruefbericht(reports.find((r) => r.laufendeNummer === nr)!, idx);
    expect(verdict("25.001").status).toBe("unique");
    expect(verdict("25.002").status).toBe("unique");
    expect(verdict("25.003")).toMatchObject({ status: "ambiguous" });
    expect(verdict("25.004")).toMatchObject({ status: "unmatched", reason: "station-passt-nicht" });
    expect(verdict("25.005")).toMatchObject({ status: "unmatched", reason: "keine-projektnummer" });
    expect(verdict("25.007")).toMatchObject({ status: "unmatched", reason: "projektnummer-unbekannt" });
    expect(verdict("25.008").status).toBe("unique");
  });
});
