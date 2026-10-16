/**
 * Projektanmeldung → department notifications against a REAL database: provisioned Microsoft identities with grants,
 * subscriptions, submit, dedup, rollback, draft saves, admin corrections, and what each recipient may read back.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { hasTestDb, createTestDatabase } from "../testing/testDb";
import { MysqlProjectStore } from "../infra/mysqlProjectStore";
import { provisionBatch, grantJson } from "../_core/identity";
import { ProjectService } from "./projectService";
import { BookingService } from "./bookingService";
import { ChecklistService } from "./checklistService";
import { SubscriptionService } from "./subscriptionService";
import { principalIdForOpenId } from "./principalId";
import { ForbiddenError, NotFoundError } from "./errors";
import { admin, ctx } from "./testFixtures";
import type { Principal } from "./permissions";
import { defaultAnswers } from "@shared/checklist";

const key = () => `k-${randomUUID()}`;

/** a Microsoft identity as the provisioner stores it, and the principal the server builds from its token */
function oidcUser(oid: string, role: Principal["role"], workspaces: Principal["workspaces"], departments: string[]): Principal & { openId: string } {
  const openId = `oidc:11111111-2222-3333-4444-555555555555:${oid}`;
  return { openId, id: principalIdForOpenId(openId), name: oid, email: `${oid}@example.test`, role, workspaces, departments };
}
const eeaAnna = oidcUser("aaaaaaaa-0000-0000-0000-000000000001", "editor", "ALL", ["EEA"]);
const itkIngo = oidcUser("aaaaaaaa-0000-0000-0000-000000000002", "editor", "ALL", ["ITK"]);
const bothBea = oidcUser("aaaaaaaa-0000-0000-0000-000000000003", "editor", "ALL", ["EEA", "ITK"]);
const kasselKai = oidcUser("aaaaaaaa-0000-0000-0000-000000000004", "editor", ["Kassel"], ["EEA"]);
const offOtto = oidcUser("aaaaaaaa-0000-0000-0000-000000000005", "editor", "ALL", ["ITK"]);
const adminAda = oidcUser("aaaaaaaa-0000-0000-0000-000000000006", "admin", "ALL", []);
const viewerVera = oidcUser("aaaaaaaa-0000-0000-0000-000000000007", "viewer", "ALL", ["EEA"]);
const authorMax = oidcUser("aaaaaaaa-0000-0000-0000-000000000008", "editor", "ALL", ["EEA", "ITK"]);
const ALL = [eeaAnna, itkIngo, bothBea, kasselKai, offOtto, adminAda, viewerVera, authorMax];

describe.skipIf(!hasTestDb)("Projektanmeldung → department notifications (real DB)", () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let store: MysqlProjectStore;
  let checklists: ChecklistService;
  let subs: SubscriptionService;
  const q = async <R = Record<string, unknown>>(sqlText: string, args: unknown[] = []) => ((await t.pool.query(sqlText, args))[0] as R[]);
  const count = async (where: string, args: unknown[] = []) => Number((await q<{ n: number }>(`SELECT COUNT(*) n FROM notifications WHERE ${where}`, args))[0]!.n);
  const header = { bahnhofsmanagement: "Frankfurt", stationsname: "Alpha", projektbezeichnung: "Umbau", projektstand: "AP", projektnummer: "G.N1" };

  beforeAll(async () => {
    t = await createTestDatabase(10);
    store = new MysqlProjectStore(t.db as never);
    const projects = new ProjectService(store, () => {});
    checklists = new ChecklistService(store, projects, new BookingService(store, () => {}), () => {});
    subs = new SubscriptionService(store);
    // first sign-in of every identity: the provisioner mirrors the grant (what recipient resolution reads)
    await provisionBatch(t.pool, ALL.map((u) => ({ openId: u.openId, name: u.name, email: u.email, role: u.role === "admin" ? "admin" : "user", grant: grantJson(u) })));
    await subs.set(offOtto, { department: "ITK", enabled: false });
  });
  afterAll(async () => { await t?.drop(); });

  const draft = (p: Principal, answers: Record<string, { answer: string; secondary?: "Ja" | "Nein" }>, over: Record<string, unknown> = {}) =>
    checklists.save(p, { mode: "Projektanmeldung", header: { ...header, ...over }, answers: { ...defaultAnswers("Projektanmeldung"), ...answers }, idempotencyKey: key() } as never, ctx());

  it("provisioning is idempotent and stable: the principal id the server acts under is stored once, repeated sign-ins change nothing", async () => {
    await provisionBatch(t.pool, [{ openId: eeaAnna.openId, name: eeaAnna.name, email: eeaAnna.email, role: "user", grant: grantJson(eeaAnna) }]);
    const rows = await q<{ principalId: string; openId: string }>("SELECT principalId, openId FROM users WHERE email=?", [eeaAnna.email]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.principalId).toBe(eeaAnna.id);
    expect(rows[0]!.openId).toBe(eeaAnna.openId); // 78 chars, not truncated
    // the SQL backfill of migration 0014 and the JavaScript derivation agree
    const [sqlDerived] = await q<{ p: string }>("SELECT CONCAT('o', LEFT(SHA2(openId, 256), 31)) p FROM users WHERE email=?", [eeaAnna.email]);
    expect(sqlDerived!.p).toBe(eeaAnna.id);
  });

  it("a draft save notifies nobody", async () => {
    await draft(authorMax, { eea: { answer: "Ja" }, itk: { answer: "Ja" } });
    expect(await count("department IS NOT NULL")).toBe(0);
  });

  it("submit with EEA + ITK work: EEA-only, ITK-only and both-subscribers get exactly their departments; the actor, the viewer, the other-workspace editor, the unsubscribed user and the opted-out admin get nothing", async () => {
    const d = await draft(authorMax, { eea: { answer: "Ja" }, itk: { answer: "Ja" } });
    const s = await checklists.submit(authorMax, { id: d.checklist.id, expectedVersion: 1, idempotencyKey: key() }, ctx());
    const rows = await q<{ userId: string; department: string; kind: string; link: string; workspace: string; dedupKey: string }>("SELECT userId, department, kind, link, workspace, dedupKey FROM notifications WHERE department IS NOT NULL ORDER BY userId, department");
    const got = rows.map((r) => `${r.userId === eeaAnna.id ? "anna" : r.userId === itkIngo.id ? "ingo" : r.userId === bothBea.id ? "bea" : r.userId}:${r.department}`).sort();
    expect(got).toEqual(["anna:EEA", "bea:EEA", "bea:ITK", "ingo:ITK"]);
    expect(rows[0]).toMatchObject({ kind: "assignment", link: `/projects?projekt=${s.projectId}`, workspace: "Frankfurt", dedupKey: `checklist.submitted:${d.checklist.id}:EEA` });
    // one outbox event per notification, addressed to its recipient only
    const ev = await q<{ n: number }>("SELECT COUNT(*) n FROM domain_events WHERE eventType='notification.created' AND JSON_EXTRACT(envelope, '$.changes.department.to') IS NOT NULL");
    expect(Number(ev[0]!.n)).toBe(4);
    // the reviews that caused it exist, "offen" for exactly EEA and ITK
    const open = await q<{ department: string }>("SELECT department FROM department_reviews WHERE projectId=? AND status='offen' ORDER BY department", [s.projectId]);
    expect(open.map((r) => r.department)).toEqual(["EEA", "ITK"]);
    // what each recipient reads back
    expect((await store.listNotifications(eeaAnna.id, { limit: 10 }, null)).items.map((i) => i.department)).toEqual(["EEA"]);
    expect(await store.unreadCount(bothBea.id, null)).toBe(2);
    expect((await store.listNotifications(kasselKai.id, { limit: 10 }, ["Kassel"])).items).toEqual([]);
  });

  it("ITK-only work notifies ITK subscribers only; a submission without any work notifies nobody", async () => {
    const before = await count("department IS NOT NULL");
    const d = await draft(authorMax, { itk: { answer: "Ja" } });
    await checklists.submit(authorMax, { id: d.checklist.id, expectedVersion: 1, idempotencyKey: key() }, ctx());
    const added = await q<{ userId: string; department: string }>("SELECT userId, department FROM notifications WHERE dedupKey LIKE ?", [`checklist.submitted:${d.checklist.id}:%`]);
    expect(added.map((r) => r.department)).toEqual(["ITK", "ITK"]);
    expect(new Set(added.map((r) => r.userId))).toEqual(new Set([itkIngo.id, bothBea.id]));
    const none = await draft(authorMax, {});
    await checklists.submit(authorMax, { id: none.checklist.id, expectedVersion: 1, idempotencyKey: key() }, ctx());
    expect(await count("department IS NOT NULL")).toBe(before + 2);
  });

  it("an idempotent retry replays and delivers nothing new; the same logical fact cannot be stored twice for one recipient (dedup key)", async () => {
    const d = await draft(authorMax, { eea: { answer: "Ja" } });
    const k = key();
    const first = await checklists.submit(authorMax, { id: d.checklist.id, expectedVersion: 1, idempotencyKey: k }, ctx());
    const again = await checklists.submit(authorMax, { id: d.checklist.id, expectedVersion: 1, idempotencyKey: k }, ctx());
    expect(again.replayed).toBe(true);
    expect(await count("dedupKey = ?", [`checklist.submitted:${d.checklist.id}:EEA`])).toBe(2); // anna + bea, once each
    // a regenerated delivery with a NEW event id for the same fact is a no-op, and the unread counter does not move
    const unreadBefore = await store.unreadCount(eeaAnna.id, null);
    const id = await store.transaction((tx) => tx.insertNotification({ userId: eeaAnna.id, kind: "assignment", title: "x", body: null, link: "/", workspace: "Frankfurt", eventId: randomUUID(), department: "EEA", dedupKey: `checklist.submitted:${d.checklist.id}:EEA` }));
    expect(id).toBeNull();
    expect(await store.unreadCount(eeaAnna.id, null)).toBe(unreadBefore);
    void first;
  });

  it("a failed submission rolls back project, reviews and notifications together — no phantom notification", async () => {
    const d = await draft(authorMax, { eea: { answer: "Ja" } });
    const before = await count("1=1");
    const slotFail = { id: 987_654, expectedVersion: 1 }; // no such slot → the booking step throws inside the transaction
    await expect(checklists.submit(authorMax, { id: d.checklist.id, expectedVersion: 1, slot: slotFail, idempotencyKey: key() }, ctx())).rejects.toBeInstanceOf(NotFoundError);
    expect(await count("1=1")).toBe(before);
    expect(await count("dedupKey LIKE ?", [`checklist.submitted:${d.checklist.id}:%`])).toBe(0);
    expect(Number((await q<{ n: number }>("SELECT COUNT(*) n FROM project_checklists WHERE id=? AND status='submitted'", [d.checklist.id]))[0]!.n)).toBe(0);
  });

  it("subscriptions: eligibility follows the grant; a user may switch off anything and on only what the grant allows; viewers cannot subscribe", async () => {
    const mine = await subs.mine(eeaAnna);
    expect(mine.find((s) => s.department === "EEA")).toMatchObject({ eligible: true, subscribed: true, explicit: null });
    expect(mine.find((s) => s.department === "ITK")).toMatchObject({ eligible: false, subscribed: false });
    await expect(subs.set(eeaAnna, { department: "ITK", enabled: true })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(subs.set(viewerVera, { department: "EEA", enabled: true })).rejects.toBeInstanceOf(ForbiddenError);
    const off = await subs.set(eeaAnna, { department: "EEA", enabled: false });
    expect(off.find((s) => s.department === "EEA")).toMatchObject({ subscribed: false, explicit: { enabled: false, source: "user" } });
    // re-provisioning (a later sign-in) does not undo the explicit decision
    await provisionBatch(t.pool, [{ openId: eeaAnna.openId, name: eeaAnna.name, email: eeaAnna.email, role: "user", grant: grantJson(eeaAnna) }]);
    expect((await subs.mine(eeaAnna)).find((s) => s.department === "EEA")!.subscribed).toBe(false);
    const d = await draft(authorMax, { eea: { answer: "Ja" } });
    await checklists.submit(authorMax, { id: d.checklist.id, expectedVersion: 1, idempotencyKey: key() }, ctx());
    expect(await count("userId=? AND dedupKey=?", [eeaAnna.id, `checklist.submitted:${d.checklist.id}:EEA`])).toBe(0);
    await subs.set(eeaAnna, { department: "EEA", enabled: true });
  });

  it("a revoked department claim stops delivery even with an explicit ON; an administrator's correction is audited; the admin opts in", async () => {
    // Ingo's next token carries no ITK any more → the provisioner records the new grant
    await provisionBatch(t.pool, [{ openId: itkIngo.openId, name: itkIngo.name, email: itkIngo.email, role: "user", grant: grantJson({ ...itkIngo, departments: [] }) }]);
    const d = await draft(authorMax, { itk: { answer: "Ja" } });
    await checklists.submit(authorMax, { id: d.checklist.id, expectedVersion: 1, idempotencyKey: key() }, ctx());
    expect(await count("userId=? AND dedupKey=?", [itkIngo.id, `checklist.submitted:${d.checklist.id}:ITK`])).toBe(0);
    // admin review: ineligible now, visible as such; a non-admin cannot look at or change others
    const view = await subs.ofUser(adminAda, itkIngo.id);
    expect(view.items.find((s) => s.department === "ITK")).toMatchObject({ eligible: false, subscribed: false });
    await expect(subs.ofUser(eeaAnna, itkIngo.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(subs.setForUser(eeaAnna, { principalId: itkIngo.id, department: "ITK", enabled: false }, ctx())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(subs.ofUser(adminAda, "o0000000000000000000000000000000")).rejects.toBeInstanceOf(NotFoundError);
    await subs.setForUser(adminAda, { principalId: offOtto.id, department: "ITK", enabled: true }, ctx());
    const audit = await q<{ field: string; newValue: string }>("SELECT field, newValue FROM audit_log WHERE entityType='user' AND field='subscription.ITK'");
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]!.newValue)).toEqual({ enabled: true, source: "admin" });
    // the admin themselves: no default, explicit opt-in works
    expect((await subs.mine(adminAda)).find((s) => s.department === "EEA")).toMatchObject({ eligible: true, subscribed: false });
    await subs.set(adminAda, { department: "EEA", enabled: true });
    const d2 = await draft(authorMax, { eea: { answer: "Ja" } });
    await checklists.submit(authorMax, { id: d2.checklist.id, expectedVersion: 1, idempotencyKey: key() }, ctx());
    expect(await count("userId=? AND dedupKey=?", [adminAda.id, `checklist.submitted:${d2.checklist.id}:EEA`])).toBe(1);
    void admin;
  });

  it("project watchers keep working alongside: a watcher of the created project is told about later edits, department notifications are not duplicated into watchers", async () => {
    const d = await draft(authorMax, { eea: { answer: "Ja" } });
    const s = await checklists.submit(authorMax, { id: d.checklist.id, expectedVersion: 1, idempotencyKey: key() }, ctx());
    await store.watch(s.projectId, itkIngo.id);
    const projects = new ProjectService(store, () => {});
    const detail = (await store.detail(s.projectId))!;
    await projects.update(authorMax, { id: s.projectId, expectedVersion: detail.version, changes: { projektstand: "EP" }, idempotencyKey: key() }, ctx());
    const watcherRows = await q<{ department: string | null; kind: string }>("SELECT department, kind FROM notifications WHERE userId=? AND link=? ORDER BY id", [itkIngo.id, `/projects?projekt=${s.projectId}`]);
    expect(watcherRows).toEqual([{ department: null, kind: "workflow" }]);
  });
});
