/**
 * Bahnhofsmanagement (BM) — the ONE canonical vocabulary.
 *
 * Authority: `Hilfsdatei!N17:N25` of
 * "Projektanmeldung Fachspezialistenprüfung_neu.xlsm" — the dropdown that the
 * live RB-Mitte Projektanmeldung form writes into `Formular!G9`, and the values
 * its VBA compares against literally (`If Range("G9") = "Frankfurt" Then …`).
 *
 * This is deliberately the *form's* vocabulary and not the station master's:
 * `Bahnhöfe-2026-06-16.xlsx` spells Frankfurt "Frankfurt a. M.", while the form
 * and all 330 existing Frankfurt projects in data.json spell it "Frankfurt".
 * Normalising the station file toward the form is the only direction that does
 * not orphan existing projects from their own region filter.
 *
 * Used by: scripts/generate-stations-master.ts, scripts/normalize-existing-data.ts,
 * client/src/_core/api/client.ts, client/src/hooks/useStations.ts.
 */

/** The 9 canonical BM values. Order is the form's order (alphabetical + "übergreifend" last). */
export const BAHNHOFSMANAGEMENT = [
  "Darmstadt",
  "Frankfurt",
  "Gießen",
  "Kaiserslautern",
  "Kassel",
  "Koblenz",
  "Mainz",
  "Saarbrücken",
  "übergreifend",
] as const;

export type Bahnhofsmanagement = (typeof BAHNHOFSMANAGEMENT)[number];

/**
 * The 8 BM values that own stations. "übergreifend" is a valid *project* BM
 * (cross-regional work) but never a *station* BM, so it is excluded from the
 * station cascade and from the map's region centroids.
 */
export const STATION_BAHNHOFSMANAGEMENT = BAHNHOFSMANAGEMENT.filter(
  (bm) => bm !== "übergreifend",
) as readonly Bahnhofsmanagement[];

/** Values that mean "no answer". Matched case-insensitively after whitespace collapse. */
const PLACEHOLDER_SOURCE = ["", "-", "???", "?", "n/a", "na", "null", "none", "bitte auswählen", "bitte auswaehlen", "keine angabe"];

/**
 * Explicit aliases → canonical. Keys are fold()-ed, so casing, umlaut spelling
 * and internal whitespace do not need to be enumerated. Every entry here is a
 * value actually observed in client/public/data.json or in the station master.
 */
const ALIASES: Record<string, Bahnhofsmanagement> = {
  // station master spelling
  "frankfurt a m": "Frankfurt",
  "frankfurt am main": "Frankfurt",
  "frankfurt main": "Frankfurt",
  "frankfurt a.m.": "Frankfurt",
  "ffm": "Frankfurt",
  // observed typos in data.json
  "saabrucken": "Saarbrücken",
  "saarbruecken": "Saarbrücken",
  "giessen": "Gießen",
  // cross-regional
  "uebergreifend": "übergreifend",
  "ubergreifend": "übergreifend",
  "rb mitte": "übergreifend",
};

/** Case/accent/whitespace-insensitive key. Deliberately NOT exported: comparison only. */
function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ß/g, "ss")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** All lookup tables are keyed by fold(), so casing/accents/punctuation never need enumerating. */
const PLACEHOLDERS = new Set(PLACEHOLDER_SOURCE.map(fold));

const CANONICAL_BY_FOLD = new Map<string, Bahnhofsmanagement>(
  BAHNHOFSMANAGEMENT.map((bm) => [fold(bm), bm]),
);

const ALIAS_BY_FOLD = new Map<string, Bahnhofsmanagement>(
  Object.entries(ALIASES).map(([k, v]) => [fold(k), v]),
);

export interface BmNormalizationResult {
  /** canonical value, or null for placeholders / empty input */
  value: Bahnhofsmanagement | null;
  /**
   * Set to the cleaned input when it could not be resolved to a canonical
   * value. `value` stays null in that case — callers fail loudly instead of
   * silently inventing a region.
   */
  unmapped: string | null;
  /** true when the input differed from the returned canonical value */
  changed: boolean;
}

/**
 * Deterministic BM normalisation. Pure function — same input always yields the
 * same output, with no fuzzy matching and no locale dependency.
 *
 * Resolution order:
 *   1. null / placeholder            → null
 *   2. exact canonical (fold-equal)  → canonical
 *   3. explicit alias                → canonical
 *   4. "<BM> LOS <n>" lot suffix     → canonical of "<BM>"
 *   5. otherwise                     → null + unmapped (never a guess)
 */
export function normalizeBahnhofsmanagement(raw: unknown): BmNormalizationResult {
  if (raw == null) return { value: null, unmapped: null, changed: false };

  const cleaned = String(raw).replace(/\s+/g, " ").trim();
  const key = fold(cleaned);

  if (PLACEHOLDERS.has(key)) {
    return { value: null, unmapped: null, changed: cleaned !== "" };
  }

  const direct = CANONICAL_BY_FOLD.get(key);
  if (direct) return { value: direct, unmapped: null, changed: direct !== cleaned };

  const alias = ALIAS_BY_FOLD.get(key);
  if (alias) return { value: alias, unmapped: null, changed: true };

  // "Darmstadt LOS 1", "Koblenz LOS 2/3/4" — procurement lots, not regions.
  const lot = /^(.+?)\s+los\s*\d+$/.exec(key);
  const lotBase = lot?.[1];
  if (lotBase) {
    const base = CANONICAL_BY_FOLD.get(lotBase) ?? ALIAS_BY_FOLD.get(lotBase);
    if (base) return { value: base, unmapped: null, changed: true };
  }

  return { value: null, unmapped: cleaned, changed: true };
}

/** Convenience wrapper for hot paths that only need the value. */
export function toCanonicalBm(raw: unknown): Bahnhofsmanagement | null {
  return normalizeBahnhofsmanagement(raw).value;
}
