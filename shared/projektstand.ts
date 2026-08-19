/**
 * shared/projektstand.ts
 * ---------------------------------------------------------------------------
 * Projektstand — the project's phase.
 *
 * Authority: `Hilfsdatei!N3:N12` of the Projektanmeldung workbook (the dropdown
 * behind `Formular!D9`), plus "Projektkonfiguration", which
 * `Formular_2.PKonfiguration` writes into D9 directly.
 *
 * Three incompatible lists existed before this file:
 *   - PROJEKTSTAND_OPTIONS (client/src/hooks/useStations.ts) — 7 values, but
 *     collapses Mieterumbau MAG/iAG into one and invents "EIGV"
 *   - PROJECT_STANDS (shared/validation.ts) — 18 values including data-entry
 *     debris such as "doppelt siehe Zeile 197" and "FA - Stand Spalte AJ"
 *   - client/public/data.json — 81 distinct values in the wild
 *
 * The historical values are NOT rewritten. `projektstand` stays free text in
 * storage, because a value like "Plausibilitätsprüfung gBSK" carries real
 * meaning that no enum here could hold. What this module provides is a
 * canonical vocabulary for NEW input (the Stage 3 wizard) and a normaliser that
 * maps a historical value onto it where that is unambiguous, so filters and
 * statistics can group without destroying the source.
 */

/** The canonical phases. `Hilfsdatei!N3:N12` in sheet order, plus Projektkonfiguration. */
export const PROJEKTSTAENDE = [
  "VEP",
  "EP",
  "AP",
  "Projektkonfiguration",
  "Mieterumbau MAG",
  "Mieterumbau iAG",
  "CSM-RA",
  "Sonstiges",
] as const;

export type Projektstand = (typeof PROJEKTSTAENDE)[number];

/** Values the workbook writes when nothing has been chosen. */
const PLACEHOLDER_SOURCE = ["", "-", "?", "???", "n/a", "na", "null", "bitte auswählen", "bitte auswaehlen"];

/**
 * Aliases → canonical. Keys are fold()-ed, so casing, punctuation and umlaut
 * spelling need not be enumerated. Every entry is a value observed in
 * client/public/data.json.
 */
const ALIASES: Record<string, Projektstand> = {
  "projektkonfig.": "Projektkonfiguration",
  projektkonfig: "Projektkonfiguration",
  "p konfiguration": "Projektkonfiguration",
  "mieterumbau mag": "Mieterumbau MAG",
  "mieterumbau iag": "Mieterumbau iAG",
  mag: "Mieterumbau MAG",
  iag: "Mieterumbau iAG",
  "csm ra": "CSM-RA",
  csmra: "CSM-RA",
  sonstige: "Sonstiges",
  sonstiges: "Sonstiges",
};

function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ß/g, "ss")
    .replace(/[-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PLACEHOLDERS = new Set(PLACEHOLDER_SOURCE.map(fold));
const CANONICAL_BY_FOLD = new Map<string, Projektstand>(PROJEKTSTAENDE.map((p) => [fold(p), p]));
const ALIAS_BY_FOLD = new Map<string, Projektstand>(
  Object.entries(ALIASES).map(([k, v]) => [fold(k), v]),
);

export interface ProjektstandNormalization {
  /** the canonical phase, or null when the value is a placeholder or not mappable */
  canonical: Projektstand | null;
  /** the cleaned original — ALWAYS what should be stored */
  raw: string | null;
  /** set when `raw` is non-null but could not be mapped to a canonical phase */
  unmapped: string | null;
}

/**
 * Pure, deterministic. Never guesses: "Mieterumbau" without MAG/iAG stays
 * unmapped rather than being assigned to one of them, and free-text phases such
 * as "Plausibilitätsprüfung gBSK" are preserved in `raw` with `canonical: null`.
 */
export function normalizeProjektstand(input: unknown): ProjektstandNormalization {
  if (input == null) return { canonical: null, raw: null, unmapped: null };

  const cleaned = String(input).replace(/\s+/g, " ").trim();
  const key = fold(cleaned);
  if (PLACEHOLDERS.has(key)) return { canonical: null, raw: null, unmapped: null };

  const direct = CANONICAL_BY_FOLD.get(key);
  if (direct) return { canonical: direct, raw: cleaned, unmapped: null };

  const alias = ALIAS_BY_FOLD.get(key);
  if (alias) return { canonical: alias, raw: cleaned, unmapped: null };

  return { canonical: null, raw: cleaned, unmapped: cleaned };
}

/** Convenience for hot paths that only need the canonical value. */
export function toCanonicalProjektstand(input: unknown): Projektstand | null {
  return normalizeProjektstand(input).canonical;
}
