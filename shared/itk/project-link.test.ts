import { describe, expect, it } from "vitest";
import { indexProjects, matchPruefbericht, type LinkProject } from "./project-link";

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
    expect(m("G.TEST0001", "Musterstadt Marktplatz")).toEqual({ status: "unique", projectId: 1 });
    expect(m("g. TEST0001", "Beispieldorf (Taunus)")).toEqual({ status: "unique", projectId: 2 });
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

  it("ignores projects without a Projektnummer entirely", () => {
    expect(idx.size).toBe(2);
  });
});
