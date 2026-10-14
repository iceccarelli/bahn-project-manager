/**
 * The Übersichtsliste import and the Prüfbericht ↔ project link through the tRPC surface (identity → authorization →
 * validation → domain → database), against a real database: who may call what, workspace isolation of project data AND of
 * the ITK report dataset, and the conflict payload.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasTestDb, createTestDatabase, TEST_DB_URL } from "./testing/testDb";
import type { TrpcContext } from "./_core/context";
import type { Principal } from "./domain/permissions";
import { analyzeSource, parseRegisterWorkbook } from "@shared/register/register-import";
import { registerRow, registerSheet, type RowSpec } from "@shared/register/testing";
import { importWorkbookSheets } from "@shared/itk/pruefbericht-import";
import { H2020, row2020 } from "@shared/itk/testing";

const user = (id: number, role: "admin" | "user") => ({
  id, openId: `t-${id}`, name: `User ${id}`, email: `u${id}@bahn.de`, loginMethod: "test", role,
  createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
});
const principal = (id: number, role: Principal["role"], extra: Partial<Principal> = {}): Principal =>
  ({ id: String(id), name: `User ${id}`, email: null, role, workspaces: "ALL", departments: [], ...extra });
const ctxFor = (p: Principal | null): TrpcContext => ({
  user: p ? user(Number(p.id), p.role === "admin" ? "admin" : "user") : null,
  principal: p, traceId: "trace-register-0001", requestId: "req-1",
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: { clearCookie() {}, setHeader() {} } as unknown as TrpcContext["res"],
});
const recs = (rows: RowSpec[]) => analyzeSource(parseRegisterWorkbook([registerSheet(rows.map(registerRow))]).records).accepted;

describe.skipIf(!hasTestDb)("register import + report links over tRPC (real DB)", () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let appRouter: typeof import("./routers").appRouter;
  let closeDb: typeof import("./db").closeDb;
  let services: Awaited<ReturnType<typeof import("./_core/services").requireServices>>;
  const as = (p: Principal | null) => appRouter.createCaller(ctxFor(p));
  const admin = principal(1, "admin"), editorAll = principal(2, "editor"), viewerAll = principal(4, "viewer");
  const frankfurtOnly = principal(5, "editor", { workspaces: ["Frankfurt"] });
  let n = 0;
  const key = () => `reg-key-${Date.now()}-${n++}-xxxx`;

  beforeAll(async () => {
    t = await createTestDatabase(10);
    process.env.DATABASE_URL = `${TEST_DB_URL}/${t.name}`;
    ({ appRouter } = await import("./routers"));
    ({ closeDb } = await import("./db"));
    services = await (await import("./_core/services")).requireServices();
  });
  afterAll(async () => {
    await services?.shutdown();
    await closeDb?.();
    await t?.drop();
  });

  const records = recs([
    { projektnummer: "G.1", station: "Kassel Hbf", bm: "Kassel" },
    { projektnummer: "G.1", station: "Mainz Hbf", bm: "Mainz", beschreibung: "Anderer Umbau" },
  ]);
  const apply = (c: ReturnType<typeof as>, r = records) =>
    c.projects.registerApply({ source: "t.xlsm", part: { index: 1, total: 1 }, idempotencyKey: key(), rows: r.map((record) => ({ record, action: "create" as const, overwrite: false, confirmed: false })) });

  it("rejects anonymous callers and every non-admin on the import procedures", async () => {
    // adminProcedure answers FORBIDDEN to everyone who is not an admin, anonymous included; protected ones answer UNAUTHORIZED
    await expect(as(null).projects.registerPreview({ records })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as(null).pruefberichte.forProject({ projectId: 1 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(as(null).pruefberichte.setLink({ id: 1, expectedVersion: 1, projectId: 1, idempotencyKey: key() })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    for (const p of [editorAll, viewerAll, frankfurtOnly]) {
      await expect(as(p).projects.registerPreview({ records })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(apply(as(p))).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(as(p).pruefberichte.autoLink({ dryRun: true, idempotencyKey: key() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("validates the body (strict shapes, bounded sizes)", async () => {
    await expect(as(admin).projects.registerPreview({ records: [] } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const bad = { ...records[0]!, fields: { ...records[0]!.fields, bahnhofsmanagement: "Atlantis" } };
    await expect(as(admin).projects.registerPreview({ records: [bad] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("preview → apply by an administrator; the imported projects respect workspaces afterwards", async () => {
    const prev = await as(admin).projects.registerPreview({ records });
    expect(prev.summary).toMatchObject({ records: 2, add: 2 });
    const res = await apply(as(admin));
    expect(res.counts.created).toBe(2);
    const all = await as(admin).projects.list({ limit: 50, sort: "id", dir: "asc", expand: [], includeTotal: false } as never);
    expect(all.items.map((p) => p.station).sort()).toEqual(["Kassel Hbf", "Mainz Hbf"]);
    // a Frankfurt-only editor sees neither (workspace isolation holds for imported rows exactly as for hand-made ones)
    const mine = await as(frankfurtOnly).projects.list({ limit: 50, sort: "id", dir: "asc", expand: [], includeTotal: false } as never);
    expect(mine.items).toEqual([]);
    await expect(as(frankfurtOnly).projects.get({ id: all.items[0]!.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("the import is visible in the Änderungshistorie (one row for the batch, rows for every created project)", async () => {
    const page = await as(admin).audit.page({ limit: 100 } as never);
    expect(page.items.some((i) => i.field === "import" && i.label?.startsWith("t.xlsm · Teil 1/1"))).toBe(true);
    expect(page.items.filter((i) => i.action === "create" && i.field === "station").length).toBeGreaterThanOrEqual(2);
  });

  describe("reports of a project", () => {
    let kassel: number, mainz: number, pbId: number, pbVersion: number;
    beforeAll(async () => {
      const list = await as(admin).projects.list({ limit: 50, sort: "id", dir: "asc", expand: [], includeTotal: false } as never);
      kassel = list.items.find((p) => p.station === "Kassel Hbf")!.id;
      mainz = list.items.find((p) => p.station === "Mainz Hbf")!.id;
      const batch = importWorkbookSheets([{ name: "2026", rows: [[...H2020], row2020("26.001", { projektnummer: "G.1", bahnhof: "Kassel Hbf", taetigkeit: "Abnahmeprüfung" })] }]).records;
      await as(admin).pruefberichte.import({ source: "t.xlsx", part: { index: 1, total: 1 }, records: batch });
      const rows = (await as(admin).pruefberichte.list({ limit: 10 })).rows;
      pbId = rows[0]!.id; pbVersion = rows[0]!.version;
    });

    it("report data is default-deny for workspace-limited principals, on every new procedure too", async () => {
      await expect(as(frankfurtOnly).pruefberichte.forProject({ projectId: kassel })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(as(frankfurtOnly).pruefberichte.linkCandidates({ id: pbId })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(as(frankfurtOnly).pruefberichte.list({ limit: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(as(frankfurtOnly).pruefberichte.setLink({ id: pbId, expectedVersion: pbVersion, projectId: kassel, idempotencyKey: key() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("a viewer with an all-workspaces grant may read links but not change them", async () => {
      expect((await as(viewerAll).pruefberichte.forProject({ projectId: kassel })).rows).toEqual([]);
      await expect(as(viewerAll).pruefberichte.setLink({ id: pbId, expectedVersion: pbVersion, projectId: kassel, idempotencyKey: key() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("candidates name the project; the editor links it; the project detail lists the report; a stale write is a CONFLICT", async () => {
      const cands = await as(editorAll).pruefberichte.linkCandidates({ id: pbId });
      expect(cands).toMatchObject({ verdict: "unique" });
      expect(cands.candidates.map((c) => [c.projectId, c.evidence])).toEqual([[kassel, "projektnummer+station"], [mainz, "projektnummer"]]);
      const linked = await as(editorAll).pruefberichte.setLink({ id: pbId, expectedVersion: pbVersion, projectId: kassel, idempotencyKey: key() });
      expect(linked).toMatchObject({ projectId: kassel, version: pbVersion + 1 });
      const mine = await as(viewerAll).pruefberichte.forProject({ projectId: kassel });
      expect(mine.rows).toHaveLength(1);
      expect(mine.rows[0]).toMatchObject({ id: pbId, laufendeNummer: "26.001", projectId: kassel, project: { station: "Kassel Hbf" } });
      await expect(as(editorAll).pruefberichte.setLink({ id: pbId, expectedVersion: pbVersion, projectId: mainz, idempotencyKey: key() })).rejects.toMatchObject({ code: "CONFLICT" });
      // filters of the Projektübersicht ITK tab
      expect((await as(admin).pruefberichte.list({ limit: 10, verknuepfung: "offen" })).rows).toEqual([]);
      expect((await as(admin).pruefberichte.list({ limit: 10, projectId: kassel })).rows).toHaveLength(1);
      expect((await as(admin).pruefberichte.list({ limit: 10, projectId: mainz })).rows).toEqual([]);
    });

    it("forProject does not reveal projects the caller cannot see", async () => {
      // a principal with a report grant (ALL) but no access to that workspace cannot exist (ALL sees all); an unknown id is NOT_FOUND
      await expect(as(admin).pruefberichte.forProject({ projectId: 987_654 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
