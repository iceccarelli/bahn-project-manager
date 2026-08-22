/**
 * What a CEO can act on.
 *
 * The Dashboard's Gewerke grid showed this, for seven of its eight tiles:
 *
 *     EEA   1.298      ITK   1.298      BS   1.298      GA   1.298
 *
 * That number is "projects whose row for this Gewerk carries a status the
 * vocabulary recognises", and since every project has all 14 rows and almost
 * all of them are filled in, it is 1,298 for nearly every Gewerk, forever. It
 * moves only when data is added. It reads as "1,298 EEA-Prüfungen" and the real
 * figure is 814 — the other 484 are "nicht erforderlich". ITK is 510, GA is 158,
 * HFT is 100. Eight tiles carrying the same constant told a reader nothing and
 * told them it with confidence.
 *
 * Everything here is derived from the stored rows and states its own basis.
 * Nothing is a multiplier of the row count.
 *
 * ---------------------------------------------------------------------------
 * On the risk score
 * ---------------------------------------------------------------------------
 * `riskScore` is a RANKING HEURISTIC, not a measurement, and it is documented
 * as one wherever it is shown. It exists to answer "which Gewerk do I look at
 * first" — a question with no ground truth in this dataset — and its weights
 * are stated in the open so a reader can disagree with them. It is never
 * presented as a probability, a cost, or a forecast, because the data cannot
 * support any of those and inventing one is exactly the class of defect this
 * project has spent its time removing.
 */

import {
  APPROVED_STATUSES,
  BLOCKING_STATUSES,
  OPEN_STATUSES,
  normalizeReviewStatus,
} from "./review-status";
import { parseStoredDate } from "./date";

export interface PortfolioReview {
  department: string;
  status?: string | null;
  prueferName?: string | null;
  pruefDatum?: string | null;
}

export interface PortfolioProject {
  id: number;
  projektnummer?: string | null;
  station?: string | null;
  bahnhofsmanagement?: string | null;
  terminProjektvorstellung?: string | null;
  reviews?: PortfolioReview[] | null;
}

const isOpen = (s: string | null) => s !== null && (OPEN_STATUSES as readonly string[]).includes(s);
const isDone = (s: string | null) => s !== null && (APPROVED_STATUSES as readonly string[]).includes(s);
const isBlocked = (s: string | null) => s !== null && (BLOCKING_STATUSES as readonly string[]).includes(s);

/** Days between an ISO date and a reference day. Negative means still ahead. */
export function daysBetween(iso: string | null, today: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((today - t) / 86_400_000);
}

export interface GewerkStanding {
  department: string;
  /** Rows this Gewerk is actually required on — the honest workload. */
  required: number;
  open: number;
  approved: number;
  blocked: number;
  /** Required rows whose status maps to none of the three lifecycle buckets. */
  other: number;
  /** Required rows carrying no status at all. */
  notRequired: number;
  /** Open rows with nobody's name on them. */
  unassigned: number;
  /** Open rows whose Prüfdatum has already passed. */
  overdue: number;
  /** The oldest still-open row, in days. Null when none has a date. */
  oldestOpenDays: number | null;
  /** Share of required rows that are signed off, 0–100. */
  completion: number;
  /** See the file header: a ranking heuristic with stated weights. */
  riskScore: number;
}

/**
 * Ranking weights, in the open.
 *
 * A blocked check stops work outright; an overdue one has already broken a
 * promised date; an unassigned one has nobody who could move it. Three, two,
 * one. Anyone is free to disagree — which is the point of writing them down
 * instead of burying them in an expression.
 */
export const RISK_WEIGHTS = { blocked: 3, overdue: 2, unassigned: 1 } as const;

export function gewerkStandings(
  projects: readonly PortfolioProject[] | null | undefined,
  departments: readonly string[],
  today: number,
): GewerkStanding[] {
  const out: GewerkStanding[] = [];
  for (const department of departments) {
    let required = 0;
    let open = 0;
    let approved = 0;
    let blocked = 0;
    let other = 0;
    let notRequired = 0;
    let unassigned = 0;
    let overdue = 0;
    let oldestOpenDays: number | null = null;

    for (const project of projects ?? []) {
      const review = (project.reviews ?? []).find((r) => r.department === department);
      if (!review) continue;
      const status = normalizeReviewStatus(review.status);
      if (status === null) continue;
      if (status === "nicht erforderlich") {
        notRequired++;
        continue;
      }
      required++;
      if (isOpen(status)) {
        open++;
        if (!(review.prueferName ?? "").trim()) unassigned++;
        const iso = parseStoredDate(review.pruefDatum ?? null).iso;
        const age = daysBetween(iso, today);
        if (age !== null && age > 0) {
          overdue++;
          if (oldestOpenDays === null || age > oldestOpenDays) oldestOpenDays = age;
        }
      } else if (isDone(status)) approved++;
      else if (isBlocked(status)) blocked++;
      else other++;
    }

    out.push({
      department,
      required,
      open,
      approved,
      blocked,
      other,
      notRequired,
      unassigned,
      overdue,
      oldestOpenDays,
      completion: required > 0 ? Math.round((approved / required) * 100) : 0,
      riskScore:
        blocked * RISK_WEIGHTS.blocked +
        overdue * RISK_WEIGHTS.overdue +
        unassigned * RISK_WEIGHTS.unassigned,
    });
  }
  return out;
}

/** Age buckets for everything still open. The tail is what hurts. */
export const AGE_BUCKETS = [
  { key: "0-30", label: "bis 30 Tage", from: 0, to: 30 },
  { key: "31-90", label: "31–90 Tage", from: 31, to: 90 },
  { key: "91-180", label: "91–180 Tage", from: 91, to: 180 },
  { key: "181-365", label: "181–365 Tage", from: 181, to: 365 },
  { key: "365+", label: "über ein Jahr", from: 366, to: Number.POSITIVE_INFINITY },
] as const;

export interface AgingCohort {
  key: string;
  label: string;
  count: number;
}

export interface Aging {
  cohorts: AgingCohort[];
  /** Open rows with no Prüfdatum at all — they cannot be aged, and are reported. */
  undatedOpen: number;
  medianAgeDays: number | null;
}

export function agingOfOpenReviews(
  projects: readonly PortfolioProject[] | null | undefined,
  today: number,
): Aging {
  const ages: number[] = [];
  let undatedOpen = 0;
  for (const project of projects ?? []) {
    for (const review of project.reviews ?? []) {
      const status = normalizeReviewStatus(review.status);
      if (!isOpen(status)) continue;
      const iso = parseStoredDate(review.pruefDatum ?? null).iso;
      const age = daysBetween(iso, today);
      if (age === null) {
        undatedOpen++;
        continue;
      }
      ages.push(Math.max(age, 0));
    }
  }
  const cohorts = AGE_BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    count: ages.filter((a) => a >= b.from && a <= b.to).length,
  }));
  ages.sort((a, b) => a - b);
  const medianAgeDays =
    ages.length === 0
      ? null
      : ages.length % 2 === 1
        ? (ages[(ages.length - 1) / 2] as number)
        : Math.round((((ages[ages.length / 2 - 1] as number) + (ages[ages.length / 2] as number)) / 2));
  return { cohorts, undatedOpen, medianAgeDays };
}

export interface ReviewerLoad {
  name: string;
  open: number;
  done: number;
  total: number;
}

export interface Concentration {
  reviewers: ReviewerLoad[];
  /** Share of all open work sitting with the busiest five, 0–100. */
  topFiveShareOfOpen: number;
  /** Open rows nobody is named on. */
  unassignedOpen: number;
}

/**
 * Who is carrying the work.
 *
 * The concentration figure is the one that matters: if five people hold most of
 * the open work, the schedule depends on five people's calendars.
 */
export function reviewerConcentration(
  projects: readonly PortfolioProject[] | null | undefined,
): Concentration {
  const map = new Map<string, ReviewerLoad>();
  let unassignedOpen = 0;
  let totalOpen = 0;

  for (const project of projects ?? []) {
    for (const review of project.reviews ?? []) {
      const status = normalizeReviewStatus(review.status);
      if (status === null || status === "nicht erforderlich") continue;
      const name = (review.prueferName ?? "").trim();
      const open = isOpen(status);
      if (open) totalOpen++;
      if (!name) {
        if (open) unassignedOpen++;
        continue;
      }
      const entry = map.get(name) ?? { name, open: 0, done: 0, total: 0 };
      entry.total++;
      if (open) entry.open++;
      else if (isDone(status)) entry.done++;
      map.set(name, entry);
    }
  }

  const reviewers = [...map.values()].sort((a, b) => b.open - a.open || b.total - a.total);
  const topFiveOpen = reviewers.slice(0, 5).reduce((sum, r) => sum + r.open, 0);
  return {
    reviewers,
    topFiveShareOfOpen: totalOpen > 0 ? Math.round((topFiveOpen / totalOpen) * 100) : 0,
    unassignedOpen,
  };
}

export interface DataQuality {
  /** Stored statuses the canonical vocabulary cannot map. */
  unmappedStatus: number;
  /** Open rows with no Prüfer. */
  openWithoutPruefer: number;
  /** Open rows with no Prüfdatum. */
  openWithoutDate: number;
  /** Projects that cannot be placed on the map. */
  withoutStation: number;
  /**
   * A Projektnummer is a programme identifier, not a project identifier.
   *
   * 1,298 projects carry 385 distinct numbers; one of them appears 98 times.
   * That is not a defect to be cleaned up — it is how the workbook is
   * organised — but it decides what a search result means, what a PDF filename
   * identifies, and whether "the project G.011598624" is a sentence anyone can
   * act on. Reported as a fact, never as an error count.
   */
  distinctProjektnummern: number;
  sharedProjektnummern: number;
  projectsSharingANumber: number;
  /** Review rows carrying no status at all — 432 of them are BIM. */
  reviewsWithoutStatus: number;
  /**
   * Canonical statuses that belong to no lifecycle bucket.
   *
   * "Prüfung erfolgt" is a real status on 229 rows and means neither open nor
   * approved nor blocked, so every count built on those three buckets silently
   * omits it. Naming the statuses and their counts is the only honest way to
   * show a total that does not add up.
   */
  unclassifiedStatuses: Array<{ status: string; count: number }>;
  /** Projects with no Projektnummer at all. */
  withoutProjektnummer: number;
  /** Stored dates this build refuses to guess at. */
  unparseableDates: number;
  totalReviews: number;
  totalProjects: number;
}

/**
 * How much of the record can be trusted.
 *
 * Every figure on every other panel rests on these rows. A dashboard that
 * reports confidently on data it has not checked is the more expensive kind of
 * wrong, so the checks are shown rather than assumed.
 */
export function dataQuality(
  projects: readonly PortfolioProject[] | null | undefined,
): DataQuality {
  let unmappedStatus = 0;
  let reviewsWithoutStatus = 0;
  const unclassified = new Map<string, number>();
  let openWithoutPruefer = 0;
  let openWithoutDate = 0;
  let withoutStation = 0;
  let withoutProjektnummer = 0;
  let unparseableDates = 0;
  let totalReviews = 0;

  const numbers = new Map<string, number>();
  const list = projects ?? [];

  for (const project of list) {
    const nummer = (project.projektnummer ?? "").trim();
    if (!nummer) withoutProjektnummer++;
    else numbers.set(nummer, (numbers.get(nummer) ?? 0) + 1);
    if (!(project.station ?? "").trim()) withoutStation++;

    if (project.terminProjektvorstellung) {
      const parsed = parseStoredDate(project.terminProjektvorstellung);
      if (parsed.iso === null && parsed.reason !== "empty" && parsed.reason !== "placeholder") {
        unparseableDates++;
      }
    }

    for (const review of project.reviews ?? []) {
      totalReviews++;
      const raw = (review.status ?? "").trim();
      const status = normalizeReviewStatus(review.status);
      if (!raw) reviewsWithoutStatus++;
      if (raw && status === null) unmappedStatus++;
      if (
        status !== null &&
        status !== "nicht erforderlich" &&
        !isOpen(status) &&
        !isDone(status) &&
        !isBlocked(status)
      ) {
        unclassified.set(status, (unclassified.get(status) ?? 0) + 1);
      }
      if (isOpen(status)) {
        if (!(review.prueferName ?? "").trim()) openWithoutPruefer++;
        if (!parseStoredDate(review.pruefDatum ?? null).iso) openWithoutDate++;
      }
      if (review.pruefDatum) {
        const parsed = parseStoredDate(review.pruefDatum);
        if (parsed.iso === null && parsed.reason !== "empty" && parsed.reason !== "placeholder") {
          unparseableDates++;
        }
      }
    }
  }

  let sharedProjektnummern = 0;
  let projectsSharingANumber = 0;
  for (const count of numbers.values()) {
    if (count > 1) {
      sharedProjektnummern++;
      projectsSharingANumber += count;
    }
  }

  return {
    unmappedStatus,
    reviewsWithoutStatus,
    unclassifiedStatuses: [...unclassified.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    openWithoutPruefer,
    openWithoutDate,
    withoutStation,
    distinctProjektnummern: numbers.size,
    sharedProjektnummern,
    projectsSharingANumber,
    withoutProjektnummer,
    unparseableDates,
    totalReviews,
    totalProjects: list.length,
  };
}
