/**
 * The latest entries for one Gewerk, for the card that plays them.
 *
 * ---------------------------------------------------------------------------
 * Two sources, because one of them is often empty
 * ---------------------------------------------------------------------------
 * The obvious source is the Änderungshistorie. It is also the wrong one on its
 * own: the trail lives in the reader's own browser, so on a fresh machine — or
 * the first morning of the week — it holds nothing at all, and a card that
 * plays "keine Einträge" fourteen times is a feature that works only for
 * people who have already been working.
 *
 * So a reel is the session's changes for that Gewerk, newest first, followed
 * by the most recently dated Prüfzeilen the department actually has on file.
 * Both are real records; neither is invented; each entry says which it is, so
 * "somebody changed this ten minutes ago" is never mistaken for "this review
 * is dated last April".
 */

import { normalizeReviewStatus } from "./review-status";
import { toDate } from "./date";
import type { PortfolioProject } from "./portfolio-metrics";
import type { StatusTone } from "./status-appearance";
import { STATUS_TONE } from "./status-appearance";

export interface ReelEntry {
  /** Stable across renders, so a cross-fade can key on it. */
  id: string;
  /** ISO day or timestamp — whichever the source carries. */
  when: string;
  /** German date, ready to print. */
  whenLabel: string;
  /** What happened, in the words of the record. */
  what: string;
  /** Which project or station it happened to. */
  where: string;
  /** Colours the entry the same way every other status surface is coloured. */
  tone: StatusTone | null;
  source: "historie" | "bestand";
}

export interface ReelAuditEntry {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  details: string;
  meta?: { projektnummer?: string | null; station?: string | null; department?: string | null } | null;
}

const german = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
};

/**
 * Newest first, session changes before stored dates.
 *
 * `limit` is small on purpose: this plays one entry at a time on a card the
 * size of a playing card, and a reel nobody reaches the end of is a list.
 */
export function buildReel(
  projects: readonly PortfolioProject[],
  audit: readonly ReelAuditEntry[],
  department: string,
  limit = 6,
): ReelEntry[] {
  const out: ReelEntry[] = [];

  for (const entry of audit) {
    if (entry.meta?.department !== department) continue;
    out.push({
      id: `h-${entry.id}`,
      when: entry.timestamp,
      whenLabel: german(entry.timestamp),
      what: `${entry.user}: ${entry.action}`,
      where: entry.meta?.projektnummer || entry.meta?.station || entry.details || "—",
      tone: null,
      source: "historie",
    });
    if (out.length >= limit) return out;
  }

  /*
   * The stored rows, most recently dated first.
   *
   * Only rows that carry a readable Prüfdatum: an undated row has no place in
   * a list ordered by date, and putting it at one end or the other would be
   * inventing a position for it. 388 open rows across the portfolio are
   * undated, and the Dashboard's diagnostics say so separately.
   */
  const dated: Array<{ time: number; entry: ReelEntry }> = [];
  for (const project of projects) {
    for (const review of project.reviews ?? []) {
      if (review.department !== department) continue;
      const status = normalizeReviewStatus(review.status);
      if (status === null || status === "nicht erforderlich") continue;
      const date = toDate(review.pruefDatum ?? null);
      if (date === null) continue;
      dated.push({
        time: date.getTime(),
        entry: {
          id: `b-${project.id}-${department}`,
          when: date.toISOString(),
          whenLabel: german(date.toISOString()),
          what: status,
          where: project.station || project.projektnummer || `Projekt ${project.id}`,
          tone: STATUS_TONE[status] ?? null,
          source: "bestand",
        },
      });
    }
  }
  dated.sort((a, b) => b.time - a.time);
  for (const d of dated) {
    out.push(d.entry);
    if (out.length >= limit) break;
  }
  return out;
}
