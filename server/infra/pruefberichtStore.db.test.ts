/** ITK Prüfberichte against a REAL database: idempotent import, versioning, audit, dates, search, pagination, authorization. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, hasTestDb, TEST_DB_URL } from "../testing/testDb";
import { importPruefberichte, listPruefberichte, loadAllPruefberichte } from "./pruefberichtStore";
import { buildPruefberichtView } from "@shared/itk/pruefbericht-view";
import { importWorkbookSheets } from "@shared/itk/pruefbericht-import";
import type { ImportBatchInput } from "@shared/itk/pruefbericht-contract";
import type { TrpcContext } from "../_core/context";
import type { Principal } from "../domain/permissions";

const H = ["Laufende Nummer", "Datum", "Tätigkeitsbereich", "Art der Baumaßnahme", "EBA-Aktenzeichen", "Bf / Streckenbezeichnung", "Zuständige EBA Außenstelle", "Art der Technik", "Bauform/Bezeichnung", "Technik", "abgeschlossen", "Projektnummer", "zuständiger PL", "zuständiger FS", "Termin", "Beschriftung / PDF Code", "Link"];
const sheet = (year: number, rows: unknown[][]) => ({ name: String(year), rows: [H, ...rows] });
const row = (nr: string, over: Record<number, unknown> = {}) => {
  const r: unknown[] = [nr, 45_000, "Planprüfung", null, null, `Bahnhof ${nr}`, null, null, null, "Video", "Ja", `G.${nr}`, "Uwe Kessmann", "Ravdorf", 45_100, `P${nr} - Bahnhof ${nr}`, null];
  for (const [i, v] of Object.entries(over)) r[Number(i)] = v;
  return r;
};
const batchOf = (records: ImportBatchInput["records"], index = 1, total = 1): ImportBatchInput => ({ source: "test.xlsx", part: { index, total }, records });

describe.skipIf(!hasTestDb)("ITK Prüfberichte store (real DB)", () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  const actor = { name: "Admin" };
  const recs = importWorkbookSheets([
    sheet(2025, [row("25.001"), row("25.002", { 9: "WLAN", 10: "Nein" }), row("25.003", { 2: "Gutachten", 9: "Laser" })]),
    sheet(2024, [row("24.001", { 10: "in Bearbeitung" })]),
  ]).records;

  beforeAll(async () => { t = await createTestDatabase(10); });
  afterAll(async () => { await t?.drop(); });

  it("inserts, and a second import of the same rows changes nothing (no write, no version bump)", async () => {
    expect(await importPruefberichte(t.pool, batchOf(recs), actor)).toEqual({ inserted: 4, updated: 0, unchanged: 0 });
    expect(await importPruefberichte(t.pool, batchOf(recs), actor)).toEqual({ inserted: 0, updated: 0, unchanged: 4 });
    const all = await loadAllPruefberichte(t.pool);
    expect(all).toHaveLength(4);
    expect(all.every((r) => r.version === 1)).toBe(true);
  });

  it("stores dates as days and reads them back as the same strings, whatever the server time zone", async () => {
    const r = (await loadAllPruefberichte(t.pool)).find((x) => x.laufendeNummer === "25.001")!;
    expect(r.datum).toBe("2023-03-15");
    expect(r.termin).toBe("2023-06-23");
    expect(typeof r.datum).toBe("string");
  });

  it("updates only what changed, bumps the version once, and reports it", async () => {
    const changed = recs.map((r) => (r.laufendeNummer === "25.002" ? { ...r, abgeschlossen: "Ja" } : r));
    expect(await importPruefberichte(t.pool, batchOf(changed), actor)).toEqual({ inserted: 0, updated: 1, unchanged: 3 });
    const all = await loadAllPruefberichte(t.pool);
    expect(all.find((r) => r.laufendeNummer === "25.002")).toMatchObject({ abgeschlossen: "Ja", version: 2 });
    expect(all.filter((r) => r.version === 1)).toHaveLength(3);
  });

  it("writes exactly one audit row per batch, in the same transaction, visible to unrestricted principals only", async () => {
    const [rows] = (await t.pool.query("SELECT entityType, action, field, newValue, entityLabel, workspace, userName FROM audit_log WHERE entityType='pruefbericht' ORDER BY id")) as unknown as [any[]];
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ action: "create", field: "import", workspace: null, userName: "Admin", entityLabel: "test.xlsx · Teil 1/1" });
    expect(JSON.parse(rows[0].newValue)).toEqual({ inserted: 4, updated: 0, unchanged: 0, years: [2024, 2025] });
    expect(JSON.parse(rows[2].newValue)).toMatchObject({ updated: 1 });
  });

  it("a failing batch leaves nothing behind (rows and audit roll back together)", async () => {
    const before = (await loadAllPruefberichte(t.pool)).length;
    const [a0] = (await t.pool.query("SELECT COUNT(*) n FROM audit_log WHERE entityType='pruefbericht'")) as unknown as [any[]];
    const bad = batchOf([{ ...recs[0]!, laufendeNummer: "99.001" }, { ...recs[0]!, laufendeNummer: "99.002", bahnhofStrecke: "x".repeat(600) }]);
    await expect(importPruefberichte(t.pool, bad, actor)).rejects.toThrow();
    expect((await loadAllPruefberichte(t.pool)).length).toBe(before);
    const [a1] = (await t.pool.query("SELECT COUNT(*) n FROM audit_log WHERE entityType='pruefbericht'")) as unknown as [any[]];
    expect(a1[0].n).toBe(a0[0].n);
  });

  it("refuses a batch that names the same key twice, instead of picking a winner", async () => {
    await expect(importPruefberichte(t.pool, batchOf([recs[0]!, recs[0]!]), actor)).rejects.toThrow(/Doppelter Schlüssel/);
  });

  it("lists newest year first with a keyset cursor that loses and repeats nothing", async () => {
    const p1 = await listPruefberichte(t.pool, { limit: 3 });
    expect(p1.rows.map((r) => r.year)).toEqual([2025, 2025, 2025]);
    expect(p1.nextCursor).toMatch(/^\d{4}:\d+$/);
    const p2 = await listPruefberichte(t.pool, { limit: 3, cursor: p1.nextCursor! });
    expect(p2.rows.map((r) => r.year)).toEqual([2024]);
    expect(p2.nextCursor).toBeNull();
    expect(new Set([...p1.rows, ...p2.rows].map((r) => r.id)).size).toBe(4);
  });

  it("filters by year, Technik, abgeschlossen and searches every term across columns (LIKE wildcards are literal)", async () => {
    expect((await listPruefberichte(t.pool, { limit: 50, year: 2024 })).rows.map((r) => r.laufendeNummer)).toEqual(["24.001"]);
    expect((await listPruefberichte(t.pool, { limit: 50, technik: "WLAN" })).rows.map((r) => r.laufendeNummer)).toEqual(["25.002"]);
    expect((await listPruefberichte(t.pool, { limit: 50, abgeschlossen: "in Bearbeitung" })).rows).toHaveLength(1);
    expect((await listPruefberichte(t.pool, { limit: 50, q: "kessmann bahnhof 25.003" })).rows.map((r) => r.laufendeNummer)).toEqual(["25.003"]);
    expect((await listPruefberichte(t.pool, { limit: 50, q: "%" })).rows).toHaveLength(0);
  });

  it("the Technik view over the stored rows counts them and reconciles the PDF-Code", async () => {
    const v = buildPruefberichtView(await loadAllPruefberichte(t.pool), 0);
    expect(v.total).toBe(4);
    expect(v.years).toEqual([2024, 2025]);
    expect(v.technik.map((x) => [x.technik, x.count])).toEqual([["Video", 2], ["Laser", 1], ["WLAN", 1]].sort((a, b) => (b[1] as number) - (a[1] as number) || String(a[0]).localeCompare(String(b[0]), "de")));
    expect(v.pdfCode).toEqual({ derivable: 4, stored: 4, match: 3, mismatch: 1 }); // 25.003 is a Gutachten: stored P-code, formula gives G
  });
});

describe.skipIf(!hasTestDb)("pruefberichte router (real DB): who may do what", () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let appRouter: typeof import("./../routers").appRouter;
  let closeDb: typeof import("./../db").closeDb;
  let services: Awaited<ReturnType<typeof import("./../_core/services").requireServices>>;
  const user = (id: number, role: "admin" | "user") => ({ id, openId: `t-${id}`, name: `User ${id}`, email: `u${id}@bahn.de`, loginMethod: "test", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() });
  const principal = (id: number, role: Principal["role"], extra: Partial<Principal> = {}): Principal => ({ id: String(id), name: `User ${id}`, email: null, role, workspaces: "ALL", departments: [], ...extra });
  const ctxFor = (p: Principal | null): TrpcContext => ({
    user: p ? user(Number(p.id), p.role === "admin" ? "admin" : "user") : null,
    principal: p, traceId: "trace-pb-0001", requestId: "req-1",
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie() {}, setHeader() {} } as unknown as TrpcContext["res"],
  });
  const as = (p: Principal | null) => appRouter.createCaller(ctxFor(p));
  const admin = principal(1, "admin"), editorAll = principal(2, "editor"), editorKassel = principal(3, "editor", { workspaces: ["Kassel"] }), viewerNone = principal(4, "viewer", { workspaces: [] });
  const recs = importWorkbookSheets([sheet(2025, [row("25.001"), row("25.002")])]).records;
  const body = { source: "r.xlsx", part: { index: 1, total: 1 }, records: recs };

  beforeAll(async () => {
    t = await createTestDatabase(10);
    process.env.DATABASE_URL = `${TEST_DB_URL}/${t.name}`;
    ({ appRouter } = await import("./../routers"));
    ({ closeDb } = await import("./../db"));
    services = await (await import("./../_core/services")).requireServices();
  });
  afterAll(async () => { await services?.shutdown(); await closeDb?.(); await t?.drop(); });

  it("rejects the unauthenticated on every procedure", async () => {
    const c = as(null);
    await expect(c.pruefberichte.view()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(c.pruefberichte.list({ limit: 10 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(c.pruefberichte.import(body)).rejects.toMatchObject({ code: "FORBIDDEN" }); // admin-only gate answers FORBIDDEN
  });

  it("only an admin imports; an editor, even with an ALL grant, is refused", async () => {
    await expect(as(editorAll).pruefberichte.import(body)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await as(admin).pruefberichte.import(body)).toEqual({ inserted: 2, updated: 0, unchanged: 0 });
  });

  it("reads need an unrestricted principal: admin and an explicit ALL grant yes; a workspace-limited one no", async () => {
    expect((await as(admin).pruefberichte.view()).total).toBe(2);
    expect((await as(editorAll).pruefberichte.list({ limit: 10 })).rows).toHaveLength(2);
    await expect(as(editorKassel).pruefberichte.view()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as(editorKassel).pruefberichte.list({ limit: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as(viewerNone).pruefberichte.view()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("validates input at the edge: a key without a number, a date that is not a day, an oversize batch", async () => {
    await expect(as(admin).pruefberichte.import({ ...body, records: [{ ...recs[0]!, laufendeNummer: "" }] })).rejects.toBeTruthy();
    await expect(as(admin).pruefberichte.import({ ...body, records: [{ ...recs[0]!, datum: "22.03.2025" }] })).rejects.toBeTruthy();
    await expect(as(admin).pruefberichte.import({ ...body, records: Array.from({ length: 401 }, (_, i) => ({ ...recs[0]!, laufendeNummer: `25.${i}` })) })).rejects.toBeTruthy();
  });

  it("the audit page shows the import to an unrestricted principal and hides it from a workspace-limited one", async () => {
    const seen = await as(admin).audit.page({ entityType: "pruefbericht", limit: 10, days: 30 });
    expect(seen.items.length).toBeGreaterThan(0);
    const hidden = await as(editorKassel).audit.page({ entityType: "pruefbericht", limit: 10, days: 30 });
    expect(hidden.items).toHaveLength(0);
  });

  it("an import through the router is visible immediately in the view (cache invalidated)", async () => {
    const more = importWorkbookSheets([sheet(2025, [row("25.010")])]).records;
    await as(admin).pruefberichte.import({ ...body, records: more });
    expect((await as(admin).pruefberichte.view()).total).toBe(3);
  });
});
