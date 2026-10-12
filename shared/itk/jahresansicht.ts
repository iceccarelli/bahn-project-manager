/**
 * Jahresansicht — the ITK Prüfungen of the Gewerk, by year.
 *
 * Source of the idea: the Projektübersicht ITK platform replaced a workbook with
 * one tab per year (2017–2026) and a dashboard over it: Prüfungen per year, how
 * many are closed, who the busiest Projektleiter (PL) and Fachspezialisten (FS)
 * are. This is that view over the data the app already has — the ITK
 * Prüfzeile of every Project — so there is no second record of an ITK Prüfung
 * to keep in step with the first.
 *
 * Mapping, and what it deliberately does not claim
 * ------------------------------------------------
 *   Jahr          year of the ITK Prüfdatum (the date the Übersicht prints as
 *                 "Prüfdatum"); a row with no usable date is its own bucket, it
 *                 is not guessed into a year
 *   PL            Project.projektleiter
 *   FS            the ITK review's Prüfer
 *   Status        the review's normalised status, counted with the SAME
 *                 deriveProjectMetrics the Übersicht KPI row uses, so the "alle
 *                 Jahre" bucket equals the Übersicht's numbers to the unit
 * Technik, Tätigkeitsbereich and the PDF-Code live on the platform's
 * Prüfbericht record, which this app does not hold yet; nothing here derives
 * them (the project descriptions name a Technik on 0 of the 510 ITK rows).
 *
 * Pure: the demo build runs it over the browser's rows, the server build runs it
 * over the caller's authorized rows (`dashboard.itkYears`) and ships the result.
 */

import { parseStoredDate } from "../date";
import { deriveProjectMetrics, type ProjectMetrics } from "../project-metrics";
import type { PortfolioProject } from "../portfolio-metrics";
import { isApproved, normalizeReviewStatus } from "../review-status";
import { STATUS_TONE, type StatusTone } from "../status-appearance";

export const ITK_DEPARTMENT = "ITK";

/** Bucket key meaning "the ITK Prüfzeile has no usable date". */
export const NO_YEAR = null;

export interface RankRow {
  name: string;
  /** ITK Prüfungen of this person in the bucket. */
  count: number;
  /** Of those, how many are signed off (Zustimmung erteilt / Niederschrift erstellt). */
  approved: number;
}

export interface YearBucket {
  /** null = Prüfzeilen without a usable Prüfdatum. */
  year: number | null;
  metrics: ProjectMetrics;
  /** Rows per status tone, for the stacked bar; `none` = status that maps onto no canonical status. */
  tones: Partial<Record<StatusTone | "none", number>>;
  projektleitung: RankRow[];
  pruefer: RankRow[];
}

export interface ItkYearsView {
  /** Epoch ms the figures were computed for. */
  asOf: number;
  /** One bucket per year with data, ascending; the undated bucket, if any, last. */
  years: YearBucket[];
  /** Every ITK Prüfzeile, whatever its year. Equals the Übersicht's KPI figures. */
  all: YearBucket;
}

/** Rows shown per ranking; the long tail is one click away in the Übersicht. */
export const RANK_LIMIT = 8;

interface Entry {
  year: number | null;
  status: string | null;
  pl: string;
  fs: string;
}

/** The same "no Prüfer yet" placeholder the filters, the read models and the contact resolution treat as empty. */
const NO_PRUEFER = new Set(["", "Zuordnung erforderlich"]);

const clean = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
const person = (v: string | null | undefined) => {
  const c = clean(v);
  return NO_PRUEFER.has(c) ? "" : c;
};

function yearOf(pruefDatum: string | null | undefined): number | null {
  const iso = parseStoredDate(pruefDatum).iso;
  return iso ? Number(iso.slice(0, 4)) : null;
}

function rank(rows: readonly Entry[], pick: (e: Entry) => string): RankRow[] {
  const by = new Map<string, RankRow>();
  for (const e of rows) {
    const name = pick(e);
    if (!name) continue;
    const row = by.get(name) ?? { name, count: 0, approved: 0 };
    row.count += 1;
    if (isApproved(e.status)) row.approved += 1;
    by.set(name, row);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "de")).slice(0, RANK_LIMIT);
}

function bucket(year: number | null, rows: readonly Entry[]): YearBucket {
  const tones: YearBucket["tones"] = {};
  for (const e of rows) {
    const n = normalizeReviewStatus(e.status);
    const key = n ? STATUS_TONE[n] : "none";
    tones[key] = (tones[key] ?? 0) + 1;
  }
  return {
    year,
    // The Übersicht's own call: one project per ITK Prüfzeile.
    metrics: deriveProjectMetrics(rows.map((e) => ({ reviews: [{ status: e.status }] }))),
    tones,
    projektleitung: rank(rows, (e) => e.pl),
    pruefer: rank(rows, (e) => e.fs),
  };
}

export function buildItkYears(projects: readonly PortfolioProject[], asOf: number = Date.now()): ItkYearsView {
  const entries: Entry[] = [];
  for (const p of projects) {
    const review = (p.reviews ?? []).find((r) => r.department === ITK_DEPARTMENT);
    if (!review) continue;
    // The Übersicht's scope: an ITK Prüfzeile whose status is not "nicht erforderlich".
    if (normalizeReviewStatus(review.status) === "nicht erforderlich") continue;
    entries.push({ year: yearOf(review.pruefDatum), status: review.status ?? null, pl: person(p.projektleiter), fs: person(review.prueferName) });
  }

  const years = [...new Set(entries.map((e) => e.year))].sort((a, b) => (a === null ? 1 : b === null ? -1 : a - b));
  return {
    asOf,
    years: years.map((y) => bucket(y, entries.filter((e) => e.year === y))),
    all: bucket(null, entries),
  };
}
