/**
 * Übersichtsliste import and Prüfbericht ↔ project links against a REAL database (MariaDB/MySQL).
 * The whole path a user takes: parse the (synthetic) workbook → preview → apply in chunks → re-import → edits → conflicts →
 * links. Skipped without TEST_DATABASE_URL — see server/testing/testDb.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { hasTestDb, createTestDatabase } from "../testing/testDb";
import { MysqlProjectStore } from "../infra/mysqlProjectStore";
import { importPruefberichte, linkSummary, listPruefberichte, linkCandidatesOf, pruefberichteOfProject } from "../infra/pruefberichtStore";
import { ProjectService } from "./projectService";
import { PruefberichtLinkService } from "./pruefberichtLinkService";
import { RegisterImportService, sourceKeyHash } from "./registerImportService";
import { ForbiddenError, IdempotencyKeyReuseError, NotFoundError, StaleVersionError } from "./errors";
import { admin, markus, viewer, mitteOnly, ctx } from "./testFixtures";
import { analyzeSource, parseRegisterWorkbook, type RegisterRecord } from "@shared/register/register-import";
import { chunkRecords } from "@shared/register/register-plan";
import type { RegisterApplyRow } from "@shared/register/register-contract";
import { registerRow, registerSheet, type RowSpec } from "@shared/register/testing";
import { fullKey } from "@shared/project-identity";
import { importWorkbookSheets } from "@shared/itk/pruefbericht-import";
import { H2020, row2020 } from "@shared/itk/testing";

const key = () => `k-${randomUUID()}`;
const parse = (rows: RowSpec[]) => analyzeSource(parseRegisterWorkbook([registerSheet(rows.map(registerRow))]).records).accepted;

describe.skipIf(!hasTestDb)("Übersichtsliste import (real DB)", () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let store: MysqlProjectStore;
  let projects: ProjectService;
  let imp: RegisterImportService;
  let links: PruefberichtLinkService;
  let nudges = 0;

  beforeAll(async () => {
    t = await createTestDatabase(20);
    store = new MysqlProjectStore(t.db as never);
    projects = new ProjectService(store, () => { nudges++; });
    imp = new RegisterImportService(store, projects);
    links = new PruefberichtLinkService(store);
  });
  afterAll(async () => { await t?.drop(); });

  const count = async (table: string, where = "1=1") => Number(((await t.pool.query(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`))[0] as { n: number }[])[0]!.n);
  const q = async <R = Record<string, unknown>>(sqlText: string, args: unknown[] = []) => ((await t.pool.query(sqlText, args))[0] as R[]);

  /** The browser's flow: preview every chunk, then apply with the evidence-backed defaults. */
  async function runImport(records: RegisterRecord[], who = admin, decide: (row: ReturnType<typeof rowOf>) => Partial<RegisterApplyRow> | null = () => ({})) {
    const totals = { created: 0, updated: 0, unchanged: 0, held: 0, stale: 0, exists: 0, refused: 0, skipped: 0 };
    const plans = [];
    const chunks = chunkRecords(records);
    for (const [i, chunk] of chunks.entries()) {
      const preview = await imp.preview(who, { records: chunk });
      plans.push(...preview.rows);
      const rows: RegisterApplyRow[] = [];
      for (const p of preview.rows) {
        const record = chunk.find((r) => r.ref === p.ref)!;
        if (p.status === "skipped") { totals.skipped += 1; continue; } // an earlier exclusion stands: nothing to send
        const base = rowOf(p, record);
        const d = decide(base);
        if (d === null) { totals.skipped += 1; continue; }
        rows.push({ ...base, ...d } as RegisterApplyRow);
      }
      if (!rows.length) continue;
      const res = await imp.apply(who, { source: "test.xlsm", part: { index: i + 1, total: chunks.length }, rows, idempotencyKey: key() }, ctx());
      for (const [k, n] of Object.entries(res.counts)) totals[k as keyof typeof totals] += n;
    }
    return { totals, plans };
  }
  function rowOf(p: { status: string; match?: { projectId: number; version: number }; ref: number }, record: RegisterRecord): RegisterApplyRow {
    if (p.status === "add") return { record, action: "create", overwrite: false, confirmed: false };
    if (p.match) return { record, action: "update", target: { projectId: p.match.projectId, expectedVersion: p.match.version }, overwrite: false, confirmed: false };
    return { record, action: "create", overwrite: false, confirmed: false }; // ambiguous: not sent by the default flow (decide() skips it)
  }

  const records = parse([
    { projektnummer: "G.1", station: "Alpha", reviews: { ITK: ["Zustimmung erteilt", "Pia Prüfer", 45_000], EEA: ["offen", "Eva", 45_001] } },
    { projektnummer: "G.1", station: "Beta", beschreibung: "Anderer Umbau" },
    { projektnummer: "G.1", station: "Alpha", stand: "EP", termin: 45_100 }, // same job, later registration
    { projektnummer: null, station: "Gamma", beschreibung: "Ohne Nummer" },
    { projektnummer: "G.2", station: "Delta", bm: "Mainz" },
  ]);

  it("first import creates every project once, with its department reviews, audit rows and outbox events", async () => {
    const before = { audit: await count("audit_log"), events: await count("domain_events") };
    const { totals } = await runImport(records);
    expect(totals).toMatchObject({ created: 5, updated: 0, unchanged: 0, held: 0, exists: 0 });
    expect(await count("projects")).toBe(5);
    // the 14 department groups of each row → department_reviews, one row per (project, department)
    expect(await count("department_reviews")).toBe(5 * 14);
    const alpha = (await q<{ id: number }>("SELECT id FROM projects WHERE station='Alpha' AND projektstand='AP'"))[0]!;
    const itk = (await q<{ status: string; prueferName: string; datum: Date }>("SELECT status, prueferName, datum FROM department_reviews WHERE projectId=? AND department='ITK'", [alpha.id]))[0]!;
    expect(itk).toMatchObject({ status: "Zustimmung erteilt", prueferName: "Pia Prüfer" });
    expect(itk.datum.toISOString().slice(0, 10)).toBe("2023-03-15");
    // the same rows the single-edit path writes
    expect(await count("domain_events", "eventType='project.created'")).toBe(5);
    expect(await count("audit_log", "entityType='project' AND action='create' AND field IS NOT NULL AND field <> 'import'")).toBeGreaterThan(5);
    expect(await count("audit_log")).toBeGreaterThan(before.audit);
    expect(await count("domain_events")).toBe(before.events + 5);
    expect(nudges).toBeGreaterThan(0);
    // the import is itself on the record
    expect((await q<{ newValue: string }>("SELECT newValue FROM audit_log WHERE field='import' AND entityType='project'"))[0]!.newValue).toContain('"created":5');
  });

  it("the three registrations with one Projektnummer became separate projects — no merging by number", async () => {
    expect(await count("projects", "projektnummer='G.1'")).toBe(3);
    expect(await count("projects", "projektnummer='G.1' AND station='Alpha'")).toBe(2);
  });

  it("remembers the registration of every project in project_source_keys", async () => {
    expect(await count("project_source_keys")).toBe(5);
    const [alpha] = await q<{ id: number }>("SELECT id FROM projects WHERE station='Alpha' AND projektstand='AP'");
    const hash = sourceKeyHash(fullKey({ ...records[0]!.fields }));
    expect((await q<{ projectId: number }>("SELECT projectId FROM project_source_keys WHERE sourceKey=?", [hash]))[0]!.projectId).toBe(alpha!.id);
  });

  it("re-importing the unchanged file creates, changes and publishes nothing", async () => {
    const snap = { p: await count("projects"), r: await count("department_reviews"), e: await count("domain_events"), a: await count("audit_log", "field IS NULL OR field <> 'import'"), k: await count("project_source_keys") };
    const versions = await q<{ id: number; syncVersion: number }>("SELECT id, syncVersion FROM projects ORDER BY id");
    const { totals, plans } = await runImport(records);
    expect(totals).toMatchObject({ created: 0, updated: 0, unchanged: 5, held: 0 });
    expect(plans.every((p) => p.status === "unchanged")).toBe(true);
    expect(await count("projects")).toBe(snap.p);
    expect(await count("department_reviews")).toBe(snap.r);
    expect(await count("domain_events")).toBe(snap.e);
    expect(await count("audit_log", "field IS NULL OR field <> 'import'")).toBe(snap.a);
    expect(await count("project_source_keys")).toBe(snap.k);
    expect(await q("SELECT id, syncVersion FROM projects ORDER BY id")).toEqual(versions);
  });

  it("planning twice from an unchanged state gives the same plan", async () => {
    const a = await imp.preview(admin, { records });
    const b = await imp.preview(admin, { records });
    expect(b).toEqual(a);
  });

  it("a blank cell in the workbook never clears a stored value; a new value fills an empty one (one version step, audited)", async () => {
    const [p] = await q<{ id: number; syncVersion: number }>("SELECT id, syncVersion FROM projects WHERE station='Gamma'");
    await projects.update(admin, { id: p!.id, expectedVersion: p!.syncVersion, changes: { kommentar: "Handschriftlich in der App", projektleiter: "Pia Projektleitung" }, idempotencyKey: key() }, ctx());
    const incoming = parse([{ projektnummer: null, station: "Gamma", beschreibung: "Ohne Nummer", pl: null, kommentar: null, link: "https://example.invalid/gamma" }]);
    const e0 = await count("domain_events");
    const { totals } = await runImport(incoming);
    expect(totals).toMatchObject({ updated: 1, held: 0 });
    const [after] = await q<{ kommentar: string; projektleiter: string; projektLink: string; syncVersion: number }>("SELECT kommentar, projektleiter, projektLink, syncVersion FROM projects WHERE id=?", [p!.id]);
    expect(after).toMatchObject({ kommentar: "Handschriftlich in der App", projektleiter: "Pia Projektleitung", projektLink: "https://example.invalid/gamma", syncVersion: p!.syncVersion + 2 });
    expect(await count("domain_events")).toBe(e0 + 1);
    expect(await count("audit_log", `entityId=${p!.id} AND field='projektLink' AND newValue='https://example.invalid/gamma'`)).toBe(1);
  });

  it("a workbook value that would REPLACE a stored one is held as a conflict until the administrator confirms", async () => {
    const [p] = await q<{ id: number; syncVersion: number }>("SELECT id, syncVersion FROM projects WHERE station='Delta'");
    await projects.updateReview(admin, { projectId: p!.id, department: "ITK", expectedVersion: p!.syncVersion, changes: { prueferName: "Neuer Prüfer aus der App" }, idempotencyKey: key() }, ctx());
    const incoming = parse([{ projektnummer: "G.2", station: "Delta", bm: "Mainz", reviews: { ITK: ["nicht erforderlich", "Prüfer aus der Datei", 45_000] } }]);
    const plan = (await imp.preview(admin, { records: incoming })).rows[0]!;
    expect(plan.status).toBe("conflict");
    expect(plan.changes).toContainEqual({ key: "review.ITK.prueferName", from: "Neuer Prüfer aus der App", to: "Prüfer aus der Datei", kind: "overwrite" });
    // default flow: not confirmed → held, nothing written
    const held = await runImport(incoming);
    expect(held.totals).toMatchObject({ held: 1, updated: 0 });
    expect((await q<{ prueferName: string }>("SELECT prueferName FROM department_reviews WHERE projectId=? AND department='ITK'", [p!.id]))[0]!.prueferName).toBe("Neuer Prüfer aus der App");
    // confirmed overwrite → applied
    const ok = await runImport(incoming, admin, () => ({ overwrite: true }));
    expect(ok.totals).toMatchObject({ updated: 1 });
    expect((await q<{ prueferName: string }>("SELECT prueferName FROM department_reviews WHERE projectId=? AND department='ITK'", [p!.id]))[0]!.prueferName).toBe("Prüfer aus der Datei");
  });

  it("a project changed between preview and apply is reported stale, not overwritten", async () => {
    const [p] = await q<{ id: number; syncVersion: number }>("SELECT id, syncVersion FROM projects WHERE station='Beta'");
    const incoming = parse([{ projektnummer: "G.1", station: "Beta", beschreibung: "Anderer Umbau", kommentar: "aus der Datei" }]);
    const preview = (await imp.preview(admin, { records: incoming })).rows[0]!;
    expect(preview).toMatchObject({ status: "update", match: { projectId: p!.id, version: p!.syncVersion } });
    await projects.update(admin, { id: p!.id, expectedVersion: p!.syncVersion, changes: { projektleiter: "Zwischendurch geändert" }, idempotencyKey: key() }, ctx());
    const res = await imp.apply(admin, { source: "t", part: { index: 1, total: 1 }, idempotencyKey: key(), rows: [{ record: incoming[0]!, action: "update", target: { projectId: p!.id, expectedVersion: preview.match!.version }, overwrite: false, confirmed: false }] }, ctx());
    expect(res.counts).toMatchObject({ stale: 1, updated: 0 });
    expect((await q<{ kommentar: string | null }>("SELECT kommentar FROM projects WHERE id=?", [p!.id]))[0]!.kommentar).toBeNull();
  });

  it("refuses to create a project the evidence says exists, and to update one that is not the planned match", async () => {
    const [alpha] = await q<{ id: number; syncVersion: number }>("SELECT id, syncVersion FROM projects WHERE station='Alpha' AND projektstand='AP'");
    const [beta] = await q<{ id: number; syncVersion: number }>("SELECT id, syncVersion FROM projects WHERE station='Beta'");
    const same = records[0]!;
    const create = await imp.apply(admin, { source: "t", part: { index: 1, total: 1 }, idempotencyKey: key(), rows: [{ record: same, action: "create", overwrite: false, confirmed: false }] }, ctx());
    expect(create.counts).toMatchObject({ exists: 1, created: 0 });
    const wrong = await imp.apply(admin, { source: "t", part: { index: 1, total: 1 }, idempotencyKey: key(), rows: [{ record: same, action: "update", target: { projectId: beta!.id, expectedVersion: beta!.syncVersion }, overwrite: true, confirmed: false }] }, ctx());
    expect(wrong.counts).toMatchObject({ refused: 1, updated: 0 });
    expect(await count("projects")).toBe(5);
    expect(alpha).toBeTruthy();
  });

  it("an edited description is not a new project: it is held as ambiguous with the existing project as the candidate", async () => {
    const incoming = parse([{ projektnummer: "G.2", station: "Delta", bm: "Mainz", beschreibung: "Umbau Testbahnsteig, Umfang erweitert" }]);
    const plan = (await imp.preview(admin, { records: incoming })).rows[0]!;
    expect(plan.status).toBe("ambiguous");
    expect(plan.candidates).toHaveLength(1);
    const before = await count("projects");
    const { totals } = await runImport(incoming, admin, (r) => (r.action === "create" && plan.status === "ambiguous" ? null : {}));
    expect(totals.skipped).toBe(1);
    expect(await count("projects")).toBe(before);
    // the administrator chooses the candidate: applied, and the NEW registration is remembered for the same project
    const c = plan.candidates[0]!;
    const res = await imp.apply(admin, { source: "t", part: { index: 1, total: 1 }, idempotencyKey: key(), rows: [{ record: incoming[0]!, action: "update", target: { projectId: c.projectId, expectedVersion: c.version }, overwrite: true, confirmed: true }] }, ctx());
    expect(res.counts).toMatchObject({ updated: 1 });
    expect((await q<{ projektbeschreibung: string }>("SELECT projektbeschreibung FROM projects WHERE id=?", [c.projectId]))[0]!.projektbeschreibung).toBe("Umbau Testbahnsteig, Umfang erweitert");
    expect(await count("project_source_keys", `projectId=${c.projectId}`)).toBe(2);
    // and from now on the edited row is recognised exactly
    expect((await imp.preview(admin, { records: incoming })).rows[0]).toMatchObject({ status: "unchanged", basis: "key" });
  });

  it("an administrator may say an ambiguous row is a NEW project; without that statement the server refuses to create it", async () => {
    await runImport(parse([{ projektnummer: "G.5", station: "Kappa", beschreibung: "Maßnahme A" }]));
    const incoming = parse([{ projektnummer: "G.5", station: "Kappa", beschreibung: "Maßnahme B, getrennte Maßnahme am selben Bahnhof" }]);
    const plan = (await imp.preview(admin, { records: incoming })).rows[0]!;
    expect(plan.status).toBe("ambiguous");
    const before = await count("projects");
    const refused = await imp.apply(admin, { source: "t", part: { index: 1, total: 1 }, idempotencyKey: key(), rows: [{ record: incoming[0]!, action: "create", overwrite: false, confirmed: false }] }, ctx());
    expect(refused.counts).toMatchObject({ exists: 1, created: 0 });
    const ok = await imp.apply(admin, { source: "t", part: { index: 1, total: 1 }, idempotencyKey: key(), rows: [{ record: incoming[0]!, action: "create", overwrite: false, confirmed: true }] }, ctx());
    expect(ok.counts).toMatchObject({ created: 1 });
    expect(await count("projects")).toBe(before + 1);
    // from now on both registrations are known exactly
    expect((await imp.preview(admin, { records: incoming })).rows[0]).toMatchObject({ status: "unchanged" });
  });

  // ------------------------------------------------ decisions that outlive the import ---------------------------------

  describe("decisions are remembered (project_source_keys)", () => {
    const planning = (rows: RowSpec[]) => analyzeSource(parseRegisterWorkbook([registerSheet(rows.map(registerRow))]).records).forPlanning;
    const decide = (recs: RegisterRecord[], action: "skip" | "unskip" | "create", confirmed = false) =>
      imp.apply(admin, { source: "t", part: { index: 1, total: 1 }, idempotencyKey: key(), rows: recs.map((record) => ({ record, action, overwrite: false, confirmed })) }, ctx());
    const statusOf = async (recs: RegisterRecord[]) => (await imp.preview(admin, { records: recs })).rows.map((r) => r.status);

    it("two rows of the file with one identity and different content: the administrator picks the winner; the loser is excluded for good", async () => {
      const [first, second] = planning([
        { projektnummer: "G.6", station: "Lambda", beschreibung: "Quelle uneindeutig", kommentar: "Fassung A" },
        { projektnummer: "G.6", station: "Lambda", beschreibung: "Quelle uneindeutig", kommentar: "Fassung B" },
      ]) as [RegisterRecord, RegisterRecord];
      const plan = (await imp.preview(admin, { records: [first, second] })).rows;
      expect(plan.map((p) => p.status)).toEqual(["ambiguous", "ambiguous"]);
      expect(plan[0]?.sourceDiff).toEqual([{ key: "kommentar", values: { [first.ref]: "Fassung A", [second.ref]: "Fassung B" } }]);
      // the server does not create while the file is undecided (both rows in the request, neither excluded)
      expect((await decide([first, second], "create")).counts).toMatchObject({ exists: 2, created: 0 });
      // B wins: A is excluded, B is created — in ONE request
      const res = await imp.apply(admin, { source: "t", part: { index: 1, total: 1 }, idempotencyKey: key(), rows: [
        { record: first, action: "skip", overwrite: false, confirmed: false },
        { record: second, action: "create", overwrite: false, confirmed: false },
      ] }, ctx());
      expect(res.counts).toMatchObject({ skipped: 1, created: 1 });
      expect(await count("projects", "projektnummer='G.6'")).toBe(1);
      expect((await q<{ kommentar: string }>("SELECT kommentar FROM projects WHERE projektnummer='G.6'"))[0]!.kommentar).toBe("Fassung B");
      // every later import of the same file: no question, no write
      expect(await statusOf([first, second])).toEqual(["skipped", "unchanged"]);
      const e0 = await count("domain_events");
      expect((await runImport([first, second])).totals).toMatchObject({ created: 0, updated: 0, held: 0 });
      expect(await count("domain_events")).toBe(e0);
      // on the record
      expect(await count("audit_log", "field='import.skip' AND entityLabel LIKE 'Lambda%'")).toBe(1);
    });

    it("an exclusion applies to exactly that content: edit a cell and the row is a question again; withdrawing it is audited", async () => {
      await runImport(parse([{ projektnummer: "G.7", station: "Mu", beschreibung: "Alt" }]));
      const [row] = parse([{ projektnummer: "G.7", station: "Mu", beschreibung: "Neu formuliert" }]) as [RegisterRecord];
      expect(await statusOf([row])).toEqual(["ambiguous"]);
      expect((await decide([row], "skip")).counts.skipped).toBe(1);
      expect(await statusOf([row])).toEqual(["skipped"]);
      expect((await decide([row], "skip")).counts.skipped).toBe(1); // idempotent: still one key, still one audit row
      expect(await count("project_source_keys", "kind='skip'")).toBeGreaterThanOrEqual(1);
      const edited = { ...row, fields: { ...row.fields, kommentar: "inzwischen ergänzt" } };
      expect(await statusOf([edited])).toEqual(["ambiguous"]);
      const before = await count("audit_log", "field='import.skip' AND entityLabel LIKE 'Mu%'");
      expect(before).toBe(1);
      expect((await decide([row], "unskip")).counts.unskipped).toBe(1);
      expect(await statusOf([row])).toEqual(["ambiguous"]);
      expect(await count("audit_log", "field='import.unskip' AND entityLabel LIKE 'Mu%'")).toBe(1);
    });

    it("a request that acts on only SOME rows of a chunk is judged in the context of the others (an already-accounted-for project stays accounted for)", async () => {
      const [ap, winner, loser] = planning([
        { projektnummer: "G.X9", station: "Xi", beschreibung: "Kontext", stand: "AP", termin: 45_000 },
        { projektnummer: "G.X9", station: "Xi", beschreibung: "Kontext", stand: "AP", termin: 45_300, kommentar: "A" },
        { projektnummer: "G.X9", station: "Xi", beschreibung: "Kontext", stand: "AP", termin: 45_300, kommentar: "B" },
      ]) as [RegisterRecord, RegisterRecord, RegisterRecord];
      await runImport([ap]); // the first AP registration is a project now
      // Alone, the winner (same phase, other Termin) looks like that project's edit (a held conflict); with the first row as
      // context that project is accounted for, and the winner is a registration of its own.
      expect((await imp.preview(admin, { records: [winner] })).rows[0]!.status).toBe("conflict");
      const ctxRows = [{ ref: ap.ref, projektnummer: ap.fields.projektnummer, station: ap.fields.station, projektbeschreibung: ap.fields.projektbeschreibung, projektstand: ap.fields.projektstand, terminProjektvorstellung: ap.fields.terminProjektvorstellung }];
      expect((await imp.preview(admin, { records: [winner], context: ctxRows })).rows[0]!.status).toBe("add");
      const res = await imp.apply(admin, { source: "t", part: { index: 1, total: 1 }, idempotencyKey: key(), context: ctxRows, rows: [
        { record: loser, action: "skip", overwrite: false, confirmed: false },
        { record: winner, action: "create", overwrite: false, confirmed: false },
      ] }, ctx());
      expect(res.counts).toMatchObject({ created: 1, skipped: 1 });
      expect(await count("projects", "projektnummer='G.X9'")).toBe(2);
    });

    it("AP and EP are separate registrations: the EP row is simply new next to the AP project — no question, no merge — and stays so on re-import", async () => {
      await runImport(parse([{ projektnummer: "G.8", station: "Nu", beschreibung: "Phasen", stand: "AP" }]));
      const [ep] = parse([{ projektnummer: "G.8", station: "Nu", beschreibung: "Phasen", stand: "EP", termin: 45_200 }]) as [RegisterRecord];
      const plan = (await imp.preview(admin, { records: [ep] })).rows[0]!;
      expect(plan).toMatchObject({ status: "add", candidates: [] });
      expect((await runImport([ep])).totals).toMatchObject({ created: 1, updated: 0, held: 0 });
      expect(await count("projects", "projektnummer='G.8'")).toBe(2);
      expect((await q<{ projektstand: string }>("SELECT projektstand FROM projects WHERE projektnummer='G.8' ORDER BY projektstand")).map((r) => r.projektstand)).toEqual(["AP", "EP"]);
      expect(await statusOf([ep])).toEqual(["unchanged"]);
      // each phase has its own reviews: the EP review does not touch the AP project
      const [apRow] = parse([{ projektnummer: "G.8", station: "Nu", beschreibung: "Phasen", stand: "AP", reviews: { ITK: ["offen", "Pia", 45_000] } }]) as [RegisterRecord];
      const apPlan = (await imp.preview(admin, { records: [apRow] })).rows[0]!;
      expect(["update", "conflict"]).toContain(apPlan.status); // matched to the AP project (its ITK review would change), never to the EP one
      expect(apPlan.match?.projectId).toBe((await q<{ id: number }>("SELECT id FROM projects WHERE projektnummer='G.8' AND projektstand='AP'"))[0]!.id);
    });

    it("a second registration of the SAME phase (another Termin) is a held conflict; 'own registration' creates it and it is remembered", async () => {
      await runImport(parse([{ projektnummer: "G.8b", station: "Nu", beschreibung: "Zweiter Termin", stand: "AP", termin: 45_000 }]));
      const [second] = parse([{ projektnummer: "G.8b", station: "Nu", beschreibung: "Zweiter Termin", stand: "AP", termin: 45_300 }]) as [RegisterRecord];
      expect((await imp.preview(admin, { records: [second] })).rows[0]).toMatchObject({ status: "conflict", basis: "core" });
      expect((await decide([second], "create")).counts).toMatchObject({ exists: 1, created: 0 }); // not without the explicit statement
      expect((await decide([second], "create", true)).counts).toMatchObject({ created: 1 });
      expect(await count("projects", "projektnummer='G.8b'")).toBe(2);
      expect(await statusOf([second])).toEqual(["unchanged"]);
    });
  });

  it("idempotency: the same key with the same chunk replays; with another chunk it is refused", async () => {
    const fresh = parse([{ projektnummer: "G.9", station: "Epsilon" }]);
    const body = { source: "t", part: { index: 1, total: 1 }, idempotencyKey: key(), rows: [{ record: fresh[0]!, action: "create" as const, overwrite: false, confirmed: false }] };
    const first = await imp.apply(admin, body, ctx());
    const again = await imp.apply(admin, body, ctx());
    expect(first.counts.created).toBe(1);
    expect(again).toMatchObject({ replayed: true, counts: first.counts });
    expect(await count("projects", "station='Epsilon'")).toBe(1);
    const other = parse([{ projektnummer: "G.9", station: "Zeta" }]);
    await expect(imp.apply(admin, { ...body, rows: [{ record: other[0]!, action: "create", overwrite: false, confirmed: false }] }, ctx())).rejects.toBeInstanceOf(IdempotencyKeyReuseError);
  });

  it("a failure rolls the whole chunk back: nothing written, nothing published, key free again", async () => {
    const good = parse([{ projektnummer: "G.7", station: "Eta" }])[0]!;
    const bad = { ...parse([{ projektnummer: "G.8", station: "Theta" }])[0]!, fields: { ...parse([{ projektnummer: "G.8", station: "Theta" }])[0]!.fields, projektnummer: "x".repeat(300) } };
    const p0 = await count("projects"), e0 = await count("domain_events");
    await expect(imp.apply(admin, { source: "t", part: { index: 1, total: 1 }, idempotencyKey: key(), rows: [{ record: good, action: "create", overwrite: false, confirmed: false }, { record: bad, action: "create", overwrite: false, confirmed: false }] }, ctx())).rejects.toThrow();
    expect(await count("projects")).toBe(p0);
    expect(await count("domain_events")).toBe(e0);
  });

  it("authorization: only an administrator previews or applies; editors, viewers and workspace-limited principals are refused", async () => {
    const body = { source: "t", part: { index: 1, total: 1 }, idempotencyKey: key(), rows: [{ record: records[0]!, action: "create" as const, overwrite: false, confirmed: false }] };
    for (const who of [markus, viewer, mitteOnly]) {
      await expect(imp.preview(who, { records })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(imp.apply(who, body, ctx())).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("deleting a project removes its source keys and clears (and audits) the link of its reports", async () => {
    const [p] = await q<{ id: number; syncVersion: number }>("SELECT id, syncVersion FROM projects WHERE station='Epsilon'");
    await importPruefberichte(t.pool, { source: "t", part: { index: 1, total: 1 }, records: importWorkbookSheets([{ name: "2025", rows: [[...H2020], row2020("25.900", { projektnummer: "G.9", bahnhof: "Epsilon" })] }]).records }, { name: "t" });
    const [pb] = await q<{ id: number; version: number }>("SELECT id, version FROM itk_pruefberichte WHERE laufendeNummer='25.900'");
    await links.setLink(admin, { id: pb!.id, expectedVersion: pb!.version, projectId: p!.id, idempotencyKey: key() }, ctx());
    expect(await count("itk_pruefberichte", `projectId=${p!.id}`)).toBe(1);
    await projects.delete(admin, { id: p!.id, expectedVersion: p!.syncVersion, idempotencyKey: key() }, ctx());
    expect(await count("project_source_keys", `projectId=${p!.id}`)).toBe(0);
    const [after] = await q<{ projectId: number | null; version: number }>("SELECT projectId, version FROM itk_pruefberichte WHERE id=?", [pb!.id]);
    expect(after).toEqual({ projectId: null, version: pb!.version + 2 });
    expect(await count("audit_log", `entityType='pruefbericht' AND entityId=${pb!.id} AND field='projectId' AND newValue IS NULL AND oldValue='${p!.id}'`)).toBe(1);
  });

  // ---------------------------------------------------------------- Prüfbericht ↔ project -----------------------------

  describe("Prüfbericht links", () => {
    let alphaAP: number, alphaEP: number, beta: number, delta: number;
    // "Abnahmeprüfung" states no phase; "fachtechnische Prüfung EP" does (shared/itk/project-link.ts reportPhase)
    const NO_PHASE = "Abnahmeprüfung";
    const reports = importWorkbookSheets([{
      name: "2026",
      rows: [[...H2020],
        row2020("26.001", { projektnummer: "G.2", bahnhof: "Delta", taetigkeit: NO_PHASE }),                                  // unique: one project with number + station
        row2020("26.002", { projektnummer: "G.1", bahnhof: "Alpha", taetigkeit: NO_PHASE }),                                  // ambiguous: Alpha has an AP and an EP registration, no phase stated
        row2020("26.003", { projektnummer: "G.1", bahnhof: "Beta", taetigkeit: NO_PHASE }),                                   // unique
        row2020("26.004", { projektnummer: "G.1", bahnhof: "Gamma-Stadt", taetigkeit: NO_PHASE }),                            // number known, station differs → suggestions only
        row2020("26.005", { projektnummer: null, bahnhof: "Alpha", taetigkeit: NO_PHASE }),                                   // no number
        row2020("26.006", { projektnummer: "G.404", bahnhof: "Alpha", taetigkeit: NO_PHASE }),                                // no such project
        row2020("26.007", { projektnummer: "G.1", bahnhof: "Alpha", taetigkeit: "fachtechnische Prüfung EP" }),               // states EP → the EP registration of Alpha, never the AP one
        row2020("26.008", { projektnummer: "G.2", bahnhof: "Delta", taetigkeit: "fachtechnische Prüfung EP" }),               // states EP, but Delta's only project is AP → not linked
      ],
    }]).records;

    beforeAll(async () => {
      await importPruefberichte(t.pool, { source: "t", part: { index: 1, total: 1 }, records: reports }, { name: "t" });
      const id = async (station: string, stand?: string) => (await q<{ id: number }>("SELECT id FROM projects WHERE station=?" + (stand ? " AND projektstand=?" : ""), stand ? [station, stand] : [station]))[0]!.id;
      alphaAP = await id("Alpha", "AP"); alphaEP = await id("Alpha", "EP"); beta = await id("Beta"); delta = await id("Delta");
    });
    const pbOf = async (nr: string) => (await q<{ id: number; version: number; projectId: number | null; projectLinkSource: string | null }>("SELECT id, version, projectId, projectLinkSource FROM itk_pruefberichte WHERE laufendeNummer=?", [nr]))[0]!;

    it("candidates: the evidence verdict, with the suggestions that do not amount to a link", async () => {
      const amb = await linkCandidatesOf(t.pool, (await pbOf("26.002")).id);
      expect(amb).toMatchObject({ verdict: "ambiguous" });
      expect(amb!.candidates.filter((c) => c.evidence === "projektnummer+station").map((c) => c.projectId).sort()).toEqual([alphaAP, alphaEP].sort());
      const wrongStation = await linkCandidatesOf(t.pool, (await pbOf("26.004")).id);
      expect(wrongStation).toMatchObject({ verdict: "unmatched" });
      expect(wrongStation!.candidates.length).toBeGreaterThanOrEqual(3);
      expect(wrongStation!.candidates.every((c) => c.evidence === "projektnummer")).toBe(true);
      expect((await linkCandidatesOf(t.pool, (await pbOf("26.005")).id))!.candidates).toEqual([]);
      expect(await linkCandidatesOf(t.pool, 999_999)).toBeNull();
    });

    it("dry run reports what would be linked and writes nothing", async () => {
      const r = await links.autoLink(admin, { dryRun: true, idempotencyKey: key() }, ctx());
      expect(r).toMatchObject({ dryRun: true, linked: 3, ambiguous: { count: 1 } });
      // 26.006 (no such number) and 25.900 (its project was deleted above) both have an unknown Projektnummer
      expect(r.unmatched).toEqual({ "station-passt-nicht": 1, "keine-projektnummer": 1, "projektnummer-unbekannt": 2, "phase-passt-nicht": 1 });
      expect(await count("itk_pruefberichte", "projectId IS NOT NULL")).toBe(0);
    });

    it("auto-link links exactly the unique ones, audits each, and leaves ambiguous and unmatched reports alone", async () => {
      const a0 = await count("audit_log", "entityType='pruefbericht' AND field='projectId'");
      const r = await links.autoLink(admin, { dryRun: false, idempotencyKey: key() }, ctx());
      expect(r).toMatchObject({ linked: 3, examined: 9 });
      expect(await pbOf("26.001")).toMatchObject({ projectId: delta, projectLinkSource: "auto", version: 2 });
      expect(await pbOf("26.003")).toMatchObject({ projectId: beta, projectLinkSource: "auto" });
      // the report that states EP goes to Alpha's EP registration — and only that one
      expect(await pbOf("26.007")).toMatchObject({ projectId: alphaEP, projectLinkSource: "auto" });
      for (const nr of ["26.002", "26.004", "26.005", "26.006", "26.008"]) expect((await pbOf(nr)).projectId).toBeNull();
      expect(await count("audit_log", "entityType='pruefbericht' AND field='projectId'")).toBe(a0 + 3);
    });

    it("running auto-link again changes nothing (idempotent), and a replayed key returns the stored answer", async () => {
      const k = key();
      const first = await links.autoLink(admin, { dryRun: false, idempotencyKey: k }, ctx());
      expect(first.linked).toBe(0);
      expect(await links.autoLink(admin, { dryRun: false, idempotencyKey: k }, ctx())).toMatchObject({ replayed: true });
    });

    it("an explicit choice resolves the ambiguous report; the project then lists it, and the report lists the project", async () => {
      const pb = await pbOf("26.002");
      const res = await links.setLink(markus, { id: pb.id, expectedVersion: pb.version, projectId: alphaEP, idempotencyKey: key() }, ctx());
      expect(res).toMatchObject({ projectId: alphaEP, version: pb.version + 1, replayed: false });
      expect(await pbOf("26.002")).toMatchObject({ projectId: alphaEP, projectLinkSource: "manual" });
      expect((await pruefberichteOfProject(t.pool, alphaEP)).map((r) => r.laufendeNummer)).toEqual(["26.007", "26.002"]); // 26.007 states EP and was linked automatically
      expect((await pruefberichteOfProject(t.pool, alphaAP))).toEqual([]);
      const listed = (await listPruefberichte(t.pool, { limit: 50, q: "26.002" })).rows[0]!;
      expect(listed).toMatchObject({ projectId: alphaEP, project: { projektnummer: "G.1", station: "Alpha" } });
    });

    it("one project can hold several reports", async () => {
      const pb = await pbOf("26.004");
      await links.setLink(admin, { id: pb.id, expectedVersion: pb.version, projectId: beta, idempotencyKey: key() }, ctx());
      expect((await pruefberichteOfProject(t.pool, beta)).map((r) => r.laufendeNummer).sort()).toEqual(["26.003", "26.004"]);
    });

    it("a stale version is a conflict, not an overwrite; a repeated key replays; setting the same value writes nothing", async () => {
      const pb = await pbOf("26.002");
      await expect(links.setLink(admin, { id: pb.id, expectedVersion: pb.version - 1, projectId: null, idempotencyKey: key() }, ctx())).rejects.toBeInstanceOf(StaleVersionError);
      const k = key();
      const body = { id: pb.id, expectedVersion: pb.version, projectId: alphaEP, idempotencyKey: k };
      const a0 = await count("audit_log", "entityType='pruefbericht' AND field='projectId'");
      expect(await links.setLink(admin, body, ctx())).toMatchObject({ version: pb.version, replayed: false });
      expect(await count("audit_log", "entityType='pruefbericht' AND field='projectId'")).toBe(a0);
      expect(await links.setLink(admin, body, ctx())).toMatchObject({ replayed: true });
    });

    it("unlinking clears the link and is audited", async () => {
      const pb = await pbOf("26.004");
      await links.setLink(admin, { id: pb.id, expectedVersion: pb.version, projectId: null, idempotencyKey: key() }, ctx());
      expect(await pbOf("26.004")).toMatchObject({ projectId: null, projectLinkSource: "detached" }); // a decision, not "never linked"
      expect(await count("audit_log", `entityType='pruefbericht' AND entityId=${pb.id} AND oldValue='${beta}' AND newValue IS NULL`)).toBe(1);
    });

    it("re-importing the workbook keeps the links (the import never sets or clears them)", async () => {
      const before = await q("SELECT id, projectId, projectLinkSource FROM itk_pruefberichte ORDER BY id");
      const res = await importPruefberichte(t.pool, { source: "t", part: { index: 1, total: 1 }, records: reports }, { name: "t" });
      expect(res).toMatchObject({ inserted: 0, updated: 0 });
      expect(await q("SELECT id, projectId, projectLinkSource FROM itk_pruefberichte ORDER BY id")).toEqual(before);
    });

    it("authorization: viewers and workspace-limited editors cannot link; the target project must exist and be editable; auto-link is admin-only", async () => {
      const pb = await pbOf("26.005");
      for (const who of [viewer, mitteOnly]) {
        await expect(links.setLink(who, { id: pb.id, expectedVersion: pb.version, projectId: alphaAP, idempotencyKey: key() }, ctx())).rejects.toBeInstanceOf(ForbiddenError);
      }
      await expect(links.setLink(admin, { id: pb.id, expectedVersion: pb.version, projectId: 987_654, idempotencyKey: key() }, ctx())).rejects.toBeInstanceOf(NotFoundError);
      await expect(links.setLink(admin, { id: 987_654, expectedVersion: 1, projectId: alphaAP, idempotencyKey: key() }, ctx())).rejects.toBeInstanceOf(NotFoundError);
      await expect(links.autoLink(markus, { dryRun: true, idempotencyKey: key() }, ctx())).rejects.toBeInstanceOf(ForbiddenError);
      expect((await pbOf("26.005")).projectId).toBeNull();
    });

    it("a link removed on purpose is not re-attached by the automatic link — and can still be set by hand", async () => {
      const pb = await pbOf("26.003"); // unique: Beta
      expect(pb.projectId).toBe(beta);
      await links.setLink(admin, { id: pb.id, expectedVersion: pb.version, projectId: null, idempotencyKey: key() }, ctx());
      expect(await pbOf("26.003")).toMatchObject({ projectId: null, projectLinkSource: "detached" });
      const dry = await links.autoLink(admin, { dryRun: true, idempotencyKey: key() }, ctx());
      const wet = await links.autoLink(admin, { dryRun: false, idempotencyKey: key() }, ctx());
      expect(wet.linked).toBe(dry.linked);
      expect((await pbOf("26.003")).projectId).toBeNull();
      expect((await linkSummary(t.pool)).unmatched["bewusst nicht zugeordnet"]).toBeGreaterThanOrEqual(1);
      const again = await pbOf("26.003");
      await links.setLink(admin, { id: again.id, expectedVersion: again.version, projectId: beta, idempotencyKey: key() }, ctx());
      expect(await pbOf("26.003")).toMatchObject({ projectId: beta, projectLinkSource: "manual" });
    });

    it("automatic links that no longer satisfy the rule are counted, not undone", async () => {
      const before = (await linkSummary(t.pool)).staleAuto;
      const auto = (await q<{ id: number; projectId: number }>("SELECT id, projectId FROM itk_pruefberichte WHERE projectLinkSource='auto' LIMIT 1"))[0]!;
      await t.pool.query("UPDATE projects SET station='Ganz woanders' WHERE id=?", [auto.projectId]);
      expect((await linkSummary(t.pool)).staleAuto).toBeGreaterThan(before);
      expect((await q<{ projectId: number }>("SELECT projectId FROM itk_pruefberichte WHERE id=?", [auto.id]))[0]!.projectId).toBe(auto.projectId);
    });
  });

  describe("concurrency and number spelling", () => {
    const one = (extra: Partial<RowSpec> = {}) => parse([{ projektnummer: "G.RACE1", station: "Rennstadt", beschreibung: "Gleichzeitig", stand: "AP", ...extra } as RowSpec])[0]!;

    it("two imports of the same new registration with different keys create ONE project; the loser is told", async () => {
      const rec = one();
      const send = (rowKey: string) => imp.apply(admin, { source: "race.xlsm", part: { index: 1, total: 1 }, rows: [{ record: rec, action: "create", overwrite: false, confirmed: false }], idempotencyKey: rowKey }, ctx());
      const [a, b] = await Promise.all([send(key()), send(key())]);
      const kinds = [a.outcomes[0]!.outcome, b.outcomes[0]!.outcome].sort();
      expect(kinds).toEqual(["created", "exists"]);
      expect(await count("projects", "projektnummer='G.RACE1'")).toBe(1);
      // the key row names its owner
      expect(await count("project_source_keys", `sourceKey='${sourceKeyHash(fullKey({ ...rec.fields }))}' AND projectId IS NOT NULL`)).toBe(1);
    });

    it("a project whose number carries a non-breaking space is still found (SQL and JavaScript agree on 'the same number')", async () => {
      const spaced = one({ projektnummer: "G.\u00a0NB1", station: "Leerzeichen", beschreibung: "NBSP" });
      await imp.apply(admin, { source: "nb.xlsm", part: { index: 1, total: 1 }, rows: [{ record: spaced, action: "create", overwrite: false, confirmed: false }], idempotencyKey: key() }, ctx());
      await t.pool.query("DELETE FROM project_source_keys WHERE projectId IN (SELECT id FROM projects WHERE station='Leerzeichen')"); // as if created by hand, not by an import
      const again = one({ projektnummer: "G.NB1", station: "Leerzeichen", beschreibung: "NBSP" });
      const plan = (await imp.preview(admin, { records: [again] })).rows[0]!;
      expect(plan.status).toBe("unchanged");
      expect(await linkCandidatesOf(t.pool, (await pbOf2("G.NB1")).id)).toMatchObject({ candidates: [{ station: "Leerzeichen" }] });
    });

    const pbOf2 = async (pn: string) => {
      await importPruefberichte(t.pool, { source: "nb", part: { index: 1, total: 1 }, records: importWorkbookSheets([{ name: "2026", rows: [[...H2020], row2020("26.900", { projektnummer: pn, bahnhof: "Leerzeichen", taetigkeit: "Abnahmeprüfung" })] }]).records }, { name: "t" });
      return (await q<{ id: number }>("SELECT id FROM itk_pruefberichte WHERE laufendeNummer='26.900'"))[0]!;
    };

    it("auto-link never links to a project that is deleted meanwhile (target locked first), and one changed report does not abort the run", async () => {
      const gone = one({ projektnummer: "G.GONE", station: "Verschwindet", beschreibung: "x" });
      const res = await imp.apply(admin, { source: "g.xlsm", part: { index: 1, total: 1 }, rows: [{ record: gone, action: "create", overwrite: false, confirmed: false }], idempotencyKey: key() }, ctx());
      const id = res.outcomes[0]!.projectId!;
      await importPruefberichte(t.pool, { source: "g", part: { index: 1, total: 1 }, records: importWorkbookSheets([{ name: "2026", rows: [[...H2020], row2020("26.901", { projektnummer: "G.GONE", bahnhof: "Verschwindet", taetigkeit: "Abnahmeprüfung" })] }]).records }, { name: "t" });
      const p = (await q<{ syncVersion: number }>("SELECT syncVersion FROM projects WHERE id=?", [id]))[0]!;
      await projects.delete(admin, { id, expectedVersion: p.syncVersion, idempotencyKey: key() }, ctx());
      const out = await links.autoLink(admin, { dryRun: false, idempotencyKey: key() }, ctx());
      expect(out.examined).toBeGreaterThan(0);
      expect(await count("itk_pruefberichte", "laufendeNummer='26.901' AND projectId IS NOT NULL")).toBe(0);
      expect(await count("itk_pruefberichte", "projectId IS NOT NULL AND projectId NOT IN (SELECT id FROM projects)")).toBe(0);
    });
  });
});
