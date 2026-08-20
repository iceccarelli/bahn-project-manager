/**
 * Project KPI derivation — the single source of truth.
 *
 * Why this file exists
 * --------------------
 * Every KPI on the two dashboards was invented at the call site:
 *
 *   Projects.tsx:153  onTimeProjects  = Math.round(total * 0.86)
 *   Projects.tsx:154  delayedProjects = Math.round(total * 0.03)
 *   Dashboard.tsx:307 abgeschlossen   = Math.round(total * 0.68)
 *
 * Those are three magic multipliers, not measurements. They moved with the row
 * count and with nothing else, so importing 200 projects "improved" the
 * on-time figure by 172. The captions under them ("86% im Zeitplan",
 * "68% im Zeitplan", "+12 seit letzter Woche") were literals that agreed with
 * the multipliers by coincidence and would never have been updated.
 *
 * Everything below is computed from the 18,172 review rows that actually
 * exist. Both pages call `deriveProjectMetrics` so they cannot disagree.
 *
 * Status vocabulary comes from shared/review-status.ts, which is itself
 * derived from the stored data (all 15,646 non-null statuses map into the
 * 12 canonical values).
 */

import {
  APPROVED_STATUSES,
  BLOCKING_STATUSES,
  OPEN_STATUSES,
  normalizeReviewStatus,
} from "./review-status";

/** Minimal shape these metrics need — deliberately narrower than `Project`. */
export interface MetricReview {
  status: string | null;
}

export interface MetricProject {
  reviews?: MetricReview[] | null;
}

export interface ProjectMetrics {
  /** Every project in the current data set. */
  total: number;
  /**
   * At least one department is mid-review: "in Bearbeitung", "prüffähig" or
   * "Nachforderung". Excludes projects that have not been started at all.
   */
  active: number;
  /**
   * Every required department has signed off ("Zustimmung erteilt" or
   * "Niederschrift erstellt"). Projects with no required department at all do
   * not count as complete — there is nothing to have completed.
   */
  completed: number;
  /** At least one department returned "abgelehnt" or "gestoppt". */
  blocked: number;
  /** Not started: every required review is still "offen". */
  notStarted: number;
  /** Individual review rows still awaiting a decision. */
  openReviews: number;
  /** Individual review rows that are signed off. */
  approvedReviews: number;
  /** Review rows the checklist marked "nicht erforderlich". */
  notRequiredReviews: number;
  /**
   * Rows whose stored status is null/blank or does not map onto the canonical
   * vocabulary. Reported rather than absorbed: openReviews + approvedReviews +
   * notRequiredReviews + blockedReviews + unresolvedReviews === totalReviews,
   * exactly, always.
   */
  unresolvedReviews: number;
  /** Review rows in "abgelehnt" or "gestoppt". */
  blockedReviews: number;
  /** Review rows in total. */
  totalReviews: number;
  /**
   * Projects where no department is required at all (every row is
   * "nicht erforderlich" or unresolved). They belong to no lifecycle bucket,
   * so they are counted here instead of being quietly dropped:
   * active + completed + blocked + notStarted + unclassified === total.
   */
  unclassified: number;
}

const OPEN = new Set<string>(OPEN_STATUSES);
const APPROVED = new Set<string>(APPROVED_STATUSES);
const BLOCKING = new Set<string>(BLOCKING_STATUSES);
/** Statuses that mean the department is mid-flight, i.e. not merely queued. */
const IN_FLIGHT = new Set<string>(["in Bearbeitung", "prüffähig", "Nachforderung"]);

export const EMPTY_METRICS: Readonly<ProjectMetrics> = Object.freeze({
  total: 0,
  active: 0,
  completed: 0,
  blocked: 0,
  notStarted: 0,
  openReviews: 0,
  approvedReviews: 0,
  notRequiredReviews: 0,
  unresolvedReviews: 0,
  blockedReviews: 0,
  totalReviews: 0,
  unclassified: 0,
});

export function deriveProjectMetrics(
  projects: readonly MetricProject[] | null | undefined,
): ProjectMetrics {
  if (!projects || projects.length === 0) return { ...EMPTY_METRICS };

  const m: ProjectMetrics = { ...EMPTY_METRICS, total: projects.length };

  for (const project of projects) {
    const reviews = project.reviews ?? [];
    let required = 0;
    let approved = 0;
    let inFlight = 0;
    let blocked = 0;

    for (const review of reviews) {
      m.totalReviews += 1;
      // normalizeReviewStatus maps the stored debris ("Niederschrift erstellt
      // (LP05-05-01-F31)" and friends) onto the canonical 12. Anything it
      // cannot map returns null and is counted as neither open nor approved
      // rather than being silently bucketed.
      const status = normalizeReviewStatus(review.status);
      if (status === null) {
        m.unresolvedReviews += 1;
        continue;
      }
      if (status === "nicht erforderlich") {
        m.notRequiredReviews += 1;
        continue;
      }
      required += 1;
      if (APPROVED.has(status)) {
        approved += 1;
        m.approvedReviews += 1;
      } else if (BLOCKING.has(status)) {
        blocked += 1;
        m.blockedReviews += 1;
      } else if (OPEN.has(status)) {
        m.openReviews += 1;
        if (IN_FLIGHT.has(status)) inFlight += 1;
      } else {
        // "Projektkonfig.", "Prüfung erfolgt", "zurückgestellt" — canonical but
        // in none of the three groups. They keep the project out of "completed"
        // (required is already incremented) and are reported separately.
        m.unresolvedReviews += 1;
      }
    }

    if (blocked > 0) {
      m.blocked += 1;
    } else if (required > 0 && approved === required) {
      m.completed += 1;
    } else if (inFlight > 0) {
      m.active += 1;
    } else if (required > 0) {
      m.notStarted += 1;
    } else {
      m.unclassified += 1;
    }
  }

  return m;
}

/** Whole-percent share of `part` in `total`; 0 when there is nothing to divide. */
export function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}
