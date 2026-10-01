/** Regression tests for the mutation-path audit findings (real DB). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { hasTestDb, createTestDatabase } from "../testing/testDb";
import { MysqlProjectStore } from "../infra/mysqlProjectStore";
import { ProjectService } from "./projectService";
import { BookingService } from "./bookingService";
import { NotFoundError } from "./errors";
import { admin, ctx, mitteOnly } from "./testFixtures";
import { UpdateReviewInputSchema, CreateReviewInputSchema } from "@shared/project-contract";
import type { Principal } from "./permissions";

const key = () => `k-${randomUUID()}`;
const kasselOnly: Principal = { ...mitteOnly, id: "6", name: "Kai", workspaces: ["Kassel"] };

describe.skipIf(!hasTestDb)("mutation hardening (real DB)", () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let store: MysqlProjectStore, svc: ProjectService, bookings: BookingService;
  let frankfurtProject: number, slot: number;

  beforeAll(async () => {
    t = await createTestDatabase(10);
    store = new MysqlProjectStore(t.db as never);
    svc = new ProjectService(store, () => {});
    bookings = new BookingService(store, () => {});
    frankfurtProject = (await svc.create(admin, { fields: { station: "Hanau Hbf", bahnhofsmanagement: "Frankfurt", projektnummer: "H-1" }, idempotencyKey: key() }, ctx())).project.id;
    const [r] = (await t.pool.query("INSERT INTO schedule_slots (slotKey, datum, von, bis) VALUES ('2026-12-01T09:00','2026-12-01','09:00','09:50')")) as unknown as [{ insertId: number }];
    slot = r.insertId;
  });
  afterAll(async () => { await t?.drop(); });

  it("a booking cannot be linked to a project the caller may not see (and the slot stays free)", async () => {
    await expect(bookings.book(kasselOnly, { id: slot, expectedVersion: 1, status: "Gebucht", station: "Kassel Hbf", projektleitung: "K", idempotencyKey: key(), projectId: frankfurtProject } as never, ctx())).rejects.toBeInstanceOf(NotFoundError);
    const [[row]] = (await t.pool.query("SELECT status, syncVersion FROM schedule_slots WHERE id=?", [slot])) as any;
    expect(row).toMatchObject({ status: "Frei", syncVersion: 1 });
  });

  it("review edits validate the Gewerk and the status vocabulary", () => {
    const base = { projectId: 1, expectedVersion: 1, idempotencyKey: "k".repeat(16) };
    expect(UpdateReviewInputSchema.safeParse({ ...base, department: "Phantasie", changes: { status: "offen" } }).success).toBe(false);
    expect(UpdateReviewInputSchema.safeParse({ ...base, department: "ITK", changes: { status: "erfunden" } }).success).toBe(false);
    expect(UpdateReviewInputSchema.safeParse({ ...base, department: "ITK", changes: { status: "Niederschrift erstellt (LP05-05-01-F31)" } }).success).toBe(true);
    expect(UpdateReviewInputSchema.safeParse({ ...base, department: "ITK", changes: { status: null } }).success).toBe(true);
    expect(CreateReviewInputSchema.safeParse({ ...base, department: "Phantasie", fields: {} }).success).toBe(false);
  });

  it("the shell summary is scoped to the caller's workspaces", async () => {
    const all = await store.shellSummary(null);
    const kassel = await store.shellSummary(["Kassel"]);
    const none = await store.shellSummary([]);
    expect(all.projectCount).toBe(1);
    expect(kassel.projectCount).toBe(0);
    expect(none).toEqual({ projectCount: 0, lastUpdatedAt: null });
  });
});
