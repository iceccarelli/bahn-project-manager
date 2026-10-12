import { TONE_APPEARANCE, type StatusTone } from "../status-appearance";
import type { AbnahmeStatus } from "./types";

/**
 * Which tone each Abnahme status speaks in. Same vocabulary as the review
 * statuses (shared/status-appearance.ts): Erfüllt reads like "Zustimmung
 * erteilt", Offen like "offen", Entfällt like "nicht erforderlich" — so a
 * green, amber or grey chip means the same thing on the Übersicht and in the
 * Abnahme. `Record<AbnahmeStatus, …>` makes a new status without a tone a
 * compile error, exactly as STATUS_TONE does for review statuses.
 */
export const ABNAHME_STATUS_TONE: Record<AbnahmeStatus, StatusTone> = {
  Erfüllt: "done",
  Offen: "pending",
  Entfällt: "neutral",
};

/** Badge classes of the status — the same string the Übersicht badges use. */
export function abnahmeBadgeClass(status: AbnahmeStatus): string {
  return TONE_APPEARANCE[ABNAHME_STATUS_TONE[status]].badge;
}

/**
 * The same classes, applying only while a Radix toggle is `on`.
 *
 * Tailwind finds classes by scanning source text, so these cannot be built at
 * runtime from `abnahmeBadgeClass`. They are spelled out, and appearance.test.ts
 * asserts they are exactly the tone badge with every token prefixed — if a tone
 * is recoloured in status-appearance.ts and this table is not, the test fails
 * instead of the two surfaces drifting apart.
 */
export const ABNAHME_TOGGLE_ON_CLASS: Record<AbnahmeStatus, string> = {
  Erfüllt:
    "data-[state=on]:bg-emerald-100 data-[state=on]:text-emerald-800 dark:data-[state=on]:bg-emerald-900/30 dark:data-[state=on]:text-emerald-300",
  Offen:
    "data-[state=on]:bg-amber-100 data-[state=on]:text-amber-800 dark:data-[state=on]:bg-amber-900/30 dark:data-[state=on]:text-amber-300",
  Entfällt:
    "data-[state=on]:bg-slate-100 data-[state=on]:text-slate-700 dark:data-[state=on]:bg-slate-800 dark:data-[state=on]:text-slate-300",
};

/** `bg-x dark:bg-y` → `data-[state=on]:bg-x dark:data-[state=on]:bg-y`. */
export function prefixToggleOn(badge: string): string {
  return badge
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => (token.startsWith("dark:") ? `dark:data-[state=on]:${token.slice(5)}` : `data-[state=on]:${token}`))
    .join(" ");
}
