/**
 * Vocabularies of the ITK Prüfbericht — taken from the workbook's own dropdown sheet ("Tabelle3"), not from the
 * platform's README (whose ten-value Technik list is not what the Prüfstelle uses).
 *
 * Open on purpose where the workbook is open: a value these lists do not know is *stored as found* and *reported* by
 * the importer — never rewritten, never rejected. A migration that "corrects" the source on the way in has made a
 * second truth. "-" is the dropdown's "keine Angabe" and is treated as no value.
 */
import type { StatusTone } from "../status-appearance";

/** The value the workbook's dropdowns use for "nothing / not applicable". */
export const NO_VALUE = "-";

/**
 * "Bauform / Bezeichnung der Anlage" — the Technik of an installation. (The sheet's column headed just "Technik"
 * holds the product or a note: "Axis", "DVS 21", "Nicht Prüfen!"; see technikArtOf.)
 */
export const TECHNIK_ARTEN = [
  "ELA AN1", "ELA AN2", "SAA", "AZ", "FIA", "ZIM", "DSA", "DSA+", "ZHS", "Video", "WLAN", "Uhr", "ETA", "3SZ", "FQM",
  "dBOS", "GSM-R", "EMA", "BMA", "EMA/BMA", "MAS90", "Korridor Projekt", "ZIM/ELA", "ZKB", "Info",
] as const;
export type TechnikArt = (typeof TECHNIK_ARTEN)[number];

/** Codes the 2018–2019 sheets use for the Technik column before the dropdown list existed ("ELA" where the list now says ELA AN1/AN2). */
export const LEGACY_TECHNIK_CODES = ["ELA", "ENS"] as const;

/** A Technik the workbook's own lists know (current dropdown, or one of the legacy codes). */
export function isTechnikArt(value: unknown): boolean {
  return typeof value === "string" && ((TECHNIK_ARTEN as readonly string[]).includes(value) || (LEGACY_TECHNIK_CODES as readonly string[]).includes(value));
}

/** "Leistungsstand" / ausgeübter Tätigkeitsbereich. */
export const TAETIGKEITSBEREICHE = [
  "fachtechnische Prüfung VEP", "fachtechnische Prüfung EP", "fachtechnische Prüfung AP", "fachtechnische Prüfung vor Ibn",
  "Stellungnahme", "Planprüfung", "Abnahmeprüfung", "Gutachten",
] as const;

export const ART_DER_BAUMASSNAHME = ["Neubau", "Umbau", "Instandhaltung", "Umrüstung"] as const;

/** Tätigkeitsbereiche the PDF-Code formula distinguishes (all others get the "P" prefix). */
export const TAETIGKEIT_GUTACHTEN = "Gutachten";
export const TAETIGKEIT_STELLUNGNAHME = "Stellungnahme";
export const TAETIGKEITEN_ABNAHME = ["Abnahmeprüfung", "fachtechnische Prüfung vor Ibn"] as const;

/**
 * "abgeschlossen" as the dropdown offers it. Colours follow the platform's manual (green / green / red / yellow),
 * expressed as this app's tones so a chip means the same on every page; the label shown is always the stored value.
 */
export const ABGESCHLOSSEN_VALUES = ["Ja", "Ja (m.A.)", "Nein", "in Bearbeitung"] as const;
export type Abgeschlossen = (typeof ABGESCHLOSSEN_VALUES)[number];

export const ABGESCHLOSSEN_TONE: Record<Abgeschlossen, StatusTone> = {
  Ja: "done",
  "Ja (m.A.)": "done",
  Nein: "blocked",
  "in Bearbeitung": "pending",
};

export function isAbgeschlossen(value: unknown): value is Abgeschlossen {
  return typeof value === "string" && (ABGESCHLOSSEN_VALUES as readonly string[]).includes(value);
}

/**
 * The dropdown value a stored cell means: case and surrounding space do not matter ("ja" in the 2018 sheet is "Ja"),
 * "-" and blank mean no value, anything else is not a dropdown value (null) — the stored text is never changed.
 */
export function normalizeAbgeschlossen(value: string | null | undefined): Abgeschlossen | null {
  const v = (value ?? "").trim().toLowerCase();
  return ABGESCHLOSSEN_VALUES.find((a) => a.toLowerCase() === v) ?? null;
}

/**
 * The Technik of a Prüfbericht, from the column that holds it in its layout:
 *   2020+      "Bauform / Bezeichnung der Anlage"  (the column headed "Technik" is the product, a free text)
 *   2018–2019  "Technik"
 *   2017       none (the sheet has a project name only)
 * "-" is no Technik. Derived from stated columns by one rule and recomputed on every import; the columns themselves
 * are stored as found.
 */
export function technikArtOf(r: { layout: "2020+" | "2018-2019" | "2017"; technik: string | null; bauformBezeichnung: string | null }): string | null {
  const v = r.layout === "2020+" ? r.bauformBezeichnung : r.layout === "2018-2019" ? r.technik : null;
  return v === null || v.trim() === "" || v.trim() === NO_VALUE ? null : v.trim();
}
