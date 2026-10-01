/** Security/forensic audit guarantees (real DB): grants, document actions, delete snapshots, checklist-created reviews. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { hasTestDb, createTestDatabase } from "../testing/testDb";
import { MysqlProjectStore } from "../infra/mysqlProjectStore";
import { ProjectService } from "./projectService";
import { BookingService } from "./bookingService";
import { ChecklistService } from "./checklistService";
import { NotFoundError } from "./errors";
import { admin, ctx, markus, mitteOnly } from "./testFixtures";
import { grantJson, provisionBatch } from "../_core/identity";
import { pageAudit } from "../infra/auditQuery";
import { defaultAnswers } from "@shared/checklist";
import type { Principal } from "./permissions";

const key = () => `k-${randomUUID()}`;
const kasselOnly: Principal = { ...mitteOnly, id: "6", name: "Kai", workspaces: ["Kassel"] };

describe.skipIf(!hasTestDb)("security audit (real DB)", () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let svc: ProjectService, checklists: ChecklistService;

  beforeAll(async () => {
    t = await createTestDatabase(10);
    const store = new MysqlProjectStore(t.db as never);
    svc = new ProjectService(store, () => {});
    checklists = new ChecklistService(store, svc, new BookingService(store, () => {}), () => {});
  });
  afterAll(async () => { await t?.drop(); });

  it("authorization grants: first sighting and every CHANGE of role/workspaces/departments is audited; an unchanged grant is not", async () => {
    const g1 = grantJson({ role: "editor", workspaces: ["Kassel"], departments: ["ITK"] });
    const g2 = grantJson({ role: "admin", workspaces: "ALL", departments: [] });
    const u = { openId: "oidc:alice", name: "Alice", email: "alice@example.invalid", role: "user" as const };
    await provisionBatch(t.pool, [{ ...u, grant: g1 }]);
    await provisionBatch(t.pool, [{ ...u, grant: g1 }]); // same grant: nothing
    await provisionBatch(t.pool, [{ ...u, role: "admin", grant: g2 }]);
    const rows = (await pageAudit(t.pool, null, { entityType: "user", days: 0, limit: 10 })).items;
    expect(rows.map(r => r.action).reverse()).toEqual(["create", "update"]);
    expect(rows[0]).toMatchObject({ field: "grant", from: g1, to: g2, label: "alice@example.invalid", workspace: null });
    expect(rows[1]).toMatchObject({ from: null, to: g1 });
    // security-sensitive rows are invisible to workspace-restricted auditors
    expect((await pageAudit(t.pool, ["Kassel"], { entityType: "user", days: 0 })).items).toEqual([]);
    expect(grantJson({ role: "editor", workspaces: ["B", "A"], departments: ["Z", "A"] })).toBe(grantJson({ role: "editor", workspaces: ["A", "B"], departments: ["A", "Z"] }));
  });

  it("document actions are recorded by the server, authorized like a read, and scoped", async () => {
    const kassel = (await svc.create(admin, { fields: { station: "Fulda", bahnhofsmanagement: "Kassel", projektnummer: "D-1" }, idempotencyKey: key() }, ctx())).project.id;
    await svc.recordDocumentAction(kasselOnly, { kind: "pdf", details: "Projektblatt D-1.pdf", projectId: kassel }, ctx());
    // another workspace's project: NotFound, nothing written
    await expect(svc.recordDocumentAction(mitteOnly, { kind: "pdf", details: "x.pdf", projectId: kassel }, ctx())).rejects.toBeInstanceOf(NotFoundError);
    // a project-less export is scoped to the caller's single workspace
    await svc.recordDocumentAction(kasselOnly, { kind: "export", details: "CSV-Export · 12 Projekte" }, ctx());
    const all = (await pageAudit(t.pool, null, { action: "document", days: 0 })).items;
    expect(all).toHaveLength(2);
    expect(all.find(r => r.field === "pdf")).toMatchObject({ entityType: "project", entityId: kassel, workspace: "Kassel", label: "Fulda", to: "Projektblatt D-1.pdf", eventId: null });
    expect(all.find(r => r.field === "export")).toMatchObject({ entityType: "document", workspace: "Kassel" });
    expect((await pageAudit(t.pool, ["Frankfurt"], { action: "document", days: 0 })).items).toEqual([]);
  });

  it("a delete keeps a forensic snapshot (project fields + every review) in its audit row", async () => {
    const id = (await svc.create(admin, { fields: { station: "Gießen", bahnhofsmanagement: "Frankfurt", projektnummer: "S-9", projektleiter: "Bernd", kommentar: "wichtig" }, idempotencyKey: key() }, ctx())).project.id;
    let v = (await svc.get(admin, id)).version;
    v = (await svc.createReview(admin, { projectId: id, department: "ITK", expectedVersion: v, fields: { status: "offen", prueferName: "Paula" }, idempotencyKey: key() }, ctx())).project.version;
    await svc.delete(admin, { id, expectedVersion: v, idempotencyKey: key() }, ctx());
    const del = (await pageAudit(t.pool, null, { action: "delete", entityId: id, days: 0 })).items[0]!;
    expect(del.snapshot).toMatchObject({ projektnummer: "S-9", station: "Gießen", projektleiter: "Bernd", kommentar: "wichtig", bahnhofsmanagement: "Frankfurt" });
    expect(del.snapshot!.reviews).toEqual([{ department: "ITK", status: "offen", prueferName: "Paula", datum: null }]);
    expect(del.from).toBeNull();
  });

  it("checklist submission records the 14 initial reviews in the project's own audit rows and created-event", async () => {
    const header = { projektnummer: "CL-7", stationsname: "Kassel Hbf", bahnhofsmanagement: "Kassel", projektleitung: "Anna", projektstand: "AP" };
    const answers = Object.fromEntries(Object.entries(defaultAnswers("Projektanmeldung")).map(([k, a]) => [k, { answer: a.answer ?? null, secondary: a.secondary ?? null, comment: null }]));
    const d = await checklists.save(markus, { mode: "Projektanmeldung", header, answers, idempotencyKey: key() } as never, ctx());
    const s = await checklists.submit(markus, { id: d.checklist.id, expectedVersion: 1, idempotencyKey: key() }, ctx());
    const rows = (await pageAudit(t.pool, null, { entityType: "project", entityId: s.projectId, days: 0, limit: 100 })).items;
    const reviewRows = rows.filter(r => r.department !== null && r.field === "status");
    expect(reviewRows.length).toBe(14); // one status row per Gewerk: every initial review is audited
    expect(new Set(reviewRows.map(r => r.version))).toEqual(new Set([1])); // part of the creation (version 1), not a hidden write
    const [[ev]] = (await t.pool.query("SELECT envelope FROM domain_events WHERE aggregateType='project' AND aggregateId=? AND eventType='project.created'", [s.projectId])) as any;
    const env = typeof ev.envelope === "string" ? JSON.parse(ev.envelope) : ev.envelope;
    expect(Object.keys(env.changes).filter(k => /^review\.[^.]+\.status$/.test(k))).toHaveLength(14);
  });
});
