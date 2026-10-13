/**
 * Which ITK Prüfbericht does an Abnahme belong to? — the selection rule, pure.
 *
 * An Abnahme of one Technik for one project can reference the project's linked Prüfberichte (`itk_pruefberichte.projectId`).
 * The Abnahmeprotokoll then carries the report's laufende Nummer and its canonical PDF-Code (shared/itk/pdf-code.ts —
 * derived, never the free text stored in the workbook).
 *
 *   none     the project has no report of this Technik (or none at all): nothing to reference, the protocol says so
 *   single   exactly one: used, and shown — a reader can see which one
 *   choose   several: the user must pick one; nothing is preselected and the protocol cannot be produced before
 *   chosen   several, and the user picked one of them
 *
 * A report whose Technik is unknown (no Bauform in the workbook) is eligible for every Abnahme but labelled as such;
 * a report of another Technik is not offered for this one.
 */
import { derivePdfCode, type PdfCodeSource } from "../itk/pdf-code";
import type { Technik } from "./types";

export interface AbnahmeReport extends PdfCodeSource {
  id: number;
  year: number;
  laufendeNummer: string;
  technikArt: string | null;
}

/** Does a report's Technik (the workbook's "Bauform / Bezeichnung der Anlage") belong to this Abnahme's Technik? */
export function technikMatches(abnahme: Technik, technikArt: string | null): boolean {
  if (technikArt === null) return true; // unknown → eligible, labelled
  if (abnahme === "ELA") return technikArt === "ELA" || technikArt.startsWith("ELA ");
  return technikArt === abnahme;
}

export function eligibleReports<R extends AbnahmeReport>(abnahme: Technik, reports: readonly R[]): R[] {
  return reports.filter((r) => technikMatches(abnahme, r.technikArt));
}

export type ReportSelection<R> =
  | { status: "none" }
  | { status: "single"; report: R }
  | { status: "choose"; options: R[] }
  | { status: "chosen"; report: R; options: R[] };

export function selectReport<R extends AbnahmeReport>(eligible: readonly R[], chosenId: number | null): ReportSelection<R> {
  if (eligible.length === 0) return { status: "none" };
  if (eligible.length === 1) return { status: "single", report: eligible[0] as R };
  const chosen = chosenId === null ? undefined : eligible.find((r) => r.id === chosenId);
  return chosen ? { status: "chosen", report: chosen, options: [...eligible] } : { status: "choose", options: [...eligible] };
}

export interface AbnahmeReference {
  year: number;
  laufendeNummer: string;
  /** the canonical, derived PDF-Code; null where the formula needs data the report lacks */
  pdfCode: string | null;
}
export const referenceOf = (r: AbnahmeReport): AbnahmeReference => ({ year: r.year, laufendeNummer: r.laufendeNummer, pdfCode: derivePdfCode(r) });

/** The protocol may only be produced once the reference is settled: never while the user still has to choose. */
export const needsChoice = (s: ReportSelection<unknown>): boolean => s.status === "choose";
