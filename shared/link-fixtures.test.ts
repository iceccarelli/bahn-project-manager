import { describe, expect, it } from "vitest";
import { importWorkbookSheets } from "./itk/pruefbericht-import";
import { indexProjects, matchPruefbericht } from "./itk/project-link";
import { edgeCaseRegisterSheet, edgeCaseReportSheets } from "./link-fixtures";
import { analyzeSource, parseRegisterWorkbook } from "./register/register-import";

describe("the link rule on the paired edge-case fixtures", () => {
  const source = analyzeSource(parseRegisterWorkbook([edgeCaseRegisterSheet()]).records);
  it("the link rule: unique through spelling, ambiguous without a stated phase, the stated phase decides — and never crosses phases", () => {
    const reports = importWorkbookSheets(edgeCaseReportSheets()).records;
    const projects = source.accepted.map((r) => ({ id: r.ref, projektnummer: r.fields.projektnummer, station: r.fields.station, projektstand: r.fields.projektstand }));
    const idx = indexProjects(projects);
    const verdict = (nr: string) => matchPruefbericht(reports.find((r) => r.laufendeNummer === nr)!, idx);
    const standOf = (v: ReturnType<typeof verdict>) => (v.status === "unique" ? projects.find((p) => p.id === v.projectId)?.projektstand : undefined);
    expect(verdict("25.001")).toMatchObject({ status: "unique", byPhase: false });
    expect(verdict("25.002").status).toBe("unique");
    expect(verdict("25.003")).toMatchObject({ status: "ambiguous" });   // Alpha has an AP and an EP project; the report states no phase
    expect(standOf(verdict("25.009"))).toBe("EP");                       // "fachtechnische Prüfung EP" → the EP project
    expect(verdict("25.009")).toMatchObject({ status: "unique", byPhase: true });
    expect(standOf(verdict("25.011"))).toBe("AP");
    expect(verdict("25.012")).toMatchObject({ status: "unmatched", reason: "phase-passt-nicht" }); // EP report, only an AP project at Gamma
    expect(verdict("25.004")).toMatchObject({ status: "unmatched", reason: "station-passt-nicht" });
    expect(verdict("25.005")).toMatchObject({ status: "unmatched", reason: "keine-projektnummer" });
    expect(verdict("25.007")).toMatchObject({ status: "unmatched", reason: "projektnummer-unbekannt" });
    expect(verdict("25.008").status).toBe("unique");
    expect(standOf(verdict("22.001"))).toBe("EP");                       // default Tätigkeit of the 2020+ test rows is "… EP"
  });
});
