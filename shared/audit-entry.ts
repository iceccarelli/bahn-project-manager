/**
 * What an audit entry has to carry to be worth keeping.
 *
 * The trail recorded this, verbatim:
 *
 *     ITK: status von Zustimmung erteilt auf offen gesetzt.
 *
 * A granted approval was withdrawn and the record does not say on which of
 * 1,298 projects. Nobody can act on that, nobody can audit it, and it cannot be
 * undone — the entry does not know what it changed. Everything below exists to
 * fix that one sentence.
 *
 * ---------------------------------------------------------------------------
 * Three things a CEO asks of a change log
 * ---------------------------------------------------------------------------
 * 1. WHAT changed, precisely: which project, which Gewerk, which field, from
 *    what to what. `AuditMeta`.
 * 2. HOW BAD is it: withdrawing an approval is not the same event as filling in
 *    a Prüfer's name, and a log that renders them identically forces a reader
 *    to grade 18,172 rows by eye. `severityOf`.
 * 3. WAS IT MEANT: people mis-click. A status changed and changed back ninety
 *    seconds later is one person correcting themselves, not two decisions.
 *    `markCorrections`.
 *
 * ---------------------------------------------------------------------------
 * Nothing is ever deleted
 * ---------------------------------------------------------------------------
 * A correction marks the earlier entry as superseded; it does not remove it.
 * An undo writes a new entry restoring the old value; it does not erase the
 * change it reverses. An audit trail that can lose rows is not evidence of
 * anything, and the whole point of the grace window is to make accidents
 * *legible*, not invisible.
 */

import { normalizeReviewStatus, APPROVED_STATUSES, BLOCKING_STATUSES } from "./review-status";

/** The structured half of an entry. Absent on entries written before this file. */
export interface AuditMeta {
  projectId?: number;
  projektnummer?: string | null;
  station?: string | null;
  /** The Gewerk, when the change was to a Fachprüfung. */
  department?: string | null;
  field?: string | null;
  from?: string | null;
  to?: string | null;
  /** Where the user was standing when they did it. */
  surface?: string | null;
}

export type Severity = "kritisch" | "wichtig" | "routine";

export const SEVERITY_LABEL: Record<Severity, string> = {
  kritisch: "Kritisch",
  wichtig: "Wichtig",
  routine: "Routine",
};

export const SEVERITY_ORDER: readonly Severity[] = ["kritisch", "wichtig", "routine"];

/** Fields that identify a record. Renaming one silently re-labels a project. */
const IDENTITY_FIELDS = new Set(["projektnummer", "station", "projektleiter", "bahnhofsnummer"]);

const isApprovedStatus = (s: string | null | undefined) => {
  const n = normalizeReviewStatus(s);
  return n !== null && (APPROVED_STATUSES as readonly string[]).includes(n);
};
const isBlockingStatus = (s: string | null | undefined) => {
  const n = normalizeReviewStatus(s);
  return n !== null && (BLOCKING_STATUSES as readonly string[]).includes(n);
};

/**
 * How much this change should worry someone.
 *
 * The rules are about consequence, not about which screen the change came from:
 *
 *   kritisch — a project or a required check disappears, or an approval that
 *              was granted is taken away. These are the changes that move a
 *              delivery date and the ones a reader must not have to hunt for.
 *   wichtig  — a record's identity changed, or a check entered a blocked state.
 *              Worth reading today, not worth an alarm.
 *   routine  — everything else: normal progress through the workflow, a Prüfer
 *              filled in, a document exported, a message prepared.
 */
export function severityOf(action: string, meta?: AuditMeta | null): Severity {
  if (action === "Projekt gelöscht") return "kritisch";
  if (!meta?.field) return "routine";

  if (meta.field === "status") {
    const from = meta.from ?? null;
    const to = meta.to ?? null;
    const toNormal = normalizeReviewStatus(to);

    // An approval that was granted is being taken away.
    if (isApprovedStatus(from) && !isApprovedStatus(to)) return "kritisch";
    // A check that was required is being marked not required — it stops being
    // counted, on every page, silently.
    if (toNormal === "nicht erforderlich" && normalizeReviewStatus(from) !== "nicht erforderlich") {
      return "kritisch";
    }
    // Newly blocked.
    if (isBlockingStatus(to) && !isBlockingStatus(from)) return "wichtig";
    return "routine";
  }

  if (IDENTITY_FIELDS.has(meta.field)) return "wichtig";
  return "routine";
}

/** The German sentence, built from structure rather than pasted together. */
export function describeChange(meta?: AuditMeta | null): string {
  if (!meta) return "";
  const who = [meta.projektnummer, meta.station].filter(Boolean).join(" · ");
  const what = meta.department ? `${meta.department} · ${meta.field}` : meta.field;
  const from = (meta.from ?? "").trim() || "leer";
  const to = (meta.to ?? "").trim() || "leer";
  const parts = [who, what ? `${what}: ${from} → ${to}` : ""].filter(Boolean);
  if (meta.surface) parts.push(`in ${meta.surface}`);
  return parts.join(" · ");
}

/**
 * The identity of "the same thing changed again".
 *
 * Project id, Gewerk and field. Two people editing the same field of the same
 * review inside the window is still one correction of one value — which is the
 * thing being collapsed, regardless of who did it.
 */
export function correctionKey(meta?: AuditMeta | null): string | null {
  if (!meta || meta.projectId === undefined || !meta.field) return null;
  return `${meta.projectId}|${meta.department ?? ""}|${meta.field}`;
}

/** Default grace period. Ten minutes: long enough to notice, short enough to mean it. */
export const CORRECTION_WINDOW_MINUTES = 10;

export interface CorrectableEntry {
  id: string;
  timestamp: string;
  action: string;
  meta?: AuditMeta | null;
}

export interface EntryVerdict {
  /** A later change to the same field landed inside the window. */
  superseded: boolean;
  /** This change put the value back where it started — a self-correction. */
  revertsEarlier: boolean;
  /** Still inside the grace window, so an undo is offered. */
  undoable: boolean;
  severity: Severity;
}

/**
 * Classify a whole trail in one pass.
 *
 * `entries` must be newest-first, which is how the store keeps them.
 *
 * `now` is a parameter rather than a call to Date.now(), because a function
 * whose answer depends on the wall clock cannot be tested, and a trail that
 * classifies differently on every render cannot be trusted.
 */
export function markCorrections(
  entries: readonly CorrectableEntry[],
  now: number,
  windowMinutes: number = CORRECTION_WINDOW_MINUTES,
): Map<string, EntryVerdict> {
  const windowMs = windowMinutes * 60_000;
  const out = new Map<string, EntryVerdict>();
  /** Most recent entry seen per field, walking newest → oldest. */
  const latest = new Map<string, CorrectableEntry>();

  for (const entry of entries) {
    const at = Date.parse(entry.timestamp);
    const severity = severityOf(entry.action, entry.meta);
    const key = correctionKey(entry.meta);
    const undoable = Number.isFinite(at) && now - at <= windowMs;

    if (!key) {
      out.set(entry.id, { superseded: false, revertsEarlier: false, undoable, severity });
      continue;
    }

    const newer = latest.get(key);
    // Newest-first, so `newer` is the change that came after this one.
    const supersededBy =
      newer && Number.isFinite(at) ? Date.parse(newer.timestamp) - at <= windowMs : false;

    const revertsEarlier = Boolean(
      newer && (newer.meta?.to ?? null) === (entry.meta?.from ?? null) && supersededBy,
    );

    out.set(entry.id, {
      superseded: Boolean(supersededBy),
      revertsEarlier,
      undoable,
      severity,
    });
    latest.set(key, entry);
  }
  return out;
}

/** Route → the name a reader would use for it. */
export function surfaceForPath(pathname: string): string {
  if (pathname.startsWith("/bvb-eea")) return "BVB-EEA";
  if (pathname.startsWith("/psv-itk")) return "PSV-ITK";
  if (pathname.startsWith("/projects")) return "Projekte";
  if (pathname.startsWith("/anmeldung")) return "Projektanmeldung";
  if (pathname.startsWith("/audit")) return "Änderungshistorie";
  if (pathname === "/" || pathname === "") return "Dashboard";
  return "App";
}
