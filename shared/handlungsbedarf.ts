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
import { STATUS_TONE, TONE_APPEARANCE, type StatusTone } from "./status-appearance";

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

/**
 * One station's projects, addressed by the exact ids the map counted.
 *
 * Not `?q=<Stationsname>`: the map groups by resolved station geometry, which
 * folds "Frankfurt (Main) Süd" together with the rows that only carry a
 * Bahnhofsmanagement and were placed on a regional centroid. A text search for
 * the name finds a different set — usually a smaller one — and a marker that
 * says "12 Projekte" landing on 9 is the same class of defect as a badge that
 * counts one thing and links to another.
 *
 * The ids travel in the URL so the result set is linkable and survives a
 * reload. Station groups are small (the largest in the shipped data holds 12),
 * so this stays a short address rather than a query string with 1,298 numbers
 * in it.
 */
export function stationHref(station: { name: string; projectIds: readonly number[] }): string {
  const ids = station.projectIds.filter((id) => Number.isInteger(id) && id > 0).join(",");
  return `/projects?view=cards&station=${encodeURIComponent(station.name)}&projekte=${ids}`;
}


/* ---------------------------------------------------------------------------
   Slices of the status pie
   ---------------------------------------------------------------------------
   The Dashboard's donut groups Prüfzeilen by tone — the eight bands the legend
   names, not the twelve statuses. Making a slice clickable raises the same
   question the Handlungsbedarf badges did: a slice that says 946 has to land
   on a page showing exactly the set behind those 946, or the link is a
   decoration that quietly lies.

   So the predicate lives here too, beside the other one, and both sides call
   it. A tone is a set of statuses; a project belongs to the filtered set when
   any of its rows carries a status of that tone.
   --------------------------------------------------------------------------- */

/**
 * Does this row's status fall in this tone band?
 *
 * `department` narrows it to one Gewerk, and the narrowing has to happen HERE
 * rather than by intersecting two filters. „Projekte mit einer offenen Zeile
 * und einer EEA-Zeile" is a different and much larger set than „Projekte mit
 * einer offenen EEA-Zeile" — the first is what two independent filters give
 * you, and it is not what a slice inside „Status-Verteilung für EEA" is
 * counting.
 */
export function reviewMatchesTone(
  review: PortfolioReview,
  tone: StatusTone,
  department?: string,
): boolean {
  if (department !== undefined && review.department !== department) return false;
  const status = normalizeReviewStatus(review.status);
  if (status === null) return false;
  return STATUS_TONE[status] === tone;
}

/** A project belongs in the filtered set when any of its rows does. */
export function projectMatchesTone(
  project: PortfolioProject,
  tone: StatusTone,
  department?: string,
): boolean {
  for (const review of project.reviews ?? []) {
    if (reviewMatchesTone(review, tone, department)) return true;
  }
  return false;
}

export interface ToneCount {
  tone: StatusTone;
  label: string;
  hex: string;
  /** Prüfzeilen — what the slice is sized by. */
  rows: number;
  /** Distinct projects those rows sit in — what a list can show. */
  projects: number;
}

/**
 * Every tone present in the data, largest first, with both figures.
 *
 * `department` scopes it to one Gewerk — the same argument the predicate takes,
 * so the number on a slice and the set its link produces are computed by one
 * function with one meaning.
 */
export function countTones(
  projects: readonly PortfolioProject[],
  department?: string,
): ToneCount[] {
  const rows = new Map<StatusTone, number>();
  const hit = new Map<StatusTone, Set<number>>();
  for (const project of projects) {
    for (const review of project.reviews ?? []) {
      if (department !== undefined && review.department !== department) continue;
      const status = normalizeReviewStatus(review.status);
      if (status === null) continue;
      const tone = STATUS_TONE[status];
      rows.set(tone, (rows.get(tone) ?? 0) + 1);
      if (!hit.has(tone)) hit.set(tone, new Set());
      hit.get(tone)?.add(project.id);
    }
  }
  return [...rows.entries()]
    .map(([tone, count]) => ({
      tone,
      label: TONE_APPEARANCE[tone].label,
      hex: TONE_APPEARANCE[tone].hex,
      rows: count,
      projects: hit.get(tone)?.size ?? 0,
    }))
    .sort((a, b) => b.rows - a.rows);
}

/** The tones that mean "still waiting for a decision" — these get highlighted. */
export function toneIsAwaiting(tone: StatusTone): boolean {
  return OPEN_TONES.includes(tone);
}

/*
 * Derived from OPEN_STATUSES, never listed by hand.
 *
 * „offen", „in Bearbeitung", „Nachforderung" and „prüffähig" span four
 * different tones, and writing those four tone names into a constant here
 * would be a second definition of "open" — the exact drift this module was
 * created to stop. Mapping the statuses through the tone table means adding a
 * status to OPEN_STATUSES lights up its band automatically.
 */
const OPEN_TONES: readonly StatusTone[] = [
  ...new Set(OPEN_STATUSES.map((status) => STATUS_TONE[status])),
];

/**
 * Where a slice sends the reader. Same shape as `bedarfHref`, same contract.
 *
 * With a Gewerk it goes to that Gewerk's own surface — BVB-EEA and PSV-ITK
 * have their own tabs, everything else is Projekte narrowed to the department.
 * Without one it is the whole portfolio. A slice inside „Status-Verteilung für
 * EEA" that landed on every project with an open row anywhere would be a link
 * that looks right and is wrong by a factor of four.
 */
export function toneHref(tone: StatusTone, department?: string): string {
  const t = encodeURIComponent(tone);
  if (!department) return `/projects?tone=${t}&view=cards`;
  if (department === "EEA") return `/bvb-eea?tone=${t}`;
  if (department === "ITK") return `/psv-itk?tone=${t}`;
  return `/projects?tone=${t}&gewerk=${encodeURIComponent(department)}&view=cards`;
}

/** Reject anything that did not come from us — a hand-typed ?tone= shows all. */
export function toneFor(value: string | null | undefined): StatusTone | null {
  if (!value) return null;
  const known = new Set<string>(Object.values(STATUS_TONE));
  return known.has(value) ? (value as StatusTone) : null;
}

/* ---------------------------------------------------------------------------
   The part of the portfolio that is actually work
   ---------------------------------------------------------------------------
   `countTones` counts every row with a recognised status, which is the honest
   primitive and the wrong chart.

   Measured on BIM: 866 rows, of which 741 are „nicht erforderlich". The donut
   was 86 % one grey band meaning „this department is not involved", and it
   printed „866 Prüfungen in BIM" directly beside a card reading „125 Prüfungen
   erforderlich". Both numbers were true and they contradicted each other on
   one screen, which is the exact drift this project exists to remove.

   Every other surface — the Gewerke cards, the relief, the Gewerk tabs, Ask
   Bahn — defines the workload as the required rows: 814 EEA, 510 ITK, 125 BIM.
   The donuts now do too, and they state what they left out rather than
   silently dropping it.
   --------------------------------------------------------------------------- */

export interface RequiredTones {
  /** The bands that represent work, largest first. */
  slices: ToneCount[];
  /** Prüfzeilen in those bands — matches `required` in portfolio-metrics. */
  required: number;
  /** Rows excluded because the department is not involved. Always stated. */
  notRequired: number;
}

/**
 * The tone bands worth charting, and an honest account of what was dropped.
 *
 * "neutral" is exactly one status — „nicht erforderlich" — so this drops a
 * category, never a judgement about which rows matter.
 */
export function requiredTones(
  projects: readonly PortfolioProject[],
  department?: string,
): RequiredTones {
  const all = countTones(projects, department);
  const slices = all.filter((t) => t.tone !== "neutral");
  return {
    slices,
    required: slices.reduce((n, t) => n + t.rows, 0),
    notRequired: all.find((t) => t.tone === "neutral")?.rows ?? 0,
  };
}
