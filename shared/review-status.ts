/**
 * shared/review-status.ts
 * ---------------------------------------------------------------------------
 * Department review status.
 *
 * `REVIEW_STATUSES` in shared/validation.ts lists 12 values. client/public/data.json
 * contains 14 distinct non-null values: the 12, plus two variants that mean the
 * same thing as one of them:
 *
 *   "Projektkonfiguration"                    33 rows  → "Projektkonfig."
 *   "Niederschrift erstellt (LP05-05-01-F31)" 80 rows  → "Niederschrift erstellt"
 *
 * The stored values are deliberately NOT rewritten. "(LP05-05-01-F31)" is a
 * document reference someone recorded on purpose, and deleting it to satisfy an
 * enum would lose business information. Instead, everything that groups —
 * filters, dashboards, statistics — normalises through this module, so the two
 * variants stop appearing as separate buckets while the source stays intact.
 */

import { REVIEW_STATUSES } from "./validation";

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Statuses that mean the department still has work to do. */
export const OPEN_STATUSES: readonly ReviewStatus[] = [
  "offen",
  "in Bearbeitung",
  "Nachforderung",
  "prüffähig",
];

/** Statuses that mean the department has signed off. */
export const APPROVED_STATUSES: readonly ReviewStatus[] = [
  "Zustimmung erteilt",
  "Niederschrift erstellt",
];

/** Statuses that block the project. */
export const BLOCKING_STATUSES: readonly ReviewStatus[] = ["abgelehnt", "gestoppt"];

function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ß/g, "ss")
    .replace(/\s+/g, " ")
    .trim();
}

const CANONICAL_BY_FOLD = new Map<string, ReviewStatus>(
  REVIEW_STATUSES.map((s) => [fold(s), s]),
);

const ALIAS_BY_FOLD = new Map<string, ReviewStatus>([
  [fold("Projektkonfiguration"), "Projektkonfig."],
  [fold("Projektkonfig"), "Projektkonfig."],
]);

/**
 * Map a stored status onto the canonical vocabulary.
 *
 * A value that starts with a canonical status followed by a parenthesised
 * annotation — "Niederschrift erstellt (LP05-05-01-F31)" — resolves to that
 * status. Anything else returns null so it can be surfaced rather than silently
 * bucketed somewhere wrong.
 */
export function normalizeReviewStatus(input: unknown): ReviewStatus | null {
  if (input == null) return null;
  const cleaned = String(input).replace(/\s+/g, " ").trim();
  if (cleaned === "") return null;
  const key = fold(cleaned);

  const direct = CANONICAL_BY_FOLD.get(key);
  if (direct) return direct;

  const alias = ALIAS_BY_FOLD.get(key);
  if (alias) return alias;

  // "<canonical> (annotation)" — keep the status, ignore the annotation
  const stripped = fold(cleaned.replace(/\s*\([^)]*\)\s*$/, ""));
  return CANONICAL_BY_FOLD.get(stripped) ?? ALIAS_BY_FOLD.get(stripped) ?? null;
}

export function isOpen(status: unknown): boolean {
  const s = normalizeReviewStatus(status);
  return s !== null && (OPEN_STATUSES as readonly string[]).includes(s);
}

export function isApproved(status: unknown): boolean {
  const s = normalizeReviewStatus(status);
  return s !== null && (APPROVED_STATUSES as readonly string[]).includes(s);
}

export function isBlocking(status: unknown): boolean {
  const s = normalizeReviewStatus(status);
  return s !== null && (BLOCKING_STATUSES as readonly string[]).includes(s);
}
