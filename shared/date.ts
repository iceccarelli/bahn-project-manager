/**
 * shared/date.ts
 * ---------------------------------------------------------------------------
 * Date handling for values that came out of a German Excel workbook.
 *
 * client/public/data.json stores `terminProjektvorstellung` in two formats:
 * 766 rows in ISO `yyyy-mm-dd`, and 253 in German `dd.mm.yyyy`. 18 more hold the
 * literal "-", and 7 hold something that is not a single date at all
 * ("30.12.20025", "01.02.2023/12.9.23", two dates separated by a newline).
 *
 * drizzle/schema.ts types the column `datetime`, so every non-ISO value would be
 * dropped or mis-parsed the moment the data reaches a database. This module is
 * the single place that decides how a stored string becomes a date.
 *
 * The dd.mm reading is not a guess: 147 of the 253 German-format values have a
 * first component greater than 12, which is only valid as a day. No value has a
 * second component greater than 12. The workbook is unambiguously dd.mm.yyyy.
 */

export type DateParseReason =
  | "empty"
  | "iso"
  | "german"
  | "placeholder"
  /** parseable shape but an impossible calendar date, e.g. 31.02.2024 */
  | "invalid-date"
  /** more than one date in one cell, or a shape this module refuses to guess at */
  | "ambiguous"
  | "unrecognised";

export interface ParsedDate {
  /** ISO `yyyy-mm-dd`, or null when the input carries no single usable date */
  iso: string | null;
  reason: DateParseReason;
  /** the cleaned input, so callers can preserve what they could not convert */
  raw: string | null;
}

const PLACEHOLDERS = new Set(["-", "--", "?", "???", "n/a", "na", "null", "offen", "tbd"]);

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;
const GERMAN = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const GERMAN_SHORT = /^(\d{1,2})\.(\d{1,2})\.(\d{2})$/;

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function iso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Parse one stored value. Pure and deterministic — no locale, no Date.parse
 * fallback (which would happily read "01.02.2023" as a US date on some engines).
 */
export function parseStoredDate(input: unknown): ParsedDate {
  if (input == null) return { iso: null, reason: "empty", raw: null };

  const cleaned = String(input).replace(/\s+/g, " ").trim();
  if (cleaned === "") return { iso: null, reason: "empty", raw: null };
  if (PLACEHOLDERS.has(cleaned.toLowerCase())) {
    return { iso: null, reason: "placeholder", raw: cleaned };
  }

  // more than one date in a single cell — refuse rather than pick one
  const dateLike = cleaned.match(/\d{1,4}[.\-/]\d{1,2}[.\-/]\d{2,5}/g) ?? [];
  if (dateLike.length > 1) return { iso: null, reason: "ambiguous", raw: cleaned };

  const isoMatch = ISO.exec(cleaned);
  if (isoMatch) {
    const [, y, m, d] = isoMatch as unknown as [string, string, string, string];
    const yy = Number(y);
    const mm = Number(m);
    const dd = Number(d);
    if (!isRealDate(yy, mm, dd)) return { iso: null, reason: "invalid-date", raw: cleaned };
    return { iso: iso(yy, mm, dd), reason: "iso", raw: cleaned };
  }

  const de = GERMAN.exec(cleaned);
  if (de) {
    const [, d, m, y] = de as unknown as [string, string, string, string];
    const yy = Number(y);
    const mm = Number(m);
    const dd = Number(d);
    if (!isRealDate(yy, mm, dd)) return { iso: null, reason: "invalid-date", raw: cleaned };
    return { iso: iso(yy, mm, dd), reason: "german", raw: cleaned };
  }

  // dd.mm.yy — the workbook does not currently contain any, so it is treated as
  // ambiguous rather than expanded with a century guess.
  if (GERMAN_SHORT.test(cleaned)) return { iso: null, reason: "ambiguous", raw: cleaned };

  return { iso: null, reason: "unrecognised", raw: cleaned };
}

/**
 * Convert a stored value into a Date for a `datetime` column, or null.
 *
 * This is the ONLY place a stored date string should become a Date. `new
 * Date("21.03.2023")` yields Invalid Date, which MySQL rejects or silently
 * stores as null — and 253 of the dated rows are in exactly that format.
 */
export function toDate(input: unknown): Date | null {
  const parsed = parseStoredDate(input);
  return parsed.iso ? new Date(`${parsed.iso}T00:00:00.000Z`) : null;
}

/** Format an ISO date for display, German style. Returns the input unchanged if not ISO. */
export function formatGerman(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  const m = ISO.exec(isoDate);
  if (!m) return String(isoDate);
  return `${m[3]}.${m[2]}.${m[1]}`;
}
