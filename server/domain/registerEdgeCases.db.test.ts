/**
 * The awkward inputs measured on the real workbooks (shapes and proportions, synthetic content: shared/register/fixtures.ts)
 * through the WHOLE path against a real database: parse → preview → the administrator's decisions (built by the same
 * function the dialog uses) → apply → re-import → reports → automatic and explicit links → what the Abnahme gets.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { hasTestDb, createTestDatabase } from "../testing/testDb";
import { MysqlProjectStore } from "../infra/mysqlProjectStore";
import { importPruefberichte, linkSummary, pruefberichteOfProject } from "../infra/pruefberichtStore";
import { ProjectService } from "./projectService";
import { PruefberichtLinkService } from "./pruefberichtLinkService";
import { RegisterImportService } from "./registerImportService";
import { admin, ctx } from "./testFixtures";
import { edgeCaseRegisterSheet, edgeCaseReportSheets } from "@shared/link-fixtures";
import { analyzeSource, parseRegisterWorkbook } from "@shared/register/register-import";
import { buildApplyRows, type Choice, type ReviewRow } from "@shared/register/register-decisions";
import { chunkRecords, type PlanRow } from "@shared/register/register-plan";
import { importWorkbookSheets } from "@shared/itk/pruefbericht-import";
import { eligibleReports, protocolReference, selectReport } from "@shared/abnahme/pruefbericht";

const key = () => `k-${randomUUID()}`;

describe.skipIf(!hasTestDb)("edge cases through the whole path (real DB)", () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let imp: RegisterImportService;
  let links: PruefberichtLinkService;
  const source = analyzeSource(parseRegisterWorkbook([edgeCaseRegisterSheet()]).records);
  const q = async <R = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await t.pool.query(sql, args))[0] as R[];
  const count = async (table: string, where = "1=1") => Number((await q<{ n: number }>(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`))[0]!.n);

  beforeAll(async () => {
    t = await createTestDatabase(10);
    const store = new MysqlProjectStore(t.db as never);
    const projects = new ProjectService(store, () => {});
    imp = new RegisterImportService(store, projects);
    links = new PruefberichtLinkService(store);
  });
  afterAll(async () => { await t?.drop(); });

  /** the dialog's flow: preview every chunk, then apply what the choices (plus evidence-backed defaults) ask for */
  async function run(choices: Record<number, Choice> = {}) {
    const chunks = chunkRecords(source.forPlanning);
    const rows: ReviewRow[] = [];
    for (const [i, chunk] of chunks.entries()) for (const plan of (await imp.preview(admin, { records: chunk })).rows) rows.push({ plan: plan as PlanRow, record: chunk.find((r) => r.ref === plan.ref)!, chunk: i });
    const winnerPlans = new Map<number, PlanRow>();
    for (const r of rows) if (choices[r.plan.ref] === "wins") winnerPlans.set(r.plan.ref, (await imp.preview(admin, { records: [r.record] })).rows[0] as PlanRow);
    const totals: Record<string, number> = {};
    for (const [i, chunk] of chunks.entries()) {
      const built = buildApplyRows(rows.filter((r) => r.chunk === i), choices, winnerPlans);
      if (!built.rows.length) continue;
      const res = await imp.apply(admin, { source: "edge.xlsx", part: { index: i + 1, total: chunks.length }, rows: built.rows, idempotencyKey: key() }, ctx());
      for (const [k, n] of Object.entries(res.counts)) totals[k] = (totals[k] ?? 0) + n;
      void chunk;
    }
    return { rows, totals };
  }

  it("first import: the framework number becomes 11 projects (never merged); the two undecidable groups wait for a decision", async () => {
    const { rows, totals } = await run();
    expect(rows.filter((r) => r.plan.status === "ambiguous")).toHaveLength(4);
    expect(totals).toMatchObject({ created: source.accepted.length, updated: 0, held: 0 });
    expect(await count("projects", "projektnummer='G.F0001'")).toBe(11);
    expect(await count("projects", "projektnummer LIKE 'G.D000_' AND projektnummer <> 'G.D0003'")).toBe(0);
    expect(await count("projects", "projektnummer='G.D0003'")).toBe(1); // the cell-for-cell duplicate needed no decision
    // the lot is canonical, the placeholders are empty, the withheld statuses did not become statuses
    expect((await q<{ b: string | null }>("SELECT bahnhofsmanagement b FROM projects WHERE station='Los 1'"))[0]!.b).toBe("Darmstadt");
    expect((await q<{ b: string | null }>("SELECT bahnhofsmanagement b FROM projects WHERE station='Los 2'"))[0]!.b).toBeNull();
    expect(await count("department_reviews", "department='TBQ' AND status='Protokoll erstellt'")).toBe(0);
    const statusRow = (await q<{ prueferName: string | null }>("SELECT r.prueferName FROM department_reviews r JOIN projects p ON p.id=r.projectId WHERE p.station='Statusfall' AND r.department='TBQ'"))[0]!;
    expect(statusRow.prueferName).toBe("Tom"); // name kept, status withheld
    // dates: the unparseable ones are empty, the good one is in
    expect(await count("projects", "station LIKE 'Datumsfall%' AND terminProjektvorstellung IS NULL")).toBe(3);
    expect((await q<{ d: Date }>("SELECT terminProjektvorstellung d FROM projects WHERE station='Datumsfall 4'"))[0]!.d.toISOString().slice(0, 10)).toBe("2026-02-17");
  });

  it("the administrator resolves the groups (one row wins, the other group is excluded) and the same file then asks nothing", async () => {
    const before = await run();
    const group = (code: string) => before.rows.filter((r) => r.plan.status === "ambiguous" && r.record.fields.projektnummer === code);
    const [firstA, secondA] = group("G.D0001") as [ReviewRow, ReviewRow];
    const choices: Record<number, Choice> = { [secondA.plan.ref]: "wins", [firstA.plan.ref]: "open" };
    for (const r of group("G.D0002")) choices[r.plan.ref] = "skip";
    const { totals } = await run(choices);
    expect(totals).toMatchObject({ created: 1, skipped: 2 + 1 }); // the winner; D0001's loser; both rows of D0002
    expect((await q<{ s: string }>("SELECT r.status s FROM department_reviews r JOIN projects p ON p.id=r.projectId WHERE p.projektnummer='G.D0001' AND r.department='ITK'"))[0]!.s).toBe("Zustimmung erteilt");
    expect(await count("projects", "projektnummer='G.D0002'")).toBe(0);

    const events = await count("domain_events"), audits = await count("audit_log", "field IS NULL OR field NOT LIKE 'import%'");
    const again = await run();
    expect(again.rows.filter((r) => r.plan.status === "ambiguous" || r.plan.status === "conflict")).toEqual([]);
    expect(again.rows.filter((r) => r.plan.status === "skipped")).toHaveLength(3);
    expect(again.totals).toMatchObject({ created: 0, updated: 0, held: 0 });
    expect(await count("domain_events")).toBe(events);
    expect(await count("audit_log", "field IS NULL OR field NOT LIKE 'import%'")).toBe(audits);
  });

  describe("reports", () => {
    const sheets = edgeCaseReportSheets();
    const reports = importWorkbookSheets(sheets).records;
    const pbId = async (nr: string, year?: number) => (await q<{ id: number; version: number }>("SELECT id, version FROM itk_pruefberichte WHERE laufendeNummer=?" + (year ? " AND year=?" : ""), year ? [nr, year] : [nr]))[0]!;
    const projectId = async (station: string, stand = "AP") => (await q<{ id: number }>("SELECT id FROM projects WHERE station=? AND projektstand=?", [station, stand]))[0]!.id;

    beforeAll(async () => { await importPruefberichte(t.pool, { source: "edge.xlsx", part: { index: 1, total: 1 }, records: reports }, { name: "t" }); });

    it("automatic linking links exactly the evidence-unique ones; every other report stays open for a stated reason", async () => {
      const dry = await links.autoLink(admin, { dryRun: true, idempotencyKey: key() }, ctx());
      expect(dry.linked).toBe(3); // 25.001 (qualifier), 25.002 (Hbf), 25.008 (odd Technik, still unique)
      const res = await links.autoLink(admin, { dryRun: false, idempotencyKey: key() }, ctx());
      expect(res.linked).toBe(3);
      const summary = await linkSummary(t.pool);
      expect(summary).toMatchObject({ total: reports.length, linked: 3, open: reports.length - 3 });
      expect(summary.ambiguous).toBe(2); // 25.003 (Alpha AP/EP) and 22.001 (Beispieldorf AP/EP)
      expect(summary.unmatched).toMatchObject({ "keine-projektnummer": 6, "station-passt-nicht": 1, "projektnummer-unbekannt": 1 }); // 6 = 25.005, 25.006, both 25.010, and the two legacy-sheet reports (those sheets have no Projektnummer column)
      expect(await count("itk_pruefberichte", "projectId IS NOT NULL")).toBe(3);
    });

    it("Abnahme population after linking: none → one → must choose, with the right number and the derived code each time", async () => {
      const alphaEP = await projectId("Alpha", "EP");
      const read = async () => (await pruefberichteOfProject(t.pool, alphaEP));
      const ref = async (technik: "ZIM" | "Video") => protocolReference(selectReport(eligibleReports(technik, await read()), null));
      expect(await read()).toEqual([]);
      expect(await ref("ZIM")).toBeNull(); // none: no reference, no block

      const a = await pbId("25.003");
      await links.setLink(admin, { id: a.id, expectedVersion: a.version, projectId: alphaEP, idempotencyKey: key() }, ctx());
      expect(await ref("ZIM")).toEqual({ nummer: "25.003 (2025)", pdfCode: "P25.003 - Alpha" }); // one: used
      expect(await ref("Video")).toBeNull(); // another Technik is not offered for this Abnahme

      const b = await pbId("25.004");
      await links.setLink(admin, { id: b.id, expectedVersion: b.version, projectId: alphaEP, idempotencyKey: key() }, ctx());
      const eligible = eligibleReports("ZIM", await read());
      expect(eligible).toHaveLength(2);
      expect(selectReport(eligible, null).status).toBe("choose");
      expect(protocolReference(selectReport(eligible, null))).toBeNull(); // must choose first
      expect(protocolReference(selectReport(eligible, b.id))).toEqual({ nummer: "25.004 (2025)", pdfCode: "P25.004 - Ganz woanders" });
    });

    it("a re-import of either workbook changes nothing: links, decisions and projects stay", async () => {
      const links0 = await q("SELECT id, projectId, projectLinkSource, version FROM itk_pruefberichte ORDER BY id");
      expect(await importPruefberichte(t.pool, { source: "edge.xlsx", part: { index: 1, total: 1 }, records: reports }, { name: "t" })).toMatchObject({ inserted: 0, updated: 0 });
      expect(await q("SELECT id, projectId, projectLinkSource, version FROM itk_pruefberichte ORDER BY id")).toEqual(links0);
      const projects0 = await q("SELECT id, syncVersion FROM projects ORDER BY id");
      const again = await run();
      expect(again.totals).toMatchObject({ created: 0, updated: 0 });
      expect(await q("SELECT id, syncVersion FROM projects ORDER BY id")).toEqual(projects0);
    });
  });
});
