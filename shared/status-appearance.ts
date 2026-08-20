/**
 * Review-status appearance — one source, two renderings.
 *
 * Why this file exists
 * --------------------
 * The same twelve statuses were coloured by four independent implementations:
 *
 *   Projects.tsx:20   a 12-entry map of Tailwind class strings
 *   Dashboard.tsx:21  an 11-entry map of raw hex, for Recharts
 *   BvbEea.tsx:82     an inline ternary covering 3 statuses
 *   PsvItk.tsx:82     the same ternary, copied
 *
 * They disagreed, and the disagreements were visible:
 *
 *   - "Prüfung erfolgt" was missing from the Dashboard map entirely, so a
 *     completed review fell through to the grey default and rendered in the
 *     pie chart exactly like "nicht erforderlich".
 *   - "gestoppt" was rose in the table and #f97316 (orange) on the dashboard —
 *     the same orange as "Nachforderung", making the two indistinguishable in
 *     the chart while they were clearly different in the table.
 *   - BvbEea and PsvItk knew only 3 of the 12; the other 9 rendered unstyled.
 *
 * The fix is not a bigger map, it is one fewer decision. Each status is
 * assigned a semantic TONE. A tone owns its badge classes and its chart hex,
 * so the two can no longer drift: adding a status is one line, and a status
 * with no tone is a type error rather than a silent grey.
 */

import type { ReviewStatus } from "./review-status";
import { REVIEW_STATUSES } from "./validation";

/**
 * What a status means to the person reading it, independent of which widget
 * is doing the reading.
 */
export type StatusTone =
  /** Out of scope — the checklist said this department is not involved. */
  | "neutral"
  /** Queued, nobody has picked it up. */
  | "pending"
  /** Someone is working on it. */
  | "active"
  /** Handed back for more information. */
  | "attention"
  /** Ready for, or past, the formal decision but not yet signed off. */
  | "review"
  /** Signed off. */
  | "done"
  /** Parked — no longer moving, but not a refusal. */
  | "paused"
  /** Refused or halted. Blocks the project. */
  | "blocked";

interface ToneAppearance {
  /** Badge classes, light and dark. */
  badge: string;
  /** Solid hex for canvas/SVG surfaces (Recharts, Leaflet) that cannot take a class. */
  hex: string;
  /** Short German label for legends and screen readers. */
  label: string;
}

/**
 * Deliberately not the DB red: #FF0000 is the brand colour and is reserved for
 * actions and identity. A status badge that shouts in brand red every time a
 * review is open would leave nothing louder for "abgelehnt".
 */
export const TONE_APPEARANCE: Record<StatusTone, ToneAppearance> = {
  neutral: {
    badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    hex: "#64748b",
    label: "nicht relevant",
  },
  pending: {
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    hex: "#f59e0b",
    label: "offen",
  },
  active: {
    badge: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    hex: "#3b82f6",
    label: "in Arbeit",
  },
  attention: {
    badge: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
    hex: "#f97316",
    label: "Rückfrage",
  },
  review: {
    badge: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
    hex: "#06b6d4",
    label: "in Prüfung",
  },
  done: {
    badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
    hex: "#10b981",
    label: "abgeschlossen",
  },
  paused: {
    badge: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
    hex: "#8b5cf6",
    label: "zurückgestellt",
  },
  blocked: {
    badge: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    hex: "#ef4444",
    label: "blockiert",
  },
};

/**
 * Every canonical status, mapped to exactly one tone.
 *
 * `Record<ReviewStatus, StatusTone>` is the load-bearing part: add a status to
 * REVIEW_STATUSES without giving it a tone and this file stops compiling. That
 * is what makes the "missing Prüfung erfolgt" class of bug impossible to
 * reintroduce.
 */
export const STATUS_TONE: Record<ReviewStatus, StatusTone> = {
  "nicht erforderlich": "neutral",
  offen: "pending",
  "Projektkonfig.": "paused",
  "in Bearbeitung": "active",
  Nachforderung: "attention",
  "prüffähig": "review",
  // Previously absent from the Dashboard map and therefore grey — identical to
  // "nicht erforderlich" in the chart, for a review that had actually happened.
  "Prüfung erfolgt": "review",
  "Zustimmung erteilt": "done",
  "Niederschrift erstellt": "done",
  abgelehnt: "blocked",
  "zurückgestellt": "paused",
  // Was orange on the dashboard, colliding with Nachforderung. It stops a
  // project, so it belongs with abgelehnt.
  gestoppt: "blocked",
};

const FALLBACK: ToneAppearance = TONE_APPEARANCE.neutral;

function toneFor(status: string | null | undefined): StatusTone | null {
  if (!status) return null;
  return STATUS_TONE[status as ReviewStatus] ?? null;
}

/** Badge classes for a status. Unknown or null input gets the neutral badge. */
export function statusBadgeClass(status: string | null | undefined): string {
  const tone = toneFor(status);
  return tone ? TONE_APPEARANCE[tone].badge : FALLBACK.badge;
}

/** Solid colour for a status, for surfaces that cannot take a class. */
export function statusHex(status: string | null | undefined): string {
  const tone = toneFor(status);
  return tone ? TONE_APPEARANCE[tone].hex : FALLBACK.hex;
}

/** Legend entries, in the workflow order a reader expects. */
export const STATUS_LEGEND: ReadonlyArray<{
  status: ReviewStatus;
  tone: StatusTone;
  hex: string;
}> = REVIEW_STATUSES.map((status) => {
  const tone = STATUS_TONE[status];
  return { status, tone, hex: TONE_APPEARANCE[tone].hex };
});
