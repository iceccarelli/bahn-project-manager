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
  type UpdateProjectInput,
} from "@shared/project-contract";
import type { Project } from "../../drizzle/schema";
import { dateToWire } from "../infra/mysqlProjectStore";
import {
  ConflictError, ForbiddenError, IdempotencyKeyReuseError, NotFoundError, ValidationError,
} from "./errors";
import {
  canCreateProject, canDeleteProject, canEditProject, canViewProject, type Principal,
} from "./permissions";
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
const requestHash = (op: string, body: unknown) =>
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
      if (contiguous) events.push(...evs);
      else {
        const d = await this.store.detail(k.id);
        if (d) snapshots.push(d);
      }
    }
    return { events, snapshots, deleted };
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
      await tx.appendAudit(this.auditRows(principal, event, "update", changes));
      await tx.appendEvent(event);
      const detail = (await tx.detail(input.id))!;
      const res: MutationResult = { project: detail, eventId: event.eventId, replayed: false };
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

      if (!canCreateProject(principal, { bahnhofsmanagement: norm.bahnhofsmanagement ?? null })) throw new ForbiddenError();
      const id = await tx.insertProject(toColumnValues(norm));
      const changes: Record<string, FieldChange> = {};
      for (const [k, to] of Object.entries(norm)) if (to !== null) changes[k] = { from: null, to };
      const event = this.buildEvent("project.created", principal, ctx, id, 1, changes, {
        workspace: norm.bahnhofsmanagement ?? null,
      });
      await tx.appendAudit(this.auditRows(principal, event, "create", changes));
      await tx.appendEvent(event);
      const res: MutationResult = { project: (await tx.detail(id))!, eventId: event.eventId, replayed: false };
      await tx.completeIdempotency(principal.id, input.idempotencyKey, res);
      return res;
    });
    if (!result.replayed) this.notifyAfterCommit();
    return result;
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
      await tx.deleteProject(input.id);
      await tx.appendAudit(this.auditRows(principal, event, "delete", {}));
      await tx.appendEvent(event);
      const res = { eventId: event.eventId, replayed: false };
      await tx.completeIdempotency(principal.id, input.idempotencyKey, res);
      return res;
    });
    if (!result.replayed) this.notifyAfterCommit();
    return result;
  }

  // ---- internals ----------------------------------------------------------

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
  ): AuditRow[] {
    const base = {
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
    if (fields.length === 0) return [{ ...base, field: null, oldValue: null, newValue: null }];
    return fields.map(([field, c]) => ({ ...base, field, oldValue: c.from, newValue: c.to }));
  }

  private async conflict(
    tx: ProjectTx,
    current: Project,
    input: { id: number; expectedVersion: number },
    norm: Partial<Record<EditableProjectField, string | null>>,
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
      serverValues: Object.fromEntries(fields.map(f => [f, currentWire(current, f as EditableProjectField)])),
      localValues: Object.fromEntries(fields.map(f => [f, norm[f as EditableProjectField] ?? null])),
      conflictingFields,
      changedSince,
      lastChange: last ? { actorId: last.actorId, actorName: last.actorName ?? null, at: last.timestamp } : null,
      disjoint: conflictingFields.length === 0,
      current: detail,
    };
    return new ConflictError(info);
  }
}
