/**
 * Versioned domain-event contract — shared by the server (producer) and the
 * browser (consumer). Pure: no I/O, no transport, no framework.
 *
 * Ordering guarantee: `aggregateVersion` is the aggregate's row version at the
 * moment the event committed. The database enforces UNIQUE(aggregateType,
 * aggregateId, aggregateVersion), so version N of an aggregate exists at most
 * once and versions form a gapless sequence per aggregate. A consumer that
 * holds version N and receives N+2 knows, with certainty, that N+1 exists and
 * was not delivered.
 */
import { z } from "zod";

export const EVENT_SCHEMA_VERSION = 1 as const;

/**
 * `project` events are durable (outbox + feed). `presence` and `notification` ride the SAME
 * envelope and transport: presence is ephemeral (published directly, never stored in SQL);
 * notifications are delivered from the same outbox as the change that caused them.
 */
export const AGGREGATE_TYPES = ["project", "presence", "notification"] as const;
export type AggregateType = (typeof AGGREGATE_TYPES)[number];

export const EVENT_TYPES = [
  "project.created",
  "project.updated",
  "project.deleted",
  /**
   * Recipient-safe form of a workspace move, sent ONLY to principals who could see the
   * project before the move but not after: it carries no field values.
   */
  "project.removed",
  /** ephemeral: a full snapshot of who is present in `aggregateId` (a scope key) */
  "presence.changed",
  /** a user notification; `context.recipient` is the only principal that may receive it */
  "notification.created",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** One changed field: the value before and after the commit. */
export const FieldChangeSchema = z.object({
  from: z.string().nullable(),
  to: z.string().nullable(),
});
export type FieldChange = z.infer<typeof FieldChangeSchema>;

export const DomainEventSchema = z.object({
  schemaVersion: z.literal(EVENT_SCHEMA_VERSION),
  eventId: z.string().uuid(),
  /** position in the change feed; set by the outbox relay, absent on unpublished rows */
  feedSeq: z.number().int().positive().optional(),
  eventType: z.enum(EVENT_TYPES),
  aggregateType: z.enum(AGGREGATE_TYPES),
  /** string on the wire so the contract survives a change of key type */
  aggregateId: z.string().min(1).max(64),
  aggregateVersion: z.number().int().min(1),
  actorId: z.string().min(1).max(64),
  /** display only; never used for authorization */
  actorName: z.string().max(256).nullable().optional(),
  timestamp: z.string().datetime({ offset: true }),
  traceId: z.string().min(1).max(64),
  /** fieldName → {from,to}. Empty for project.deleted. */
  changes: z.record(z.string(), FieldChangeSchema),
  /**
   * Routing context, derived from the aggregate AFTER the change. Scopes are
   * computed from this by scopesForEvent(); it is data, not a delivery list.
   */
  context: z
    .object({
      workspace: z.string().nullable().optional(),
      workspaceBefore: z.string().nullable().optional(),
      /** notification.created: principal id of the sole recipient */
      recipient: z.string().max(64).optional(),
    })
    .optional(),
});
export type DomainEvent = z.infer<typeof DomainEventSchema>;

// ---------------------------------------------------------------------------
// Scopes — a subscription is a set of channel names; nobody subscribes to "all".
// ---------------------------------------------------------------------------

export type ScopeKey = string;

export function slugify(value: string): string {
  return value
    .replace(/ß/g, "ss") // ß has no Unicode decomposition; "Gießen" must not become "gie-en"
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const scope = {
  project: (id: string | number): ScopeKey => `project:${id}`,
  workspace: (name: string): ScopeKey => `workspace:${slugify(name)}`,
  department: (code: string): ScopeKey => `department:${code.toUpperCase()}`,
  user: (id: string | number): ScopeKey => `user:${id}`,
  notifications: (id: string | number): ScopeKey => `notifications:${id}`,
} as const;

const SCOPE_RE = /^(workspace|department|project|user|notifications):[A-Za-z0-9_.-]{1,64}$/;
export const isValidScope = (s: string): boolean => SCOPE_RE.test(s);
export const scopeKind = (s: ScopeKey): string => s.slice(0, s.indexOf(":"));

/**
 * Channels an event is delivered on. A project moving between workspaces is
 * delivered to both, so the old workspace can drop it and the new one can add it.
 */
export function scopesForEvent(event: DomainEvent): ScopeKey[] {
  const out = new Set<ScopeKey>();
  if (event.aggregateType === "presence") return isValidScope(event.aggregateId) ? [event.aggregateId] : [];
  if (event.aggregateType === "notification") return event.context?.recipient ? [scope.notifications(event.context.recipient)] : [];
  if (event.aggregateType === "project") {
    out.add(scope.project(event.aggregateId));
    const ws = event.context?.workspace;
    const before = event.context?.workspaceBefore;
    if (ws) out.add(scope.workspace(ws));
    if (before) out.add(scope.workspace(before));
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Gap detection
// ---------------------------------------------------------------------------

export type EventDecision =
  /** version === known + 1 — apply it */
  | { kind: "apply" }
  /** version <= known — already reflected in state (replay or duplicate delivery) */
  | { kind: "stale" }
  /** version > known + 1 — events known+1 .. version-1 are missing */
  | { kind: "gap"; missingFrom: number; missingTo: number }
  /** aggregate not held locally: nothing to patch */
  | { kind: "unknown-aggregate" };

/**
 * Decide what a consumer must do with `event`, given the version it holds for
 * that aggregate (`undefined` when the aggregate is not in local state).
 * A creation event for an unseen aggregate is applicable (version 1).
 */
export function decideEvent(
  knownVersion: number | undefined,
  event: Pick<DomainEvent, "aggregateVersion" | "eventType">,
): EventDecision {
  if (knownVersion === undefined) {
    return event.eventType === "project.created" && event.aggregateVersion === 1
      ? { kind: "apply" }
      : { kind: "unknown-aggregate" };
  }
  if (event.aggregateVersion <= knownVersion) return { kind: "stale" };
  if (event.aggregateVersion === knownVersion + 1) return { kind: "apply" };
  return { kind: "gap", missingFrom: knownVersion + 1, missingTo: event.aggregateVersion - 1 };
}

/** Bounded, insertion-ordered set for eventId de-duplication. */
export class SeenEvents {
  private readonly ids = new Set<string>();
  constructor(private readonly capacity = 2048) {}
  /** returns true when the id was already present */
  seen(eventId: string): boolean {
    if (this.ids.has(eventId)) return true;
    this.ids.add(eventId);
    if (this.ids.size > this.capacity) {
      const oldest = this.ids.values().next().value;
      if (oldest !== undefined) this.ids.delete(oldest);
    }
    return false;
  }
}
