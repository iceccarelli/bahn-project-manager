import { describe, it, expect } from "vitest";
import {
  CORRECTION_WINDOW_MINUTES,
  correctionKey,
  describeChange,
  markCorrections,
  severityOf,
  surfaceForPath,
  type AuditMeta,
  type CorrectableEntry,
} from "./audit-entry";

const meta = (over: Partial<AuditMeta> = {}): AuditMeta => ({
  projectId: 7,
  projektnummer: "G.011540063",
  station: "Langenselbold",
  department: "ITK",
  field: "status",
  from: "offen",
  to: "Zustimmung erteilt",
  surface: "PSV-ITK",
  ...over,
});

describe("an entry says which record it changed", () => {
  it("names the project, the Gewerk, the field, both values and the screen", () => {
    // The sentence the trail used to carry was
    //   "ITK: status von Zustimmung erteilt auf offen gesetzt."
    // which does not identify one of 1,298 projects.
    const text = describeChange(meta());
    for (const part of [
      "G.011540063",
      "Langenselbold",
      "ITK",
      "status",
      "offen",
      "Zustimmung erteilt",
      "PSV-ITK",
    ]) {
      expect(text, part).toContain(part);
    }
  });

  it("writes „leer“ rather than printing undefined into an audit record", () => {
    const text = describeChange(meta({ from: null, to: "offen" }));
    expect(text).toContain("leer → offen");
    expect(text).not.toMatch(/undefined|null/);
  });

  it("degrades to an empty string for an entry that carries no structure", () => {
    expect(describeChange(undefined)).toBe("");
    expect(describeChange(null)).toBe("");
  });
});

describe("severity is about consequence", () => {
  it("treats a withdrawn approval as critical", () => {
    expect(
      severityOf("Prüfung aktualisiert", meta({ from: "Zustimmung erteilt", to: "offen" })),
    ).toBe("kritisch");
    expect(
      severityOf("Prüfung aktualisiert", meta({ from: "Niederschrift erstellt", to: "abgelehnt" })),
    ).toBe("kritisch");
  });

  it("treats a required check being switched off as critical", () => {
    // It stops being counted on every page, silently.
    expect(
      severityOf("Prüfung aktualisiert", meta({ from: "offen", to: "nicht erforderlich" })),
    ).toBe("kritisch");
  });

  it("treats deleting a project as critical", () => {
    expect(severityOf("Projekt gelöscht", meta({ field: undefined }))).toBe("kritisch");
  });

  it("treats newly blocked and renamed records as important, not critical", () => {
    expect(severityOf("Prüfung aktualisiert", meta({ from: "offen", to: "abgelehnt" }))).toBe(
      "wichtig",
    );
    expect(
      severityOf("Projekt aktualisiert", meta({ department: null, field: "projektnummer" })),
    ).toBe("wichtig");
    expect(severityOf("Projekt aktualisiert", meta({ department: null, field: "station" }))).toBe(
      "wichtig",
    );
  });

  it("leaves ordinary progress as routine", () => {
    expect(severityOf("Prüfung aktualisiert", meta({ from: "offen", to: "in Bearbeitung" }))).toBe(
      "routine",
    );
    expect(
      severityOf("Prüfung aktualisiert", meta({ field: "prueferName", from: "", to: "Er" })),
    ).toBe("routine");
    expect(severityOf("PDF erzeugt", null)).toBe("routine");
  });

  it("reads a status through the canonical vocabulary, not the raw string", () => {
    // 3 ITK rows store "Projektkonfiguration" against 51 "Projektkonfig."; 80
    // TBQ rows carry a parenthesised annotation. Matching raw text would grade
    // the same transition two different ways.
    expect(
      severityOf(
        "Prüfung aktualisiert",
        meta({ from: "Niederschrift erstellt (LP05-05-01-F31)", to: "offen" }),
      ),
    ).toBe("kritisch");
  });
});

describe("the correction window", () => {
  const t = (minutesAgo: number) => new Date(Date.UTC(2026, 7, 22, 12, 0, 0) - minutesAgo * 60_000).toISOString();
  const NOW = Date.UTC(2026, 7, 22, 12, 0, 0);

  const entry = (id: string, minutesAgo: number, over: Partial<AuditMeta>): CorrectableEntry => ({
    id,
    timestamp: t(minutesAgo),
    action: "Prüfung aktualisiert",
    meta: meta(over),
  });

  it("marks a change that was changed again inside the window", () => {
    // newest first, as the store keeps them
    const entries = [
      entry("b", 1, { from: "abgelehnt", to: "offen" }),
      entry("a", 3, { from: "offen", to: "abgelehnt" }),
    ];
    const v = markCorrections(entries, NOW);
    expect(v.get("a")?.superseded).toBe(true);
    expect(v.get("b")?.superseded).toBe(false);
  });

  it("recognises when the second change put the value back", () => {
    const entries = [
      entry("b", 1, { from: "abgelehnt", to: "offen" }),
      entry("a", 3, { from: "offen", to: "abgelehnt" }),
    ];
    expect(markCorrections(entries, NOW).get("a")?.revertsEarlier).toBe(true);
  });

  it("does NOT collapse two changes that are hours apart — those are decisions", () => {
    const entries = [
      entry("b", 5, { from: "abgelehnt", to: "offen" }),
      entry("a", 600, { from: "offen", to: "abgelehnt" }),
    ];
    expect(markCorrections(entries, NOW).get("a")?.superseded).toBe(false);
  });

  it("keeps changes to different fields and different projects apart", () => {
    const entries = [
      entry("b", 1, { field: "prueferName", from: "", to: "Er" }),
      entry("a", 2, { field: "status", from: "offen", to: "abgelehnt" }),
      entry("c", 2, { projectId: 99, field: "status", from: "offen", to: "abgelehnt" }),
    ];
    const v = markCorrections(entries, NOW);
    expect(v.get("a")?.superseded).toBe(false);
    expect(v.get("c")?.superseded).toBe(false);
  });

  it("offers undo only inside the window", () => {
    const entries = [entry("fresh", 2, {}), entry("stale", CORRECTION_WINDOW_MINUTES + 5, {})];
    const v = markCorrections(entries, NOW);
    expect(v.get("fresh")?.undoable).toBe(true);
    expect(v.get("stale")?.undoable).toBe(false);
  });

  it("never drops an entry — a marked correction is still in the record", () => {
    const entries = [
      entry("b", 1, { from: "abgelehnt", to: "offen" }),
      entry("a", 3, { from: "offen", to: "abgelehnt" }),
    ];
    const v = markCorrections(entries, NOW);
    expect(v.size).toBe(entries.length);
    for (const e of entries) expect(v.has(e.id)).toBe(true);
  });

  it("classifies entries that carry no structure instead of throwing", () => {
    const legacy: CorrectableEntry = {
      id: "old",
      timestamp: t(1),
      action: "Projekt erstellt",
      meta: null,
    };
    const v = markCorrections([legacy], NOW);
    expect(v.get("old")?.severity).toBe("routine");
    expect(v.get("old")?.superseded).toBe(false);
  });

  it("survives an unparseable timestamp rather than marking everything undoable", () => {
    const broken: CorrectableEntry = {
      id: "broken",
      timestamp: "not a date",
      action: "Prüfung aktualisiert",
      meta: meta(),
    };
    expect(markCorrections([broken], NOW).get("broken")?.undoable).toBe(false);
  });
});

describe("correctionKey", () => {
  it("is the project, the Gewerk and the field", () => {
    expect(correctionKey(meta())).toBe("7|ITK|status");
    expect(correctionKey(meta({ department: null, field: "station" }))).toBe("7||station");
  });

  it("is null when the entry cannot identify what it changed", () => {
    expect(correctionKey({ field: "status" })).toBeNull();
    expect(correctionKey({ projectId: 7 })).toBeNull();
    expect(correctionKey(null)).toBeNull();
  });
});

describe("surfaceForPath", () => {
  it("names every route a change can be made from", () => {
    expect(surfaceForPath("/")).toBe("Dashboard");
    expect(surfaceForPath("/projects")).toBe("Projekte");
    expect(surfaceForPath("/projects?q=x")).toBe("Projekte");
    expect(surfaceForPath("/bvb-eea")).toBe("BVB-EEA");
    expect(surfaceForPath("/psv-itk")).toBe("PSV-ITK");
    expect(surfaceForPath("/anmeldung")).toBe("Projektanmeldung");
    expect(surfaceForPath("/etwas-neues")).toBe("App");
  });
});
