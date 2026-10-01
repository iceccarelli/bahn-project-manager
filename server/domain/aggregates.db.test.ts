/**
 * Booking + Checklist aggregates against a REAL database: the same guarantees as Projects
 * (authorization, optimistic version, idempotency, audit, outbox event, recipient-safe visibility).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { hasTestDb, createTestDatabase } from "../testing/testDb";
import { MysqlProjectStore } from "../infra/mysqlProjectStore";
import { ProjectService } from "./projectService";
import { BookingService } from "./bookingService";
import { ChecklistService } from "./checklistService";
import { AggregateConflictError, ForbiddenError, IdempotencyKeyReuseError, NotFoundError, ValidationError } from "./errors";
import { admin, ctx, lena, markus, mitteOnly, viewer } from "./testFixtures";
import { eventForPrincipal } from "./eventVisibility";
import { defaultAnswers } from "@shared/checklist";
import { rebuildReadModels, verifyReadModels } from "../infra/readModels";
import type { Principal } from "./permissions";

const key = () => `k-${randomUUID()}`;
const kasselOnly: Principal = { ...mitteOnly, id: "6", name: "Kai", workspaces: ["Kassel"] };

describe.skipIf(!hasTestDb)("booking + checklist aggregates (real DB)", () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let store: MysqlProjectStore, projects: ProjectService, bookings: BookingService, checklists: ChecklistService;
  const slot: number[] = [];
  const count = async (sql: string, args: unknown[] = []) => Number((((await t.pool.query(sql, args)) as unknown as [{ n: number }[]])[0][0]!.n));

  beforeAll(async () => {
    t = await createTestDatabase(20);
    store = new MysqlProjectStore(t.db as never);
    projects = new ProjectService(store, () => {});
    bookings = new BookingService(store, () => {});
    checklists = new ChecklistService(store, projects, () => {});
    for (let i = 0; i < 6; i++) {
      const [r] = (await t.pool.query("INSERT INTO schedule_slots (slotKey, datum, von, bis) VALUES (?,?,?,?)", [`2026-11-0${i + 1}T09:00`, `2026-11-0${i + 1}`, "09:00", "09:50"])) as unknown as [{ insertId: number }];
      slot.push(r.insertId);
    }
  });
  afterAll(async () => { await t?.drop(); });

  const book = (p: Principal, id: number, v = 1, over: Record<string, unknown> = {}) =>
    bookings.book(p, { id, expectedVersion: v, status: "Gebucht", station: "Kassel Hbf", projektleitung: "Anna", projektstand: "EP", idempotencyKey: key(), ...over } as never, ctx());

  it("book: Frei → Gebucht with version, audit rows and ONE outbox event; replay is exact; key reuse with another body is refused", async () => {
    const k = key();
    const body = { id: slot[0]!, expectedVersion: 1, status: "Gebucht", station: "Kassel Hbf", projektleitung: "Anna", idempotencyKey: k } as never;
    const r = await bookings.book(markus, body, ctx());
    expect(r.slot).toMatchObject({ status: "Gebucht", version: 2, station: "Kassel Hbf" });
    expect(await count("SELECT COUNT(*) n FROM audit_log WHERE entityType='booking' AND entityId=? AND aggregateVersion=2", [slot[0]])).toBeGreaterThan(0);
    expect(await count("SELECT COUNT(*) n FROM domain_events WHERE aggregateType='booking' AND aggregateId=? AND aggregateVersion=2", [slot[0]])).toBe(1);
    const again = await bookings.book(markus, body, ctx());
    expect(again.replayed).toBe(true);
    expect(await count("SELECT COUNT(*) n FROM domain_events WHERE aggregateType='booking' AND aggregateId=?", [slot[0]])).toBe(1);
    await expect(bookings.book(markus, { ...(body as object), station: "Fulda" } as never, ctx())).rejects.toBeInstanceOf(IdempotencyKeyReuseError);
  });

  it("nobody double-books: 8 concurrent bookers of one free slot → exactly one wins, the rest get a structured conflict", async () => {
    const id = slot[1]!;
    const people: Principal[] = [admin, markus, lena, { ...markus, id: "21" }, { ...markus, id: "22" }, { ...lena, id: "23" }, { ...markus, id: "24" }, { ...lena, id: "25" }];
    const res = await Promise.allSettled(people.map(p => book(p, id, 1, { projektleitung: `von ${p.id}` })));
    const ok = res.filter(r => r.status === "fulfilled"), bad = res.filter(r => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(7);
    for (const b of bad) { expect(b.reason).toBeInstanceOf(AggregateConflictError); expect(["slot-taken", "stale"]).toContain((b.reason as AggregateConflictError).info.reason); }
    expect(await count("SELECT COUNT(*) n FROM domain_events WHERE aggregateType='booking' AND aggregateId=?", [id])).toBe(1);
    expect(await count("SELECT syncVersion n FROM schedule_slots WHERE id=?", [id])).toBe(2);
  });

  it("authorization: viewers cannot book; a Frankfurt editor cannot book a Kassel station (and is told nothing); an unknown station is unrestricted-only", async () => {
    await expect(book(viewer, slot[2]!)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(book(mitteOnly, slot[2]!)).rejects.toBeInstanceOf(ForbiddenError);                         // Kassel Hbf
    await expect(book(mitteOnly, slot[2]!, 1, { station: "Gibt es nicht 12345" })).rejects.toBeInstanceOf(ForbiddenError); // no resolvable BM
    const ok = await book(mitteOnly, slot[2]!, 1, { station: "Frankfurt (Main) Hbf" });
    expect(ok.slot.version).toBe(2);
    const anywhere = await book(markus, slot[3]!, 1, { station: "Gibt es nicht 12345" });
    expect(anywhere.slot.status).toBe("Gebucht");
  });

  it("reads and events are recipient-safe: everyone sees THAT a slot is taken, details only with workspace access", async () => {
    const forKassel = await bookings.list(kasselOnly, { from: "2026-11-01", to: "2026-11-06" });
    const forFrankfurt = await bookings.list(mitteOnly, { from: "2026-11-01", to: "2026-11-06" });
    const a = forKassel.find(s => s.id === slot[0])!, b = forFrankfurt.find(s => s.id === slot[0])!;
    expect(a).toMatchObject({ status: "Gebucht", redacted: false, station: "Kassel Hbf" });
    expect(b).toMatchObject({ status: "Gebucht", redacted: true, station: null, projektleitung: null, info: null });
    // the live/feed event gets the same treatment
    const [[env]] = (await t.pool.query("SELECT envelope FROM domain_events WHERE aggregateType='booking' AND aggregateId=? ORDER BY aggregateVersion DESC LIMIT 1", [slot[0]])) as unknown as [{ envelope: any }[]];
    const ev = typeof env.envelope === "string" ? JSON.parse(env.envelope) : env.envelope;
    const seenByFrankfurt = eventForPrincipal(mitteOnly, ev)!;
    expect(Object.keys(seenByFrankfurt.changes).sort()).toEqual(["status"]);
    expect(seenByFrankfurt.actorName).toBeNull();
    expect(Object.keys(eventForPrincipal(kasselOnly, ev)!.changes)).toContain("station");
  });

  it("release: writers of the booking's workspace or admins; stale version conflicts; the slot is free again with details cleared", async () => {
    const id = slot[0]!;
    await expect(bookings.release(mitteOnly, { id, expectedVersion: 2, idempotencyKey: key() }, ctx())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(bookings.release(kasselOnly, { id, expectedVersion: 1, idempotencyKey: key() }, ctx())).rejects.toBeInstanceOf(AggregateConflictError);
    const r = await bookings.release(kasselOnly, { id, expectedVersion: 2, idempotencyKey: key() }, ctx());
    expect(r.slot).toMatchObject({ status: "Frei", version: 3, station: null, projektleitung: null });
    await expect(bookings.release(admin, { id: 999999, expectedVersion: 1, idempotencyKey: key() }, ctx())).rejects.toBeInstanceOf(NotFoundError);
  });

  // ------------------------------------------------------------------------------------------------ checklist
  const header = { projektnummer: "CL-1", stationsname: "Kassel Hbf", bahnhofsmanagement: "Kassel", projektleitung: "Anna", projektstand: "AP" };
  const draft = (p: Principal, over: Record<string, unknown> = {}) =>
    checklists.save(p, { mode: "Projektanmeldung", header, answers: {}, idempotencyKey: key(), ...over } as never, ctx());

  it("save: author-only drafts, versioned updates, stale conflict, validated vocabulary", async () => {
    const d = await draft(markus);
    expect(d.checklist).toMatchObject({ status: "draft", version: 1, createdBy: markus.id });
    const u = await checklists.save(markus, { id: d.checklist.id, expectedVersion: 1, mode: "Projektanmeldung", header: { ...header, anmerkungen: "x" }, answers: {}, idempotencyKey: key() } as never, ctx());
    expect(u.checklist.version).toBe(2);
    await expect(checklists.save(markus, { id: d.checklist.id, expectedVersion: 1, mode: "Projektanmeldung", header, answers: {}, idempotencyKey: key() } as never, ctx())).rejects.toBeInstanceOf(AggregateConflictError);
    await expect(draft(markus, { answers: { "gibt-es-nicht": { answer: "Ja" } } })).rejects.toBeInstanceOf(ValidationError);
    await expect(draft(markus, { header: { ...header, bahnhofsmanagement: "Atlantis" } })).rejects.toBeInstanceOf(ValidationError);
    await expect(draft(viewer)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(draft(mitteOnly)).rejects.toBeInstanceOf(ForbiddenError);                          // Kassel header, Frankfurt editor
    // someone else's draft is invisible and untouchable; an admin sees it
    await expect(checklists.get(lena, d.checklist.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(checklists.save(lena, { id: d.checklist.id, expectedVersion: 2, mode: "Projektanmeldung", header, answers: {}, idempotencyKey: key() } as never, ctx())).rejects.toBeInstanceOf(NotFoundError);
    expect((await checklists.get(admin, d.checklist.id)).id).toBe(d.checklist.id);
    expect((await checklists.list(lena, { status: "draft" })).map(c => c.id)).not.toContain(d.checklist.id);
  });

  it("draft events reach only the author (and admins); submitted events follow the workspace", async () => {
    const d = await draft(markus);
    const [[env]] = (await t.pool.query("SELECT envelope FROM domain_events WHERE aggregateType='checklist' AND aggregateId=? ORDER BY aggregateVersion DESC LIMIT 1", [d.checklist.id])) as unknown as [{ envelope: any }[]];
    const ev = typeof env.envelope === "string" ? JSON.parse(env.envelope) : env.envelope;
    expect(eventForPrincipal(markus, ev)).not.toBeNull();
    expect(eventForPrincipal(admin, ev)).not.toBeNull();
    expect(eventForPrincipal(lena, ev)).toBeNull();
    expect(eventForPrincipal(kasselOnly, ev)).toBeNull();
  });

  it("submit: one transaction creates the project (audit + event), the 14 reviews, and links them; replay creates nothing twice", async () => {
    await rebuildReadModels(t.pool);
    const answers = defaultAnswers("Projektanmeldung");
    const input = Object.fromEntries(Object.entries(answers).map(([k, a]) => [k, { answer: a.answer ?? null, secondary: a.secondary ?? null, comment: null }]));
    const d = await draft(markus, { answers: input });
    const before = await count("SELECT COUNT(*) n FROM projects");
    const k = key();
    const s = await checklists.submit(markus, { id: d.checklist.id, expectedVersion: 1, idempotencyKey: k }, ctx());
    expect(s.checklist).toMatchObject({ status: "submitted", projectId: s.projectId, version: 2 });
    expect(await count("SELECT COUNT(*) n FROM projects")).toBe(before + 1);
    expect(await count("SELECT COUNT(*) n FROM department_reviews WHERE projectId=?", [s.projectId])).toBe(14);
    expect(await count("SELECT COUNT(*) n FROM domain_events WHERE aggregateType='project' AND aggregateId=? AND eventType='project.created'", [s.projectId])).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM domain_events WHERE aggregateType='checklist' AND aggregateId=? AND eventType='checklist.submitted'", [d.checklist.id])).toBe(1);
    const p = await projects.get(markus, s.projectId);
    expect(p).toMatchObject({ station: "Kassel Hbf", bahnhofsmanagement: "Kassel", projektleiter: "Anna", version: 1 });
    // the read models followed the creation (project + 14 reviews)
    expect(await verifyReadModels(t.pool)).toEqual([]);
    const replay = await checklists.submit(markus, { id: d.checklist.id, expectedVersion: 1, idempotencyKey: k }, ctx());
    expect(replay.replayed).toBe(true);
    expect(await count("SELECT COUNT(*) n FROM projects")).toBe(before + 1);
    // a second submit (new key) is a conflict: it is no longer a draft
    await expect(checklists.submit(markus, { id: d.checklist.id, expectedVersion: 2, idempotencyKey: key() }, ctx())).rejects.toMatchObject({ info: { reason: "not-draft" } });
    // submitted checklists follow the workspace rule
    expect((await checklists.get(kasselOnly, d.checklist.id)).status).toBe("submitted");
    await expect(checklists.get(mitteOnly, d.checklist.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("submit is atomic: if the project cannot be created, nothing is left behind and the checklist stays a draft", async () => {
    // Authorship passes, but this principal may not create projects in Kassel once the draft says Kassel: simulate by
    // changing the principal's workspaces between save and submit (e.g. access revoked).
    const owner: Principal = { ...kasselOnly, id: "77", name: "Ina" };
    const d = await draft(owner);
    const revoked: Principal = { ...owner, workspaces: ["Frankfurt"] };
    const projectsBefore = await count("SELECT COUNT(*) n FROM projects"), reviewsBefore = await count("SELECT COUNT(*) n FROM department_reviews");
    await expect(checklists.submit(revoked, { id: d.checklist.id, expectedVersion: 1, idempotencyKey: key() }, ctx())).rejects.toBeInstanceOf(ForbiddenError);
    expect(await count("SELECT COUNT(*) n FROM projects")).toBe(projectsBefore);
    expect(await count("SELECT COUNT(*) n FROM department_reviews")).toBe(reviewsBefore);
    expect((await checklists.get(owner, d.checklist.id)).status).toBe("draft");
    expect(await verifyReadModels(t.pool)).toEqual([]);
  });
});
