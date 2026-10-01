/**
 * Booking aggregate (Fachspezialistenprüfung calendar slots) on the same domain path as Projects:
 *   authorization → transaction → idempotency → optimistic version → audit → outbox event → (relay) realtime.
 *
 * Rules
 *   book     Frei → Gebucht | Vorgebucht für IM/IT. Writers only (admin/editor), and only for a station whose
 *            Bahnhofsmanagement they may edit (unknown BM = unrestricted principals only). A slot that is not
 *            Frei is a CONFLICT (slot-taken) even when the caller's version is current — nobody double-books.
 *   release  any state → Frei, details cleared. Allowed to a writer who may edit the booking's workspace, or an admin.
 *   read     everyone sees status/time; details only with access to the booking's workspace (redacted otherwise).
 */
import { randomUUID } from "node:crypto";
import { EVENT_SCHEMA_VERSION, type DomainEvent, type FieldChange } from "@shared/domain-events";
import type { BookSlotInput, ReleaseSlotInput, SlotDTO } from "@shared/booking-contract";
import type { ScheduleSlot } from "../../drizzle/schema";
import { resolveGeo } from "../infra/geoModel";
import { toSlotDTO } from "../infra/mysqlProjectStore";
import { AggregateConflictError, ForbiddenError, IdempotencyKeyReuseError, NotFoundError } from "./errors";
import { canEditProject, canViewProject, type Principal } from "./permissions";
import { requestHash, type RequestContext } from "./projectService";
import type { AfterCommit, AuditRow, ProjectStore, ProjectTx } from "./ports";

const FIELDS = ["status", "station", "projektleitung", "projektstand", "info", "hinweis", "projectId", "bahnhofsmanagement"] as const;
const clean = (v: string | null | undefined) => { const t = (v ?? "").trim(); return t === "" ? null : t; };

export class BookingService {
  constructor(private readonly store: ProjectStore, private readonly afterCommit: AfterCommit = () => {}, private readonly clock: () => Date = () => new Date()) {}

  /** What this caller may see of a slot row. */
  view(p: Principal, r: ScheduleSlot): SlotDTO {
    const free = r.status === "Frei";
    return toSlotDTO(r, !free && !canViewProject(p, { bahnhofsmanagement: r.bahnhofsmanagement }));
  }

  async list(p: Principal, range: { from: string; to: string; status?: string }): Promise<SlotDTO[]> {
    return (await this.store.listSlots(range)).map(r => this.view(p, r));
  }

  async book(p: Principal, input: BookSlotInput, ctx: RequestContext): Promise<{ slot: SlotDTO; eventId: string; replayed: boolean }> {
    const station = clean(input.station);
    const hash = requestHash("booking.book", { id: input.id, v: input.expectedVersion, s: input.status, st: station, pl: clean(input.projektleitung), ps: clean(input.projektstand), i: clean(input.info), h: clean(input.hinweis), p: input.projectId ?? null });
    const result = await this.store.transaction(async tx => {
      const claim = await tx.claimIdempotency(p.id, input.idempotencyKey, "booking.book", hash);
      if (claim.state === "mismatch") throw new IdempotencyKeyReuseError();
      if (claim.state === "replay") return { ...(claim.response as { slot: SlotDTO; eventId: string }), replayed: true };
      const { slot, event } = await this.bookWithin(tx, p, ctx, input);
      const res = { slot, eventId: event.eventId };
      await tx.completeIdempotency(p.id, input.idempotencyKey, res);
      return { ...res, replayed: false };
    });
    if (!result.replayed) this.nudge();
    return result;
  }

  /**
   * The booking transition inside an OPEN transaction (authorize → lock → version/state check → update → audit → event).
   * Used by `book` and by aggregates that book a slot as part of their own transition (checklist submission), so a
   * rejected slot rolls the whole submission back.
   */
  async bookWithin(tx: ProjectTx, p: Principal, ctx: RequestContext, input: Omit<BookSlotInput, "idempotencyKey">) {
    const station = clean(input.station);
    // the workspace that owns this booking: resolved from the station; the caller must be allowed to edit THAT workspace
    const bm = station ? (resolveGeo(station, null)?.bm ?? null) : null;
    if (p.role === "viewer") throw new ForbiddenError("Keine Berechtigung zum Buchen");
    if (!canEditProject(p, { bahnhofsmanagement: bm })) throw new ForbiddenError("Keine Berechtigung für diese Region");
    const cur = await tx.lockSlot(input.id);
    if (!cur) throw new NotFoundError("Termin");
    if (cur.syncVersion !== input.expectedVersion || cur.status !== "Frei") {
      throw new AggregateConflictError({ code: "VERSION_CONFLICT", aggregate: "booking", id: cur.id, expectedVersion: input.expectedVersion, currentVersion: cur.syncVersion, current: this.view(p, cur), reason: cur.status !== "Frei" ? "slot-taken" : "stale" });
    }
    const set: Partial<ScheduleSlot> = { status: input.status, station, bahnhofsmanagement: bm, projektleitung: clean(input.projektleitung), projektstand: clean(input.projektstand), info: clean(input.info), hinweis: clean(input.hinweis), projectId: input.projectId ?? null };
    const ok = await tx.updateSlotVersioned(cur.id, cur.syncVersion, set);
    if (!ok) throw new AggregateConflictError({ code: "VERSION_CONFLICT", aggregate: "booking", id: cur.id, expectedVersion: input.expectedVersion, currentVersion: cur.syncVersion + 1, current: null, reason: "stale" });
    const changes = diff(cur, set);
    const event = this.event(p, ctx, cur.id, cur.syncVersion + 1, changes, bm);
    await tx.appendAudit(this.audit(p, event, "update", changes));
    await tx.appendEvent(event);
    return { slot: this.view(p, (await tx.lockSlot(cur.id))!), event };
  }

  async release(p: Principal, input: ReleaseSlotInput, ctx: RequestContext): Promise<{ slot: SlotDTO; eventId: string; replayed: boolean }> {
    const hash = requestHash("booking.release", { id: input.id, v: input.expectedVersion });
    const result = await this.store.transaction(async tx => {
      const claim = await tx.claimIdempotency(p.id, input.idempotencyKey, "booking.release", hash);
      if (claim.state === "mismatch") throw new IdempotencyKeyReuseError();
      if (claim.state === "replay") return { ...(claim.response as { slot: SlotDTO; eventId: string }), replayed: true };

      const cur = await tx.lockSlot(input.id);
      if (!cur) throw new NotFoundError("Termin");
      if (p.role === "viewer" || !(p.role === "admin" || canEditProject(p, { bahnhofsmanagement: cur.bahnhofsmanagement }))) throw new ForbiddenError("Keine Berechtigung, diesen Termin freizugeben");
      if (cur.syncVersion !== input.expectedVersion) throw new AggregateConflictError({ code: "VERSION_CONFLICT", aggregate: "booking", id: cur.id, expectedVersion: input.expectedVersion, currentVersion: cur.syncVersion, current: this.view(p, cur), reason: "stale" });
      const set: Partial<ScheduleSlot> = { status: "Frei", station: null, bahnhofsmanagement: null, projektleitung: null, projektstand: null, info: null, hinweis: null, projectId: null, checklistId: null };
      await tx.updateSlotVersioned(cur.id, cur.syncVersion, set);
      const changes = diff(cur, set);
      const event = this.event(p, ctx, cur.id, cur.syncVersion + 1, changes, cur.bahnhofsmanagement);
      await tx.appendAudit(this.audit(p, event, "update", changes));
      await tx.appendEvent(event);
      const after = (await tx.lockSlot(cur.id))!;
      const res = { slot: this.view(p, after), eventId: event.eventId };
      await tx.completeIdempotency(p.id, input.idempotencyKey, res);
      return { ...res, replayed: false };
    });
    if (!result.replayed) this.nudge();
    return result;
  }

  private nudge() { try { this.afterCommit(); } catch { /* the relay also polls */ } }

  private event(p: Principal, ctx: RequestContext, id: number, version: number, changes: Record<string, FieldChange>, workspace: string | null): DomainEvent {
    return { schemaVersion: EVENT_SCHEMA_VERSION, eventId: randomUUID(), eventType: "booking.updated", aggregateType: "booking", aggregateId: String(id), aggregateVersion: version,
      actorId: p.id, actorName: p.name, timestamp: this.clock().toISOString(), traceId: ctx.traceId, changes, context: { workspace } };
  }
  private audit(p: Principal, e: DomainEvent, action: AuditRow["action"], changes: Record<string, FieldChange>): AuditRow[] {
    const base = { userId: /^\d+$/.test(p.id) ? Number(p.id) : null, userName: p.name || p.email || p.id, entityType: "booking" as const, entityId: Number(e.aggregateId), action, eventId: e.eventId, aggregateVersion: e.aggregateVersion, traceId: e.traceId,
      // a draft's trail is private to its author's events (recipient set): never scoped to a workspace
      workspace: e.context?.recipient ? null : (e.context?.workspace ?? null) };
    const rows = Object.entries(changes);
    return rows.length ? rows.map(([field, c]) => ({ ...base, field, oldValue: c.from, newValue: c.to })) : [{ ...base, field: null, oldValue: null, newValue: null }];
  }
}

function diff(cur: ScheduleSlot, set: Partial<ScheduleSlot>): Record<string, FieldChange> {
  const out: Record<string, FieldChange> = {};
  for (const f of FIELDS) {
    if (!(f in set)) continue;
    const from = (cur as unknown as Record<string, unknown>)[f], to = (set as Record<string, unknown>)[f];
    const a = from === null || from === undefined ? null : String(from), b = to === null || to === undefined ? null : String(to);
    if (a !== b) out[f] = { from: a, to: b };
  }
  return out;
}
