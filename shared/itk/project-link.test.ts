import { describe, expect, it } from "vitest";
import { indexProjects, matchPruefbericht, reportPhase, type LinkProject } from "./project-link";

const P = (id: number, projektnummer: string | null, station: string | null): LinkProject => ({ id, projektnummer, station });
const projects = [
  P(1, "G.TEST0001", "Musterstadt (Main) Marktplatz"),
  P(2, "G.TEST0001", "Beispieldorf (Taunus)"),
  P(3, "G.TEST0002", "Testhausen Hbf"),
  P(4, "G.TEST0002", "Testhausen Hbf"), // a second registration at the same station
  P(5, null, "Testhausen Hbf"),
];
const idx = indexProjects(projects);
const m = (projektnummer: string | null, bahnhofStrecke: string | null) => matchPruefbericht({ projektnummer, bahnhofStrecke }, idx);

describe("matchPruefbericht", () => {
  it("links on Projektnummer AND station when exactly one project has both — spelling of the station is not evidence", () => {
    expect(m("G.TEST0001", "Musterstadt Marktplatz")).toEqual({ status: "unique", projectId: 1, byPhase: false });
    expect(m("g. TEST0001", "Beispieldorf (Taunus)")).toEqual({ status: "unique", projectId: 2, byPhase: false });
    expect(m("G.TEST0002", "testhausen hauptbahnhof")).toMatchObject({ status: "ambiguous" });
  });

  it("is ambiguous when several projects carry both, and names them all", () => {
    expect(m("G.TEST0002", "Testhausen Hbf")).toEqual({ status: "ambiguous", candidateIds: [3, 4] });
  });

  it("never links on the Projektnummer alone: it returns the projects with that number as suggestions", () => {
    expect(m("G.TEST0001", "Probenburg-Süd")).toEqual({ status: "unmatched", reason: "station-passt-nicht", candidateIds: [1, 2] });
    expect(m("G.TEST0001", null)).toEqual({ status: "unmatched", reason: "station-fehlt", candidateIds: [1, 2] });
  });

  it("never links on the station alone", () => {
    expect(m(null, "Testhausen Hbf")).toEqual({ status: "unmatched", reason: "keine-projektnummer", candidateIds: [] });
    expect(m("G.999", "Testhausen Hbf")).toEqual({ status: "unmatched", reason: "projektnummer-unbekannt", candidateIds: [] });
  });

  describe("phases: AP, EP and VEP are different registrations", () => {
    const ph = [P(10, "G.PH", "Phasenstadt"), P(11, "G.PH", "Phasenstadt"), P(12, "G.PH", "Phasenstadt"), P(13, "G.ONLY", "Phasenstadt"), P(14, "G.MIX", "Phasenstadt"), P(15, "G.MIX", "Phasenstadt")];
    (ph[0] as LinkProject).projektstand = "AP"; (ph[1] as LinkProject).projektstand = "EP"; (ph[2] as LinkProject).projektstand = "VEP";
    (ph[3] as LinkProject).projektstand = "AP";
    (ph[4] as LinkProject).projektstand = "AP"; (ph[5] as LinkProject).projektstand = "EP/AP";
    const pidx = indexProjects(ph);
    const verdict = (projektnummer: string, taetigkeitsbereich: string | null, phase: string | null = null) => matchPruefbericht({ projektnummer, bahnhofStrecke: "Phasenstadt", taetigkeitsbereich, phase }, pidx);

    it("reads the phase a report states about itself — and nothing from phase-less activities", () => {
      expect(reportPhase({ taetigkeitsbereich: "fachtechnische Prüfung EP" })).toBe("EP");
      expect(reportPhase({ taetigkeitsbereich: "fachtechnische Prüfung VEP" })).toBe("VEP");
      expect(reportPhase({ taetigkeitsbereich: "fachtechnische Prüfung AP" })).toBe("AP");
      expect(reportPhase({ taetigkeitsbereich: "fachtechnische Prüfung vor Ibn" })).toBeNull();
      for (const t of ["Abnahmeprüfung", "Gutachten", "Stellungnahme", "Planprüfung", null]) expect(reportPhase({ taetigkeitsbereich: t })).toBeNull();
      expect(reportPhase({ taetigkeitsbereich: null, phase: "EP" })).toBe("EP");   // the legacy sheets' column
      expect(reportPhase({ taetigkeitsbereich: null, phase: "Fertigstellung" })).toBeNull();
    });

    it("the stated phase picks the project of that phase among several at one station", () => {
      expect(verdict("G.PH", "fachtechnische Prüfung EP")).toEqual({ status: "unique", projectId: 11, byPhase: true });
      expect(verdict("G.PH", "fachtechnische Prüfung AP")).toEqual({ status: "unique", projectId: 10, byPhase: true });
      expect(verdict("G.PH", "fachtechnische Prüfung VEP")).toEqual({ status: "unique", projectId: 12, byPhase: true });
      expect(verdict("G.PH", null, "EP")).toMatchObject({ status: "unique", projectId: 11 });
    });

    it("no stated phase → not narrowed: several projects stay ambiguous", () => {
      expect(verdict("G.PH", "Abnahmeprüfung")).toMatchObject({ status: "ambiguous", candidateIds: [10, 11, 12] });
    });

    it("a report is NEVER linked to a project of another phase — not even when it is the only project at the station", () => {
      expect(verdict("G.ONLY", "fachtechnische Prüfung EP")).toEqual({ status: "unmatched", reason: "phase-passt-nicht", candidateIds: [13] });
      expect(verdict("G.ONLY", "fachtechnische Prüfung AP")).toMatchObject({ status: "unique", projectId: 13 });
      expect(verdict("G.ONLY", "Abnahmeprüfung")).toMatchObject({ status: "unique", projectId: 13 });
    });

    it("a project whose stand is no single phase ('EP/AP') cannot contradict the report — but another phase's project is excluded", () => {
      expect(verdict("G.MIX", "fachtechnische Prüfung EP")).toMatchObject({ status: "unique", projectId: 15 });
    });
  });

  it("ignores projects without a Projektnummer entirely", () => {
    expect(idx.size).toBe(2);
  });
});
