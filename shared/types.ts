/**
 * Unified type exports
 * Import shared types from this single entry point.
 */

export type * from "../drizzle/schema";
export * from "./_core/errors";

/**
 * Department names - the 14 technical review departments (Fachbereiche)
 */
export const DEPARTMENTS = [
  "EEA",
  "ITK",
  "BS",
  "GA",
  "Energie",
  "HFT",
  "HKLS",
  "TBQ",
  "UM",
  "BIM",
  "LST",
  "Vermessung",
  "Baubetriebstechnologie",
  "Baubetriebsplanung",
] as const;

export type Department = (typeof DEPARTMENTS)[number];

/**
 * Status values for department reviews - exact values from the Excel dropdown
 */
export const REVIEW_STATUSES = [
  "nicht erforderlich",
  "offen",
  "Projektkonfig.",
  "in Bearbeitung",
  "Nachforderung",
  "prüffähig",
  "Prüfung erfolgt",
  "Zustimmung erteilt",
  "Niederschrift erstellt",
  "abgelehnt",
  "zurückgestellt",
  "gestoppt",
] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/**
 * Regions / Bahnhofsmanagement values
 */
export const REGIONS = [
  "Frankfurt",
  "Darmstadt",
  "Kassel",
  "Koblenz",
  "Saarbrücken",
  "Kaiserslautern",
  "Mainz",
  "Gießen",
] as const;

export type Region = (typeof REGIONS)[number];

/**
 * Project with department reviews - flattened for table display
 */
export interface ProjectWithReviews {
  id: number;
  projektnummer: string | null;
  bahnhofsmanagement: string | null;
  station: string | null;
  bahnhofsnummer: string | null;
  streckennummer: string | null;
  projektbeschreibung: string | null;
  eigvEinstufung: string | null;
  projektleiter: string | null;
  kommentar: string | null;
  projektLink: string | null;
  reviews: Record<string, {
    id: number;
    prueferName: string | null;
    datum: string | null;
    status: string | null;
  }>;
}
