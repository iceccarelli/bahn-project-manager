import { describe, expect, it } from "vitest";
import { buildApplyRows, unskipRows, type ReviewRow } from "./register-decisions";
import { parseRegisterWorkbook } from "./register-import";
import { planRegister, contentKey, type ExistingProject } from "./register-plan";
import { registerRow, registerSheet, type RowSpec } from "./testing";

const recs = (rows: RowSpec[]) => parseRegisterWorkbook([registerSheet(rows.map(registerRow))]).records;
const review = (records: ReturnType<typeof recs>, existing: ExistingProject[] = [], skips = new Set<string>()): ReviewRow[] =>
  planRegister(records, existing, new Map(), skips).map((plan, i) => ({ plan, record: records[i]!, chunk: 0 }));
const stored2 = (id: number, r: ReturnType<typeof recs>[number], version = 4): ExistingProject => ({ id, version, fields: { ...r.fields }, reviews: JSON.parse(JSON.stringify(r.reviews)) });

describe("buildApplyRows — what the administrator's choices ask the server to do", () => {
  it("defaults: add → create, unchanged/update → update at the planned version; open questions send nothing", () => {
    const [a, b, c] = recs([{ projektnummer: "G.1", station: "A" }, { projektnummer: "G.2", station: "B" }, { projektnummer: "G.3", station: "C", kommentar: "neu" }]);
    const existing = [stored2(1, a!), { ...stored2(3, c!), fields: { ...c!.fields, kommentar: "alt" } }];
    const { rows } = buildApplyRows(review([a!, b!, c!], existing), {});
    expect(rows.map((r) => [r.record.fields.station, r.action])).toEqual([["A", "update"], ["B", "create"]]); // C is a conflict: open
    expect(rows[0]).toMatchObject({ target: { projectId: 1, expectedVersion: 4 }, overwrite: false });
  });

  it("conflict: replace → overwrite update; skip → recorded exclusion; 'new' only for a same-phase core match", () => {
    const [stored] = recs([{ projektnummer: "G.1", stand: "AP", termin: 45_000 }]);
    const [inc] = recs([{ projektnummer: "G.1", stand: "AP", termin: 45_100 }]);
    const rv = review([inc!], [stored2(9, stored!)]);
    expect(rv[0]!.plan).toMatchObject({ status: "conflict", basis: "core" });
    expect(buildApplyRows(rv, { [inc!.ref]: "replace" }).rows[0]).toMatchObject({ action: "update", overwrite: true, target: { projectId: 9 } });
    expect(buildApplyRows(rv, { [inc!.ref]: "skip" }).rows[0]).toMatchObject({ action: "skip" });
    expect(buildApplyRows(rv, { [inc!.ref]: "new" }).rows[0]).toMatchObject({ action: "create", confirmed: true });
    expect(buildApplyRows(rv, { [inc!.ref]: "open" }).rows).toEqual([]);
    // a conflict that is NOT a core match cannot be turned into a new project by the client either
    const [ex] = recs([{ projektnummer: "G.2", pl: "alt" }]);
    const [inc2] = recs([{ projektnummer: "G.2", pl: "neu" }]);
    expect(buildApplyRows(review([inc2!], [stored2(2, ex!)]), { [inc2!.ref]: "new" }).rows).toEqual([]);
  });

  it("another phase needs no decision at all: the EP row is simply a new registration next to the AP project", () => {
    const [ap] = recs([{ projektnummer: "G.1", stand: "AP" }]);
    const [ep] = recs([{ projektnummer: "G.1", stand: "EP", termin: 45_100 }]);
    const rv = review([ep!], [stored2(9, ap!)]);
    expect(rv[0]!.plan.status).toBe("add");
    expect(buildApplyRows(rv, {}).rows[0]).toMatchObject({ action: "create", confirmed: false });
  });

  it("ambiguous: a chosen candidate → confirmed overwrite update at the candidate's version; new → confirmed create; an unknown id → nothing", () => {
    const [old] = recs([{ projektnummer: "G.1", beschreibung: "Alt" }]);
    const [inc] = recs([{ projektnummer: "G.1", beschreibung: "Neu" }]);
    const rv = review([inc!], [stored2(5, old!, 7)]);
    expect(buildApplyRows(rv, { [inc!.ref]: 5 }).rows[0]).toMatchObject({ action: "update", confirmed: true, overwrite: true, target: { projectId: 5, expectedVersion: 7 } });
    expect(buildApplyRows(rv, { [inc!.ref]: "new" }).rows[0]).toMatchObject({ action: "create", confirmed: true });
    expect(buildApplyRows(rv, { [inc!.ref]: 99 }).rows).toEqual([]);
  });

  it("a group of undecidable source rows: the winner is planned alone, every other row is excluded in the same request", () => {
    const [x, y, z] = recs([{ projektnummer: "G.1", kommentar: "A" }, { projektnummer: "G.1", kommentar: "B" }, { projektnummer: "G.1", kommentar: "C" }]);
    const rv = review([x!, y!, z!]);
    expect(rv.map((r) => r.plan.status)).toEqual(["ambiguous", "ambiguous", "ambiguous"]);
    const winnerPlan = planRegister([y!], [])[0]!;
    const { rows, winnerNeedsDecision } = buildApplyRows(rv, { [y!.ref]: "wins" }, new Map([[y!.ref, winnerPlan]]));
    expect(rows.map((r) => [r.record.fields.kommentar, r.action]).sort()).toEqual([["A", "skip"], ["B", "create"], ["C", "skip"]]);
    expect(winnerNeedsDecision).toEqual([]);
    // the winner's own plan is a question (e.g. a conflict): the losers are still excluded, the winner is reported
    const conflictPlan = { ...winnerPlan, status: "conflict" as const };
    expect(buildApplyRows(rv, { [y!.ref]: "wins" }, new Map([[y!.ref, conflictPlan]])).winnerNeedsDecision).toEqual([y!.ref]);
    // "exclude" on a single row excludes only that row; an unchosen group sends nothing
    expect(buildApplyRows(rv, { [x!.ref]: "skip" }).rows.map((r) => [r.record.ref, r.action])).toEqual([[x!.ref, "skip"]]);
    expect(buildApplyRows(rv, {}).rows).toEqual([]);
  });

  it("earlier exclusions are never re-sent, and can be taken back explicitly", () => {
    const [a] = recs([{ projektnummer: "G.1" }]);
    const rv = review([a!], [], new Set([contentKey(a!)]));
    expect(rv[0]!.plan.status).toBe("skipped");
    expect(buildApplyRows(rv, {}).rows).toEqual([]);
    expect(unskipRows(rv, new Set([a!.ref]))).toEqual([{ record: a, action: "unskip", overwrite: false, confirmed: false }]);
  });
});
