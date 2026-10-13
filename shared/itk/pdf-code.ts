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

/**
 * 2018 sheet: "YYYYMMDD-NNN Bahnhof Technik Phase", e.g. "20180115-801 Fulda ELA EP"
 * (`=CONCATENATE(H,"-",A," ",B," ",D," ",G)`: Abgabedatum, Prüfnr, Bahnhof, Technik, Phase).
 * Plain concatenation like the cell: an empty part leaves its separator, which is what the stored codes show.
 * (The platform's `generate_legacy_pdf_code` documents this formula and then implements the 2019 one.)
 */
export function generatePdfCode2018(
  datumIso: string | null | undefined,
  pruefnummer: string | number | null | undefined,
  bahnhofsname: string | null | undefined,
  technik: string | null | undefined,
  phase: string | null | undefined,
): string | null {
  if (pruefnummer === null || pruefnummer === undefined || pruefnummer === "") return null;
  return `${(datumIso ?? "").replace(/-/g, "")}-${pruefnummer} ${bahnhofsname ?? ""} ${technik ?? ""} ${phase ?? ""}`.replace(/\s+/g, " ").trim();
}

/**
 * 2019 sheet: "901 - Frankfurt Niederrad - Video - Fertigstellung" (Prüfnr - Bahnhof - Technik - Phase).
 * Plain concatenation: an empty part keeps its separators, so a report without Technik and Phase reads "930 - Tchagha - -"
 * — exactly what the stored codes say.
 */
export function generatePdfCode2019(
  pruefnummer: string | number | null | undefined,
  bahnhofsname: string | null | undefined,
  technik: string | null | undefined,
  phase: string | null | undefined,
): string | null {
  if (pruefnummer === null || pruefnummer === undefined || pruefnummer === "") return null;
  return `${pruefnummer} - ${bahnhofsname ?? ""} - ${technik ?? ""} - ${phase ?? ""}`.replace(/\s+/g, " ").trim();
}

/** Whitespace-insensitive comparison, because the workbook's cells carry stray and doubled spaces. */
export const samePdfCode = (a: string | null | undefined, b: string | null | undefined): boolean =>
  (a ?? "").replace(/\s+/g, " ").trim() === (b ?? "").replace(/\s+/g, " ").trim();

/** The fields the PDF-Code is derived from (structural, so the importer's, the stored and the displayed record all fit). */
export interface PdfCodeSource {
  year: number;
  layout: "2020+" | "2018-2019" | "2017";
  laufendeNummer: string;
  datum: string | null;
  taetigkeitsbereich: string | null;
  bahnhofStrecke: string | null;
  technik: string | null;
  phase: string | null;
}

/**
 * The code of a Prüfbericht. The workbook changed its formula with the layout, and once inside the legacy layout:
 * 2020+ G/S/A/P…, 2019 "Nr - Bahnhof - Technik - Phase", 2018 "YYYYMMDD-Nr Bahnhof Technik Phase"; the 2017 sheet has
 * no code. This is the only place that chooses between them.
 */
export function derivePdfCode(r: PdfCodeSource): string | null {
  if (r.layout === "2020+") return generatePdfCode(r.taetigkeitsbereich, r.laufendeNummer, r.bahnhofStrecke);
  if (r.layout === "2018-2019") {
    return r.year === 2018
      ? generatePdfCode2018(r.datum, r.laufendeNummer, r.bahnhofStrecke, r.technik, r.phase)
      : generatePdfCode2019(r.laufendeNummer, r.bahnhofStrecke, r.technik, r.phase);
  }
  return null;
}
