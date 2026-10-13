import { describe, expect, it } from "vitest";
import { fullKey } from "../project-identity";
import { parseRegisterWorkbook, type RegisterRecord } from "./register-import";
import { chunkRecords, diffRecord, planRegister, summarizePlan, type ExistingProject } from "./register-plan";
import { registerRow, registerSheet, type RowSpec } from "./testing";

const rec = (spec: RowSpec, n = 9): RegisterRecord => ({ ...parseRegisterWorkbook([registerSheet([registerRow(spec)])]).records[0]!, ref: n });
/** The project as an earlier import (or a person) left it in the database. */
const existing = (id: number, r: RegisterRecord, version = 3): ExistingProject => ({ id, version, fields: { ...r.fields }, reviews: JSON.parse(JSON.stringify(r.reviews)) });

describe("planRegister — identity", () => {
  it("a record equal to a stored project is unchanged (re-import of the same file plans nothing)", () => {
    const a = rec({ projektnummer: "G.1", station: "Alpha" });
    const plan = planRegister([a], [existing(7, a)]);
    expect(plan[0]).toMatchObject({ status: "unchanged", basis: "fingerprint", match: { projectId: 7, version: 3 }, changes: [] });
  });

  it("Projektnummer alone is not evidence: same number, other station → new project", () => {
    const a = rec({ projektnummer: "G.1", station: "Alpha" });
    const b = rec({ projektnummer: "G.1", station: "Beta" }, 10);
    const plan = planRegister([b], [existing(7, a)]);
    expect(plan[0]).toMatchObject({ status: "add", candidates: [] });
  });

  it("two projects with one number are never merged, each keeps its own match", () => {
    const a = rec({ projektnummer: "G.1", station: "Alpha" });
    const b = rec({ projektnummer: "G.1", station: "Beta" }, 10);
    const plan = planRegister([a, b], [existing(1, a), existing(2, b)]);
    expect(plan.map((p) => [p.status, p.match?.projectId])).toEqual([["unchanged", 1], ["unchanged", 2]]);
  });

  it("matches across spelling that is not identity: case, bracketed qualifiers, Hbf, punctuation in the description", () => {
    const stored = rec({ projektnummer: "G. TEST0002", station: "Musterstadt (Main) Marktplatz", beschreibung: "ELA-Erneuerung, Bahnsteig 1" });
    const incoming = rec({ projektnummer: "g.test0002", station: "Musterstadt Marktplatz", beschreibung: "ela erneuerung bahnsteig 1" });
    expect(planRegister([incoming], [existing(1, stored)])[0]).toMatchObject({ status: "unchanged", match: { projectId: 1 } });
  });

  it("rows without a Projektnummer are matched on station and description", () => {
    const a = rec({ projektnummer: null, station: "Alpha", beschreibung: "Sonderfall" });
    expect(planRegister([a], [existing(4, a)])[0]).toMatchObject({ status: "unchanged", match: { projectId: 4 } });
    const other = rec({ projektnummer: null, station: "Beta", beschreibung: "Sonderfall" }, 10);
    expect(planRegister([other], [existing(4, a)])[0]?.status).toBe("add");
  });

  it("two stored projects with the same identity → ambiguous with both candidates, nothing is picked", () => {
    const a = rec({ projektnummer: "G.1" });
    const p = planRegister([a], [existing(1, a), existing(2, a)])[0]!;
    expect(p.status).toBe("ambiguous");
    expect(p.candidates.map((c) => c.projectId)).toEqual([1, 2]);
    expect(p.match).toBeUndefined();
  });

  it("a stored source key points a record at a project whose own fields were edited since (and the difference is a conflict, not a new project)", () => {
    const original = rec({ projektnummer: "G.1", station: "Alpha", beschreibung: "Umbau Gleis 1" });
    const edited = { ...existing(5, original), fields: { ...original.fields, projektbeschreibung: "Umbau Gleis 1 — Umfang erweitert" } };
    const plan = planRegister([original], [edited], new Map([[fullKey({ ...original.fields }), [5]]]));
    expect(plan[0]).toMatchObject({ status: "conflict", basis: "key", match: { projectId: 5 } });
    expect(plan[0]?.changes).toEqual([{ key: "projektbeschreibung", from: "Umbau Gleis 1 — Umfang erweitert", to: "Umbau Gleis 1", kind: "overwrite" }]);
  });

  it("same number, station and description but another Projektstand: one candidate on each side → 'core' match whose differences are overwrites", () => {
    const stored = rec({ projektnummer: "G.1", stand: "AP" });
    const incoming = rec({ projektnummer: "G.1", stand: "EP" });
    const p = planRegister([incoming], [existing(8, stored)])[0]!;
    expect(p).toMatchObject({ status: "conflict", basis: "core", match: { projectId: 8 } });
    expect(p.changes).toContainEqual({ key: "projektstand", from: "AP", to: "EP", kind: "overwrite" });
  });

  it("…but two registrations (AP and EP) of one job against one stored project are ambiguous, not a pair of updates", () => {
    const stored = rec({ projektnummer: "G.1", stand: "VEP" });
    const ap = rec({ projektnummer: "G.1", stand: "AP" });
    const ep = rec({ projektnummer: "G.1", stand: "EP" }, 10);
    const plan = planRegister([ap, ep], [existing(8, stored)]);
    expect(plan.map((p) => p.status)).toEqual(["ambiguous", "ambiguous"]);
    expect(plan[0]?.candidates.map((c) => c.projectId)).toEqual([8]);
  });

  it("a registration that already has its own exact project leaves that project alone; the other registration is new", () => {
    const ap = rec({ projektnummer: "G.1", stand: "AP" });
    const ep = rec({ projektnummer: "G.1", stand: "EP" }, 10);
    const plan = planRegister([ap, ep], [existing(1, ap)]);
    expect(plan.map((p) => p.status)).toEqual(["unchanged", "add"]);
  });

  it("an unaccounted-for project at the same number and station with another description may be this one, edited → held, not duplicated", () => {
    const stored = rec({ projektnummer: "G.1", station: "Alpha", beschreibung: "Alte Beschreibung" });
    const incoming = rec({ projektnummer: "G.1", station: "Alpha", beschreibung: "Neue Beschreibung" });
    const p = planRegister([incoming], [existing(3, stored)])[0]!;
    expect(p.status).toBe("ambiguous");
    expect(p.candidates.map((c) => c.projectId)).toEqual([3]);
    expect(p.reason).toMatch(/andere Beschreibung/);
  });

  it("refuses a plan in which two records share an identity (the caller must have deduplicated)", () => {
    const a = rec({ projektnummer: "G.1" });
    expect(() => planRegister([a, { ...a, ref: 12 }], [])).toThrow(/Doppelte Identität/);
  });
});

describe("planRegister — what an import may change", () => {
  const base = rec({ projektnummer: "G.1", reviews: { ITK: ["Zustimmung erteilt", "Pia Prüfer", 45_000] } });

  it("never clears a stored value with a blank cell", () => {
    const incoming = rec({ projektnummer: "G.1", pl: null, kommentar: null, reviews: { ITK: [null, null, null] } });
    const stored = { ...existing(1, base), fields: { ...base.fields, kommentar: "wichtig" } };
    const plan = planRegister([incoming], [stored])[0]!;
    expect(plan.changes.filter((c) => c.key === "projektleiter" || c.key === "kommentar" || c.key.startsWith("review.ITK"))).toEqual([]);
  });

  it("fills empty fields and creates missing reviews without conflict (status 'update')", () => {
    const stored = existing(1, rec({ projektnummer: "G.1", kommentar: null, pl: null, reviews: {} }));
    stored.reviews = {};
    const incoming = rec({ projektnummer: "G.1", kommentar: "neu", reviews: { ITK: ["offen", "Pia", 45_000] } });
    const plan = planRegister([incoming], [{ ...stored, fields: { ...stored.fields, kommentar: null } }])[0]!;
    expect(plan.status).toBe("update");
    expect(plan.changes.map((c) => c.key)).toContain("kommentar");
    expect(plan.changes.filter((c) => c.key.startsWith("review.ITK")).map((c) => c.kind)).toEqual(["fill", "fill", "fill"]);
  });

  it("a different non-empty value is an overwrite → conflict; a status in another spelling of the same group is not", () => {
    const stored = existing(1, rec({ projektnummer: "G.1", reviews: { ITK: ["Projektkonfig.", "Pia", 45_000], EEA: ["offen", "E", 45_000] } }));
    const incoming = rec({ projektnummer: "G.1", reviews: { ITK: ["Projektkonfiguration", "Pia", 45_000], EEA: ["Zustimmung erteilt", "E", 45_000] } });
    const plan = planRegister([incoming], [stored])[0]!;
    expect(plan.status).toBe("conflict");
    expect(plan.changes).toEqual([{ key: "review.EEA.status", from: "offen", to: "Zustimmung erteilt", kind: "overwrite" }]);
  });

  it("diffRecord compares dates as days and strings after whitespace collapse", () => {
    const stored = existing(1, base);
    expect(diffRecord(stored, rec({ projektnummer: "G.1", pl: "  Pia   Projektleitung ", reviews: { ITK: ["Zustimmung erteilt", "Pia Prüfer", 45_000] } }))).toEqual([]);
  });

  it("summarises records, per-status counts and field-level fills/overwrites", () => {
    const a = rec({ projektnummer: "G.1", station: "A" });
    const b = rec({ projektnummer: "G.2", station: "B" }, 10);
    const c = rec({ projektnummer: "G.3", station: "C", kommentar: "x" }, 11);
    const plan = planRegister([a, b, c], [existing(1, a), { ...existing(3, c), fields: { ...c.fields, kommentar: "alt" } }]);
    expect(summarizePlan(plan)).toMatchObject({ records: 3, unchanged: 1, add: 1, conflict: 1, overwrites: 1, fills: 0 });
  });

  it("is stable: the same input plans the same output, whatever the order of the stored projects", () => {
    const rs = ["A", "B", "C", "D"].map((s, i) => rec({ projektnummer: "G.1", station: s }, 9 + i));
    const stored = rs.map((r, i) => existing(i + 1, r));
    const one = planRegister(rs, stored);
    const two = planRegister(rs, [...stored].reverse());
    expect(two).toEqual(one);
  });
});

describe("chunkRecords", () => {
  it("keeps every Projektnummer group in one chunk while it fits, and preserves every record exactly once", () => {
    const records = [...Array(30)].map((_, i) => rec({ projektnummer: `G.${i % 5}`, station: `S${i}` }, 9 + i));
    const chunks = chunkRecords(records, { maxRecords: 12 });
    expect(chunks.flat().map((r) => r.ref).sort((a, b) => a - b)).toEqual(records.map((r) => r.ref));
    for (const g of ["G.0", "G.1", "G.2", "G.3", "G.4"]) {
      expect(new Set(chunks.map((c, i) => (c.some((r) => r.fields.projektnummer === g) ? i : -1)).filter((i) => i >= 0)).size).toBe(1);
    }
  });

  it("splits a group only when the byte budget demands it", () => {
    const records = [...Array(10)].map((_, i) => rec({ projektnummer: "G.1", station: `S${i}`, beschreibung: "x".repeat(1000) }, 9 + i));
    expect(chunkRecords(records, { maxBytes: 3500 }).length).toBeGreaterThan(1);
    expect(chunkRecords(records, { maxBytes: 3500 }).flat()).toHaveLength(10);
  });
});
