/**
 * Vocabularies of the ITK Prüfbericht (the record of the Projektübersicht ITK
 * platform; see docs/itk-platform.md).
 *
 * Open on purpose where the workbook is open: a Technik or Tätigkeitsbereich the
 * lists below do not know is *stored as found* and *reported* by the importer —
 * never rewritten, never rejected. A migration that "corrects" the source on the
 * way in has made a second truth.
 */
import type { StatusTone } from "../status-appearance";

/** Technik Kürzel used by the Prüfstelle. The Abnahme's `Technik` is the subset that has a checklist. */
export const ITK_TECHNIKEN = ["ELA", "Video", "WLAN", "ZIM", "DSA+", "SAA", "dBOS", "FQM", "3SZ", "BÜ"] as const;
export type ItkTechnik = (typeof ITK_TECHNIKEN)[number];

export function isItkTechnik(value: unknown): value is ItkTechnik {
  return typeof value === "string" && (ITK_TECHNIKEN as readonly string[]).includes(value);
}

/**
 * "abgeschlossen" as the workbook writes it. Colours follow the platform's manual
 * (green / green / red / yellow), expressed as this app's tones so a chip means the
 * same on every page; the *label shown* is always the stored value.
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

/** Tätigkeitsbereiche the PDF-Code formula distinguishes (all others get the "P" prefix). */
export const TAETIGKEIT_GUTACHTEN = "Gutachten";
export const TAETIGKEIT_STELLUNGNAHME = "Stellungnahme";
export const TAETIGKEITEN_ABNAHME = ["Abnahmeprüfung", "fachtechnische Prüfung vor Ibn"] as const;
