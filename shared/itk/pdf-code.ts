/**
 * The Prüfbericht's PDF-Code ("Beschriftung") — the label printed on the report.
 *
 * Replicates the workbook formula, as implemented by the platform's
 * `services/pdf_code.py` (whose docstring quotes the Excel):
 *
 *   =IF(ISBLANK(D),"",CONCATENATE(
 *       IF(D="Gutachten","G",
 *       IF(D="Stellungnahme","S",
 *       IF(OR(D="Abnahmeprüfung",D="fachtechnische Prüfung vor Ibn"),"A","P"))),
 *       B," - ",G))
 *
 * D = Tätigkeitsbereich, B = laufende Nummer, G = Bahnhof/Strecke, so
 * "P25.001 - Frankfurt Hbf". The platform's README documents a different shape
 * (`PB_[Technik]_[Bahnhof]_[Nummer]_[Jahr]`) that its code never produces; the
 * workbook is the source of truth, and `pnpm itk:inspect` compares this function
 * with the codes actually stored in a workbook so the choice is a measurement.
 *
 * Derived, never stored as a second copy: the Prüfbericht keeps the workbook's
 * value (`beschriftung`) only to be compared against this.
 */
import { TAETIGKEIT_GUTACHTEN, TAETIGKEIT_STELLUNGNAHME, TAETIGKEITEN_ABNAHME } from "./vocab";

export type PdfPrefix = "G" | "S" | "A" | "P";

export function pdfPrefix(taetigkeitsbereich: string): PdfPrefix {
  if (taetigkeitsbereich === TAETIGKEIT_GUTACHTEN) return "G";
  if (taetigkeitsbereich === TAETIGKEIT_STELLUNGNAHME) return "S";
  if ((TAETIGKEITEN_ABNAHME as readonly string[]).includes(taetigkeitsbereich)) return "A";
  return "P";
}

/** 2020+ format. `null` for a blank Tätigkeitsbereich, exactly like the formula's ISBLANK branch. */
export function generatePdfCode(
  taetigkeitsbereich: string | null | undefined,
  laufendeNummer: string | null | undefined,
  bahnhofStrecke: string | null | undefined,
): string | null {
  if (!taetigkeitsbereich) return null;
  return `${pdfPrefix(taetigkeitsbereich)}${laufendeNummer ?? ""} - ${bahnhofStrecke ?? ""}`;
}

/** 2018–2019 format: "901 - Frankfurt Niederrad - Video - Fertigstellung". `null` without a Prüfnummer. */
export function generateLegacyPdfCode(
  pruefnummer: string | number | null | undefined,
  bahnhofsname: string | null | undefined,
  technik: string | null | undefined,
  phase: string | null | undefined,
): string | null {
  if (pruefnummer === null || pruefnummer === undefined || pruefnummer === "") return null;
  return [String(pruefnummer), bahnhofsname, technik, phase].filter((p): p is string => !!p).join(" - ");
}

/** Whitespace-insensitive comparison, because the workbook's cells carry stray and doubled spaces. */
export const samePdfCode = (a: string | null | undefined, b: string | null | undefined): boolean =>
  (a ?? "").replace(/\s+/g, " ").trim() === (b ?? "").replace(/\s+/g, " ").trim();
