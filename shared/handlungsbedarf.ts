/**
 * The four things that need somebody to act, defined once.
 *
 * ---------------------------------------------------------------------------
 * Why this is its own module
 * ---------------------------------------------------------------------------
 * The Dashboard counted these four buckets inline, in a `useMemo` nobody else
 * could reach. The moment those counts became clickable — "show me the 558" —
 * a second implementation would have had to exist on the Projekte page to
 * decide which projects to show, and two implementations of "overdue" drift on
 * the day one of them learns about a status the other has not. A badge that
 * says 558 and a page that then lists a different set is worse than a badge
 * that does not link anywhere, because it looks like it worked.
 *
 * So the predicate lives here, once, and both sides call it.
 *
 * ---------------------------------------------------------------------------
 * Rows are not projects, and the UI must say so
 * ---------------------------------------------------------------------------
 * These are predicates over PRÜFZEILEN. 558 overdue rows do not live in 558
 * projects — several land on the same project. The Dashboard badge counts rows
 * (that is the workload), the Projekte page can only list projects, and the two
 * numbers therefore differ by construction.
 *
 * `countBedarf` returns both, so the landing page can print the reconciliation
 * — "558 Prüfzeilen in 412 Projekten" — instead of leaving a reader to notice
 * the mismatch and stop trusting the screen.
 */

import { BLOCKING_STATUSES, OPEN_STATUSES, normalizeReviewStatus } from "./review-status";
import { toDate } from "./date";
import type { PortfolioProject, PortfolioReview } from "./portfolio-metrics";
import type { StatusTone } from "./status-appearance";

export type BedarfKey = "overdue" | "blocked" | "nachforderung" | "unassigned";

export interface BedarfDefinition {
  key: BedarfKey;
  /** What the row says on the Dashboard and on the filter chip. */
  label: string;
  /** Tone for the badge, from the one appearance table. */
  tone: StatusTone;
  /**
   * True when this bucket is about work still waiting for a decision — those
   * pulse, the settled ones do not. `blocked` is urgent but it is not open:
   * a rejected review has had its decision.
   */
  awaiting: boolean;
  /** Stated on the chip, so a reader can check the count themselves. */
  basis: string;
}

export const BEDARF: readonly BedarfDefinition[] = [
  {
    key: "overdue",
    label: "Prüftermin überschritten",
    tone: "blocked",
    awaiting: true,
    basis: "Offene Prüfzeilen, deren eingetragenes Prüfdatum vor heute liegt.",
  },
  {
    key: "blocked",
    label: "abgelehnt oder gestoppt",
    tone: "blocked",
    awaiting: false,
    basis: "Prüfzeilen im Status „abgelehnt“ oder „gestoppt“.",
  },
  {
    key: "nachforderung",
    label: "Nachforderung offen",
    tone: "attention",
    awaiting: true,
    basis: "Prüfzeilen im Status „Nachforderung“.",
  },
  {
    key: "unassigned",
    label: "offen, ohne Prüfer",
    tone: "pending",
    awaiting: true,
    basis: "Offene Prüfzeilen, deren Prüferfeld leer ist.",
  },
];

const BY_KEY = new Map(BEDARF.map((b) => [b.key, b]));

/** The definition for a key, or null when the key came from a URL and is junk. */
export function bedarfFor(key: string | null | undefined): BedarfDefinition | null {
  return key ? (BY_KEY.get(key as BedarfKey) ?? null) : null;
}

const isOpenStatus = (s: string | null) =>
  s !== null && (OPEN_STATUSES as readonly string[]).includes(s);
const isBlockedStatus = (s: string | null) =>
  s !== null && (BLOCKING_STATUSES as readonly string[]).includes(s);

/**
 * Does this one review row fall in this bucket?
 *
 * `today` is passed in rather than read from the clock so the same call gives
 * the same answer twice in one render, and so a test can pin a date.
 */
export function reviewMatchesBedarf(
  review: PortfolioReview,
  key: BedarfKey,
  today: number,
): boolean {
  const status = normalizeReviewStatus(review.status);
  if (status === null) return false;
  switch (key) {
    case "blocked":
      return isBlockedStatus(status);
    case "nachforderung":
      return status === "Nachforderung";
    case "overdue": {
      if (!isOpenStatus(status)) return false;
      // `toDate`, the same helper the Dashboard used inline, so the migration
      // to this module cannot move a single count.
      const due = toDate(review.pruefDatum ?? null);
      return due !== null && due.getTime() < today;
    }
    case "unassigned":
      return isOpenStatus(status) && !review.prueferName?.trim();
    default:
      return false;
  }
}

/** A project belongs in the filtered set when any of its rows does. */
export function projectMatchesBedarf(
  project: PortfolioProject,
  key: BedarfKey,
  today: number,
): boolean {
  for (const review of project.reviews ?? []) {
    if (reviewMatchesBedarf(review, key, today)) return true;
  }
  return false;
}

export interface BedarfCount {
  key: BedarfKey;
  label: string;
  tone: StatusTone;
  awaiting: boolean;
  basis: string;
  /** Prüfzeilen — the workload figure the Dashboard badge shows. */
  rows: number;
  /** Distinct projects those rows sit in — what a list can actually show. */
  projects: number;
}

/** Both figures for all four buckets, in one pass over the data. */
export function countBedarf(
  projects: readonly PortfolioProject[],
  today: number,
): BedarfCount[] {
  const rows = new Map<BedarfKey, number>();
  const hit = new Map<BedarfKey, Set<number>>();
  for (const definition of BEDARF) {
    rows.set(definition.key, 0);
    hit.set(definition.key, new Set());
  }
  for (const project of projects) {
    for (const review of project.reviews ?? []) {
      for (const definition of BEDARF) {
        if (!reviewMatchesBedarf(review, definition.key, today)) continue;
        rows.set(definition.key, (rows.get(definition.key) ?? 0) + 1);
        hit.get(definition.key)?.add(project.id);
      }
    }
  }
  return BEDARF.map((definition) => ({
    ...definition,
    rows: rows.get(definition.key) ?? 0,
    projects: hit.get(definition.key)?.size ?? 0,
  }));
}

/**
 * Where a bucket sends the reader.
 *
 * Cards, not the table: the reader clicked a number in order to look at the
 * projects behind it, and the card is the surface that carries "Details
 * anzeigen". The Projekte page reads `bedarf` and reconciles the two counts on
 * screen.
 */
export function bedarfHref(key: BedarfKey): string {
  return `/projects?bedarf=${encodeURIComponent(key)}&view=cards`;
}

/** Where one project's card lives, addressed by id so nothing is ambiguous. */
export function projectHref(id: number): string {
  return `/projects?projekt=${id}&view=cards`;
}
