/**
 * The Project write path. One transaction:
 *
 *   claim idempotency key → lock row → authorize → normalize → diff →
 *   check expectedVersion → UPDATE … WHERE syncVersion = expected →
 *   audit rows → outbox event → store idempotent response → COMMIT
 *
 * Realtime publication is NOT done here. The event row commits with the
 * change; the outbox relay publishes it afterwards. A rolled-back transaction
 * therefore can never produce an event, and a crash between COMMIT and publish
 * cannot lose one.
 */
import { createHash, randomUUID } from "node:crypto";
import { cleanStr } from "@shared/ingest";
import { normalizeBahnhofsmanagement } from "@shared/bahnhofsmanagement";
import {
  EVENT_SCHEMA_VERSION,
  type DomainEvent,
  type FieldChange,
} from "@shared/domain-events";
import {
  EDITABLE_PROJECT_FIELDS,
  ProjectPatchSchema,
  type ConflictInfo,
  type CreateProjectInput,
  type EditableProjectField,
  type MutationResult,
  type ProjectDetail,
  type ReviewField,
  type UpdateProjectInput,
  type UpdateReviewInput,
  type CreateReviewInput,
  reviewChangeKey,
} from "@shared/project-contract";
import type { Project } from "../../drizzle/schema";
import { dateToWire } from "../infra/mysqlProjectStore";
import {
  ConflictError, ForbiddenError, IdempotencyKeyReuseError, NotFoundError, ValidationError,
} from "./errors";
import {
  canApproveReview, canCreateProject, canDeleteProject, canEditProject, canViewProject, type Principal,
} from "./permissions";
import { eventForPrincipal } from "./eventVisibility";
import { planNotification } from "./notificationPolicy";
import type { AuditDocumentKind, AuditEntityType } from "@shared/audit-contract";
import type { AfterCommit, AuditRow, ProjectStore, ProjectTx } from "./ports";

export interface RequestContext {
  traceId: string;
  requestId?: string;
}

const DATE_FIELDS = new Set<EditableProjectField>(["terminProjektvorstellung"]);
const MAX_REPLAY_EVENTS = 25;

/**
 * THE canonicalisation layer for project writes. Components never normalise;
 * they send what the user typed and the server stores the canonical form.
 */
export function normalizePatch(
  patch: Record<string, string | null | undefined>,
): Record<EditableProjectField, string | null> {
  const out: Partial<Record<EditableProjectField, string | null>> = {};
  for (const field of EDITABLE_PROJECT_FIELDS) {
    if (!(field in patch)) continue;
    const raw = patch[field];
    if (field === "bahnhofsmanagement") {
      const n = normalizeBahnhofsmanagement(raw);
      if (raw != null && cleanStr(raw) !== null && n.value === null) {
        throw new ValidationError(`Unbekanntes Bahnhofsmanagement: "${raw}"`, field);
      }
      out[field] = n.value;
    } else if (DATE_FIELDS.has(field)) {
      const c = cleanStr(raw);
      if (c === null) { out[field] = null; continue; }
      const d = new Date(c);
      if (Number.isNaN(d.getTime())) throw new ValidationError(`Ungültiges Datum: "${raw}"`, field);
      out[field] = dateToWire(d);
    } else {
      out[field] = cleanStr(raw);
    }
  }
  return out as Record<EditableProjectField, string | null>;
}

function currentWire(p: Project, field: EditableProjectField): string | null {
  const v = p[field];
  return v instanceof Date ? dateToWire(v) : (v ?? null);
}

function toColumnValues(norm: Partial<Record<EditableProjectField, string | null>>): Partial<Project> {
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(norm)) {
    set[k] = DATE_FIELDS.has(k as EditableProjectField) ? (v === null ? null : new Date(v as string)) : v;
  }
  return set as Partial<Project>;
}

/** JSON with recursively sorted keys, so equal requests hash equally. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}
export const requestHash = (op: string, body: unknown) =>
  createHash("sha256").update(op).update("\0").update(stableStringify(body)).digest("hex");

const actorNumericId = (p: Principal) => (/^\d+$/.test(p.id) ? Number(p.id) : null);

function diffOf(
  current: Project,
  norm: Partial<Record<EditableProjectField, string | null>>,
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};
  for (const [field, to] of Object.entries(norm) as [EditableProjectField, string | null][]) {
    const from = currentWire(current, field);
    if (from !== to) changes[field] = { from, to };
  }
  return changes;
}

/** The removed record as JSON for the delete audit row (strings capped; the audit text column is 64 KB). */
function snapshotJson(d: ProjectDetail | null): string | null {
  if (!d) return null;
  const cap = (v: unknown) => (typeof v === "string" && v.length > 2000 ? `${v.slice(0, 2000)}…` : v);
  const { reviews, ...fields } = d as unknown as Record<string, unknown> & { reviews?: Array<Record<string, unknown>> };
  const out = { ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, cap(v)])), reviews: (reviews ?? []).map(r => ({ department: r.department, status: r.status, prueferName: r.prueferName, datum: r.datum })) };
  const j = JSON.stringify(out);
  return j.length <= 60_000 ? j : JSON.stringify({ truncated: true, id: d.id, projektnummer: d.projektnummer, station: d.station, bahnhofsmanagement: d.bahnhofsmanagement, version: d.version });
}

const labelOf = (station: string | null | undefined, nummer: string | null | undefined): string | null => (station?.trim() || nummer?.trim() || null)?.slice(0, 255) ?? null;

export class ProjectService {
  constructor(
    private readonly store: ProjectStore,
    private readonly afterCommit: AfterCommit = () => {},
    private readonly clock: () => Date = () => new Date(),
  ) {}

  // ---- reads --------------------------------------------------------------

  async get(principal: Principal, id: number): Promise<ProjectDetail> {
    const d = await this.store.detail(id);
    // Not-visible and not-existing are indistinguishable to the caller (no IDOR oracle).
    if (!d || !canViewProject(principal, { bahnhofsmanagement: d.bahnhofsmanagement })) throw new NotFoundError();
    return d;
  }

  /**
   * Reconnect recovery. For each project the client holds, return the missed
   * events (contiguous, so the client can apply them in order), or a fresh
   * snapshot when too many were missed, or a deletion marker.
   */
  async sync(principal: Principal, known: Array<{ id: number; version: number }>) {
    const versions = await this.store.versions(known.map(k => k.id));
    const events: DomainEvent[] = [];
    const snapshots: ProjectDetail[] = [];
    const deleted: number[] = [];
    for (const k of known) {
      const cur = versions.get(k.id);
      if (!cur) { deleted.push(k.id); continue; }
      if (!canViewProject(principal, { bahnhofsmanagement: cur.bahnhofsmanagement })) { deleted.push(k.id); continue; }
      if (cur.version <= k.version) continue;
      const missed = cur.version - k.version;
      const evs = missed <= MAX_REPLAY_EVENTS ? await this.store.eventsSince(k.id, k.version, MAX_REPLAY_EVENTS) : [];
      const contiguous = evs.length === missed && evs.every((e, i) => e.aggregateVersion === k.version + 1 + i);
      // Replay goes through the same recipient filter as the live stream.
      if (contiguous) events.push(...evs.map(e => eventForPrincipal(principal, e)).filter((e): e is DomainEvent => e !== null));
      else {
        const d = await this.store.detail(k.id);
        if (d) snapshots.push(d);
      }
    }
    return { events, snapshots, deleted };
  }

  /**
   * Collection-level recovery: everything this principal may see that was
   * published after `after`, in feed order, recipient-filtered. `cursor` is the
   * highest feedSeq SCANNED (visible or not), so the next call never rescans.
   * `hasMore` means the scan budget ran out; the caller should ask again.
   */
  async changes(principal: Principal, input: { after: number; upTo?: number; limit?: number }) {
    const page = Math.min(input.limit ?? 200, 500);
    const events: DomainEvent[] = [];
    let cursor = input.after;
    let hasMore = false;
    for (let scans = 0; scans < 5; scans++) {
      const raw = await this.store.changesSince(cursor, page, input.upTo);
      for (const e of raw) {
        const out = eventForPrincipal(principal, e);
        if (out) events.push(out);
        cursor = e.feedSeq ?? cursor;
      }
      if (raw.length < page) return { events, cursor, hasMore: false };
      if (events.length >= page) { hasMore = true; break; }
      hasMore = scans === 4;
    }
    return { events, cursor, hasMore };
  }

  // ---- writes -------------------------------------------------------------

  async update(principal: Principal, input: UpdateProjectInput, ctx: RequestContext): Promise<MutationResult> {
    const parsed = ProjectPatchSchema.parse(input.changes);
    const norm = normalizePatch(parsed as Record<string, string | null | undefined>);
    const hash = requestHash("project.update", { id: input.id, v: input.expectedVersion, c: norm });

    const result = await this.store.transaction(async tx => {
      const claim = await tx.claimIdempotency(principal.id, input.idempotencyKey, "project.update", hash);
      if (claim.state === "mismatch") throw new IdempotencyKeyReuseError();
      if (claim.state === "replay") return { ...(claim.response as MutationResult), replayed: true };

      const current = await tx.lockProject(input.id);
      if (!current || !canViewProject(principal, current)) throw new NotFoundError();
      if (!canEditProject(principal, current)) throw new ForbiddenError();
      const newBm = "bahnhofsmanagement" in norm ? norm.bahnhofsmanagement : current.bahnhofsmanagement;
      if (newBm !== current.bahnhofsmanagement && !canEditProject(principal, { bahnhofsmanagement: newBm })) {
        throw new ForbiddenError("Keine Berechtigung für das Ziel-Bahnhofsmanagement");
      }

      const changes = diffOf(current, norm);
      if (current.syncVersion !== input.expectedVersion) {
        throw await this.conflict(tx, current, input, norm);
      }
      if (Object.keys(changes).length === 0) {
        // nothing to write: no version bump, no event, no audit noise
        const detail = (await tx.detail(input.id))!;
        const res: MutationResult = { project: detail, eventId: "", replayed: false };
        await tx.completeIdempotency(principal.id, input.idempotencyKey, res);
        return res;
      }

      const ok = await tx.updateVersioned(input.id, input.expectedVersion, toColumnValues(
        Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, c.to])),
      ));
      if (!ok) throw await this.conflict(tx, (await tx.lockProject(input.id)) ?? current, input, norm);

      const version = input.expectedVersion + 1;
      const event = this.buildEvent("project.updated", principal, ctx, input.id, version, changes, {
        workspace: newBm,
        workspaceBefore: newBm !== current.bahnhofsmanagement ? current.bahnhofsmanagement : null,
      });
      await tx.appendAudit(this.auditRows(principal, event, "update", changes, labelOf("station" in changes ? changes.station!.to : current.station, current.projektnummer)));
      await tx.appendEvent(event);
      await this.notifyWatchers(tx, principal, event, { id: input.id, projektnummer: current.projektnummer, station: "station" in changes ? changes.station!.to : current.station });
      const detail = (await tx.detail(input.id))!;
      const res: MutationResult = { project: detail, eventId: event.eventId, replayed: false };
      await tx.completeIdempotency(principal.id, input.idempotencyKey, res);
      return res;
    });

    if (!result.replayed && result.eventId) this.notifyAfterCommit();
    return result;
  }

  /**
   * A department review is part of the Project aggregate: editing one bumps the
   * PROJECT version, writes audit rows and one `project.updated` event whose
   * change keys are `review.<Gewerk>.<field>`. Same concurrency, same stream,
   * same recovery as a field edit — no second sync system.
   */
  async updateReview(principal: Principal, input: UpdateReviewInput, ctx: RequestContext): Promise<MutationResult> {
    const norm: Partial<Record<ReviewField, string | null>> = {};
    for (const [f, v] of Object.entries(input.changes) as [ReviewField, string | null | undefined][]) {
      if (v === undefined) continue;
      if (f === "datum") {
        const c = cleanStr(v);
        if (c === null) norm[f] = null;
        else {
          const d = new Date(c);
          if (Number.isNaN(d.getTime())) throw new ValidationError(`Ungültiges Datum: "${v}"`, f);
          norm[f] = dateToWire(d);
        }
      } else norm[f] = cleanStr(v);
    }
    const hash = requestHash("project.updateReview", { p: input.projectId, d: input.department, v: input.expectedVersion, c: norm });

    const result = await this.store.transaction(async tx => {
      const claim = await tx.claimIdempotency(principal.id, input.idempotencyKey, "project.updateReview", hash);
      if (claim.state === "mismatch") throw new IdempotencyKeyReuseError();
      if (claim.state === "replay") return { ...(claim.response as MutationResult), replayed: true };

      const current = await tx.lockProject(input.projectId);
      if (!current || !canViewProject(principal, current)) throw new NotFoundError();
      if (!canApproveReview(principal, current, input.department)) throw new ForbiddenError("Keine Berechtigung für dieses Gewerk");
      const review = await tx.lockReview(input.projectId, input.department);
      if (!review) throw new NotFoundError("Prüfung");
      const reviewWire = (f: ReviewField): string | null => (f === "datum" ? dateToWire(review.datum) : review[f]);

      const changes: Record<string, FieldChange> = {};
      for (const [f, to] of Object.entries(norm) as [ReviewField, string | null][]) {
        const from = reviewWire(f);
        if (from !== to) changes[reviewChangeKey(input.department, f)] = { from, to };
      }
      const localValues = Object.fromEntries(Object.entries(norm).map(([f, v]) => [reviewChangeKey(input.department, f as ReviewField), v ?? null]));
      const reviewValueOf = (key: string) => reviewWire(key.split(".")[2] as ReviewField);
      if (current.syncVersion !== input.expectedVersion) throw await this.conflict(tx, current, { id: input.projectId, expectedVersion: input.expectedVersion }, localValues, reviewValueOf);
      if (Object.keys(changes).length === 0) {
        const res: MutationResult = { project: (await tx.detail(input.projectId))!, eventId: "", replayed: false };
        await tx.completeIdempotency(principal.id, input.idempotencyKey, res);
        return res;
      }

      await tx.updateReview(review.id, {
        ...(norm.status !== undefined ? { status: norm.status } : {}),
        ...(norm.prueferName !== undefined ? { prueferName: norm.prueferName } : {}),
        ...(norm.datum !== undefined ? { datum: norm.datum === null ? null : new Date(norm.datum) } : {}),
      });
      const ok = await tx.updateVersioned(input.projectId, input.expectedVersion, {});
      if (!ok) throw await this.conflict(tx, (await tx.lockProject(input.projectId)) ?? current, { id: input.projectId, expectedVersion: input.expectedVersion }, localValues, reviewValueOf);

      const event = this.buildEvent("project.updated", principal, ctx, input.projectId, input.expectedVersion + 1, changes, { workspace: current.bahnhofsmanagement });
      await tx.appendAudit(this.auditRows(principal, event, "update", changes, labelOf(current.station, current.projektnummer)));
      await tx.appendEvent(event);
      await this.notifyWatchers(tx, principal, event, { id: input.projectId, projektnummer: current.projektnummer, station: current.station });
      const res: MutationResult = { project: (await tx.detail(input.projectId))!, eventId: event.eventId, replayed: false };
      await tx.completeIdempotency(principal.id, input.idempotencyKey, res);
      return res;
    });
    if (!result.replayed && result.eventId) this.notifyAfterCommit();
    return result;
  }

  async create(principal: Principal, input: CreateProjectInput, ctx: RequestContext): Promise<MutationResult> {
    const norm = normalizePatch(ProjectPatchSchema.parse(input.fields) as Record<string, string | null | undefined>);
    const hash = requestHash("project.create", { c: norm });

    const result = await this.store.transaction(async tx => {
      const claim = await tx.claimIdempotency(principal.id, input.idempotencyKey, "project.create", hash);
      if (claim.state === "mismatch") throw new IdempotencyKeyReuseError();
      if (claim.state === "replay") return { ...(claim.response as MutationResult), replayed: true };

      const { detail, event } = await this.createWithin(tx, principal, ctx, norm);
      const res: MutationResult = { project: detail, eventId: event.eventId, replayed: false };
      await tx.completeIdempotency(principal.id, input.idempotencyKey, res);
      return res;
    });
    if (!result.replayed) this.notifyAfterCommit();
    return result;
  }

  /**
   * The creation steps inside an OPEN transaction (authorize → insert → audit → event). Used by `create` and by
   * aggregates that create a project as part of their own transition (checklist submission), so both write the
   * same audit rows and the same event as a direct create.
   */
  async createWithin(
    tx: ProjectTx, principal: Principal, ctx: RequestContext, norm: Partial<Record<EditableProjectField, string | null>>,
    reviews: ReadonlyArray<{ department: string; status: string | null; prueferName: string | null; datum: Date | null }> = [],
  ) {
    if (!canCreateProject(principal, { bahnhofsmanagement: norm.bahnhofsmanagement ?? null })) throw new ForbiddenError();
    const id = await tx.insertProject(toColumnValues(norm));
    const changes: Record<string, FieldChange> = {};
    for (const [k, to] of Object.entries(norm)) if (to !== null && to !== undefined) changes[k] = { from: null, to };
    // the initial reviews are part of the Project aggregate's creation: inserted in this transaction and recorded in the
    // SAME audit rows and event (review.<Gewerk>.<field>), never written behind the aggregate's back
    for (const r of reviews) {
      await tx.insertReview(id, { department: r.department, status: r.status, prueferName: r.prueferName, datum: r.datum });
      if (r.status !== null) changes[reviewChangeKey(r.department, "status")] = { from: null, to: r.status };
      if (r.prueferName !== null) changes[reviewChangeKey(r.department, "prueferName")] = { from: null, to: r.prueferName };
      if (r.datum !== null) changes[reviewChangeKey(r.department, "datum")] = { from: null, to: dateToWire(r.datum) };
    }
    const event = this.buildEvent("project.created", principal, ctx, id, 1, changes, { workspace: norm.bahnhofsmanagement ?? null });
    await tx.appendAudit(this.auditRows(principal, event, "create", changes, labelOf(norm.station, norm.projektnummer)));
    await tx.appendEvent(event);
    return { id, event, detail: (await tx.detail(id))! };
  }

  async delete(
    principal: Principal,
    input: { id: number; expectedVersion: number; idempotencyKey: string },
    ctx: RequestContext,
  ): Promise<{ eventId: string; replayed: boolean }> {
    const hash = requestHash("project.delete", { id: input.id, v: input.expectedVersion });
    const result = await this.store.transaction(async tx => {
      const claim = await tx.claimIdempotency(principal.id, input.idempotencyKey, "project.delete", hash);
      if (claim.state === "mismatch") throw new IdempotencyKeyReuseError();
      if (claim.state === "replay") return { ...(claim.response as { eventId: string }), replayed: true };

      const current = await tx.lockProject(input.id);
      if (!current || !canViewProject(principal, current)) throw new NotFoundError();
      if (!canDeleteProject(principal, current)) throw new ForbiddenError();
      if (current.syncVersion !== input.expectedVersion) throw await this.conflict(tx, current, input, {});
      const version = current.syncVersion + 1;
      const event = this.buildEvent("project.deleted", principal, ctx, input.id, version, {}, {
        workspace: current.bahnhofsmanagement,
      });
      // forensic snapshot of what is about to disappear (project fields + every review), captured BEFORE the delete
      const snapshot = snapshotJson(await tx.detail(input.id));
      // notify BEFORE the project (and its watcher rows) are removed
      await this.notifyWatchers(tx, principal, event, { id: input.id, projektnummer: current.projektnummer, station: current.station });
      await tx.deleteProject(input.id);
      await tx.appendAudit(this.auditRows(principal, event, "delete", {}, labelOf(current.station, current.projektnummer), snapshot));
      await tx.appendEvent(event);
      const res = { eventId: event.eventId, replayed: false };
      await tx.completeIdempotency(principal.id, input.idempotencyKey, res);
      return res;
    });
    if (!result.replayed) this.notifyAfterCommit();
    return result;
  }

  /**
   * A durable document/message action (PDF produced, export downloaded, mail/Teams message prepared).
   * Not an aggregate transition: no version, no domain event, no realtime — exactly one audit row, written in its own
   * transaction, authorized like a read: a project must be visible to the caller; without a project the row is scoped to
   * the caller's single workspace (or left unscoped = visible to unrestricted principals only).
   */
  async recordDocumentAction(principal: Principal, input: { kind: AuditDocumentKind; details: string; projectId?: number }, ctx: RequestContext): Promise<void> {
    let workspace: string | null = null, label: string | null = null, entityType: AuditEntityType = "document", entityId = 0;
    if (input.projectId !== undefined) {
      const d = await this.get(principal, input.projectId); // NotFound if not visible: no oracle, no cross-workspace row
      workspace = d.bahnhofsmanagement; label = labelOf(d.station, d.projektnummer); entityType = "project"; entityId = d.id;
    } else {
      workspace = Array.isArray(principal.workspaces) && principal.workspaces.length === 1 ? principal.workspaces[0]! : null;
      label = input.details.slice(0, 255);
    }
    await this.store.transaction(async tx => {
      await tx.appendAudit([{
        userId: actorNumericId(principal), userName: principal.name || principal.email || principal.id, entityType, entityId,
        action: "document", field: input.kind, oldValue: null, newValue: input.details.slice(0, 500),
        eventId: null, aggregateVersion: null, traceId: ctx.traceId, workspace, entityLabel: label,
      }]);
    });
  }

  // ---- internals ----------------------------------------------------------

  /** Create the review of one Gewerk for a project: same machinery as every Project edit (version, audit, event, notification). */
  async createReview(principal: Principal, input: CreateReviewInput, ctx: RequestContext): Promise<MutationResult> {
    const norm: Partial<Record<ReviewField, string | null>> = {};
    for (const [f, v] of Object.entries(input.fields) as [ReviewField, string | null | undefined][]) {
      if (v === undefined) continue;
      if (f === "datum") {
        const c = cleanStr(v);
        if (c === null) norm[f] = null;
        else { const d = new Date(c); if (Number.isNaN(d.getTime())) throw new ValidationError(`Ungültiges Datum: "${v}"`, f); norm[f] = dateToWire(d); }
      } else norm[f] = cleanStr(v);
    }
    const hash = requestHash("project.createReview", { p: input.projectId, d: input.department, v: input.expectedVersion, c: norm });
    const result = await this.store.transaction(async tx => {
      const claim = await tx.claimIdempotency(principal.id, input.idempotencyKey, "project.createReview", hash);
      if (claim.state === "mismatch") throw new IdempotencyKeyReuseError();
      if (claim.state === "replay") return { ...(claim.response as MutationResult), replayed: true };

      const current = await tx.lockProject(input.projectId);
      if (!current || !canViewProject(principal, current)) throw new NotFoundError();
      if (!canApproveReview(principal, current, input.department)) throw new ForbiddenError("Keine Berechtigung für dieses Gewerk");
      const changes: Record<string, FieldChange> = {};
      for (const f of ["status", "prueferName", "datum"] as ReviewField[]) changes[reviewChangeKey(input.department, f)] = { from: null, to: norm[f] ?? null };
      const localValues = Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, c.to]));
      if (current.syncVersion !== input.expectedVersion) throw await this.conflict(tx, current, { id: input.projectId, expectedVersion: input.expectedVersion }, localValues, () => null);
      if (await tx.lockReview(input.projectId, input.department)) throw new ValidationError(`Für ${input.department} existiert bereits eine Prüfung`, "department");

      await tx.insertReview(input.projectId, { department: input.department, status: norm.status ?? null, prueferName: norm.prueferName ?? null, datum: norm.datum ? new Date(norm.datum) : null });
      const ok = await tx.updateVersioned(input.projectId, input.expectedVersion, {});
      if (!ok) throw await this.conflict(tx, (await tx.lockProject(input.projectId)) ?? current, { id: input.projectId, expectedVersion: input.expectedVersion }, localValues, () => null);
      const event = this.buildEvent("project.updated", principal, ctx, input.projectId, input.expectedVersion + 1, changes, { workspace: current.bahnhofsmanagement });
      await tx.appendAudit(this.auditRows(principal, event, "update", changes, labelOf(current.station, current.projektnummer)));
      await tx.appendEvent(event);
      await this.notifyWatchers(tx, principal, event, { id: input.projectId, projektnummer: current.projektnummer, station: current.station });
      const res: MutationResult = { project: (await tx.detail(input.projectId))!, eventId: event.eventId, replayed: false };
      await tx.completeIdempotency(principal.id, input.idempotencyKey, res);
      return res;
    });
    if (!result.replayed && result.eventId) this.notifyAfterCommit();
    return result;
  }

  /**
   * Domain event → policy → one notification row + one outbox event per recipient, in the
   * SAME transaction as the change. Recipients: the project's watchers except the actor.
   */
  private async notifyWatchers(tx: ProjectTx, principal: Principal, e: DomainEvent, project: { id: number; projektnummer: string | null; station: string | null }) {
    const plan = planNotification(e, project);
    if (!plan) return;
    const workspace = e.context?.workspace ?? null;
    for (const userId of await tx.watchersOf(project.id)) {
      if (userId === principal.id) continue;
      const id = await tx.insertNotification({ userId, kind: plan.kind, title: plan.title, body: plan.body, link: plan.link, workspace, eventId: e.eventId });
      await tx.appendEvent({
        schemaVersion: EVENT_SCHEMA_VERSION, eventId: randomUUID(), eventType: "notification.created", aggregateType: "notification",
        aggregateId: String(id), aggregateVersion: 1, actorId: principal.id, actorName: principal.name, timestamp: this.clock().toISOString(), traceId: e.traceId,
        changes: {
          kind: { from: null, to: plan.kind }, title: { from: null, to: plan.title }, body: { from: null, to: plan.body },
          link: { from: null, to: plan.link }, sourceEventId: { from: null, to: e.eventId },
        },
        context: { recipient: userId, workspace },
      });
    }
  }

  private notifyAfterCommit() {
    try { this.afterCommit(); } catch { /* the relay also polls; a failed nudge is not a failed write */ }
  }

  private buildEvent(
    eventType: DomainEvent["eventType"],
    principal: Principal,
    ctx: RequestContext,
    id: number,
    version: number,
    changes: Record<string, FieldChange>,
    context: NonNullable<DomainEvent["context"]>,
  ): DomainEvent {
    return {
      schemaVersion: EVENT_SCHEMA_VERSION,
      eventId: randomUUID(),
      eventType,
      aggregateType: "project",
      aggregateId: String(id),
      aggregateVersion: version,
      actorId: principal.id,
      actorName: principal.name,
      timestamp: this.clock().toISOString(),
      traceId: ctx.traceId,
      changes,
      context,
    };
  }

  private auditRows(
    principal: Principal,
    e: DomainEvent,
    action: AuditRow["action"],
    changes: Record<string, FieldChange>,
    label: string | null = null,
    snapshot: string | null = null,
  ): AuditRow[] {
    const base = {
      workspace: e.context?.workspace ?? null,
      entityLabel: label,
      userId: actorNumericId(principal),
      userName: principal.name || principal.email || principal.id,
      entityType: "project" as const,
      entityId: Number(e.aggregateId),
      action,
      eventId: e.eventId,
      aggregateVersion: e.aggregateVersion,
      traceId: e.traceId,
    };
    const fields = Object.entries(changes);
    if (fields.length === 0) return [{ ...base, field: null, oldValue: snapshot, newValue: null }];
    return fields.map(([field, c]) => ({ ...base, field, oldValue: c.from, newValue: c.to }));
  }

  private async conflict(
    tx: ProjectTx,
    current: Project,
    input: { id: number; expectedVersion: number },
    norm: Partial<Record<string, string | null>>,
    serverValueOf: (key: string) => string | null = key => currentWire(current, key as EditableProjectField),
  ): Promise<ConflictError> {
    const missed = await tx.eventsSince(input.id, input.expectedVersion, 100);
    const changedSince: Record<string, FieldChange> = {};
    for (const e of missed) {
      for (const [f, c] of Object.entries(e.changes)) {
        changedSince[f] = { from: changedSince[f]?.from ?? c.from, to: c.to };
      }
    }
    const fields = Object.keys(norm);
    const conflictingFields = fields.filter(f => f in changedSince);
    const last = missed[missed.length - 1];
    const detail = (await tx.detail(input.id))!;
    const info: ConflictInfo = {
      code: "VERSION_CONFLICT",
      projectId: input.id,
      expectedVersion: input.expectedVersion,
      currentVersion: current.syncVersion,
      serverValues: Object.fromEntries(fields.map(f => [f, serverValueOf(f)])),
      localValues: Object.fromEntries(fields.map(f => [f, norm[f] ?? null])),
      conflictingFields,
      changedSince,
      lastChange: last ? { actorId: last.actorId, actorName: last.actorName ?? null, at: last.timestamp } : null,
      disjoint: conflictingFields.length === 0,
      current: detail,
    };
    return new ConflictError(info);
  }
}
