/**
 * Recipient-safe events.
 *
 * The outbox stores ONE full envelope per change, but who may see what is a
 * property of the recipient. Channels are only a routing hint (a project channel
 * subscription is authorized when it is opened, before the project may move), so
 * every delivery path — live stream, reconnect feed, aggregate sync — passes the
 * event through `eventForPrincipal` for the recipient it is about to reach.
 *
 * Workspace move A → B:
 *   sees B (and maybe A)   full event; if they could NOT see A, the "from" values
 *                          and the old workspace name are stripped (they learn
 *                          nothing about the project's state before it entered B)
 *   sees only A            `project.removed`: no field values, no new workspace
 *   sees neither           nothing
 */
import type { DomainEvent } from "@shared/domain-events";
import { canViewProject, type Principal } from "./permissions";

/** Sentinel for "moved in from a workspace you may not know about". */
export const HIDDEN_WORKSPACE = "*";

export function eventForPrincipal(p: Principal, e: DomainEvent): DomainEvent | null {
  if (e.aggregateType !== "project") return null;
  const now = e.context?.workspace ?? null;
  const before = e.context?.workspaceBefore ?? null;
  const sees = (ws: string | null) => canViewProject(p, { bahnhofsmanagement: ws });

  if (e.eventType === "project.removed") return sees(before) ? e : null;
  if (e.eventType === "project.deleted") return sees(now) || (before !== null && sees(before)) ? e : null;

  const seesNow = sees(now);
  if (before === null) return seesNow ? e : null; // no move: plain visibility

  const seesBefore = sees(before);
  if (seesNow && seesBefore) return e;
  if (seesNow) {
    // moved IN from a workspace this principal cannot see: no history leaks
    return {
      ...e,
      changes: Object.fromEntries(Object.entries(e.changes).map(([f, c]) => [f, { from: null, to: c.to }])),
      context: { ...e.context, workspaceBefore: HIDDEN_WORKSPACE },
    };
  }
  if (seesBefore) {
    // moved OUT: removal semantics only
    return {
      schemaVersion: e.schemaVersion,
      eventId: e.eventId,
      ...(e.feedSeq !== undefined ? { feedSeq: e.feedSeq } : {}),
      eventType: "project.removed",
      aggregateType: e.aggregateType,
      aggregateId: e.aggregateId,
      aggregateVersion: e.aggregateVersion,
      actorId: "redacted",
      actorName: null,
      timestamp: e.timestamp,
      traceId: e.traceId,
      changes: {},
      context: { workspace: null, workspaceBefore: before },
    };
  }
  return null;
}
