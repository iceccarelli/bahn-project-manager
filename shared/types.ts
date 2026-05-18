/**
 * Unified type exports
 * Import shared types from this single entry point.
 */

export type * from "../drizzle/schema";
export * from "./_core/errors";

/**
 * Department names - the 14 technical review departments (Fachbereiche)
 * Order matches the Excel Übersichtsliste exactly.
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
  projektstand: string | null;
  eigvEinstufung: string | null;
  projektleiter: string | null;
  terminProjektvorstellung: string | Date | null;
  kommentar: string | null;
  projektLink: string | null;
  reviews: Record<string, {
    id: number;
    prueferName: string | null;
    datum: string | null;
    status: string | null;
  }>;
}

/**
 * Normalized Review for a single department on a project (UI layer).
 * Replaces loose `string` with strict `Department` and `ReviewStatus` for safety.
 * Used in Project.reviews array, filtering, editing, and normalization logic.
 */
export interface Review {
  department: Department;
  status: ReviewStatus | null;
  prueferName: string | null;
  pruefDatum: string | null;
}

/**
 * Primary UI Project type used across the application (hooks, pages, components).
 * Extends DB project data with denormalized `reviews` array for convenient access
 * in tables, cards, maps, edit forms and department expansion views.
 * Includes all editable fields + reviews. Timestamps optional for UI.
 *
 * Column order matches Excel Übersichtsliste:
 * Nr. (computed) | Projektnummer | Bahnhofsmanagement | Station | Bahnhofsnummer |
 * Streckennummer | Projektbeschreibung | Projektstand | Projektleiter |
 * Termin Projektvorstellung | [14 dept reviews] | Kommentar | Projektlink
 */
export interface ProjectUI {
  id: number;
  originalRowIndex?: number | null;
  projektnummer: string | null;
  bahnhofsmanagement: string | null;
  station: string | null;
  bahnhofsnummer: string | null;
  streckennummer: string | null;
  projektbeschreibung: string | null;
  projektstand: string | null;
  eigvEinstufung: string | null;
  projektleiter: string | null;
  terminProjektvorstellung: string | Date | null;
  kommentar: string | null;
  projektLink: string | null;
  reviews: Review[];
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
}

/**
 * Aggregated statistics returned for dashboard KPIs and visualizations.
 */
export interface Stats {
  totalProjects: number;
  statusDistribution: Array<{ status: string; count: number }>;
  regionStats: Array<{ region: string; count: number }>;
  prueferWorkload: Array<{ name: string; count: number }>;
  departmentStats: Array<{ department: string; status: string; count: number }>;
}

/**
 * Filter option lists (populated dynamically from data) for search/filter UI components.
 */
export interface Filters {
  regions: string[];
  projektleiter: string[];
  pruefer: string[];
}

/**
 * Complete bundle returned by useAllData / data loading hooks.
 */
export interface AppData {
  projects: ProjectUI[];
  stats: Stats;
  filters: Filters;
}

/**
 * Shape of result from useProjects hook (and API responses).
 * No pagination - all projects loaded at once.
 */
export interface ProjectsResult {
  projects: ProjectUI[];
  total: number;
}

/**
 * Input parameters accepted by useProjects hook (and backend query).
 * No pagination - showAll is always true.
 */
export interface ProjectsParams {
  search?: string;
  region?: string;
  projektleiter?: string;
  pruefer?: string;
  status?: string;
  department?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  minLat?: number;
  maxLat?: number;
  minLng?: number;
  maxLng?: number;
}

/**
 * Editable fields on a Project (for InlineEditCell and applyEdit).
 * Derived automatically from ProjectUI for maintainability.
 */
export type EditableProjectField = keyof Omit<ProjectUI, "id" | "reviews" | "createdAt" | "updatedAt" | "originalRowIndex">;

/**
 * Editable fields on a Review (for applyReviewEdit status/pruefer/date changes).
 */
export type EditableReviewField = keyof Omit<Review, "department">;

/**
 * Convenience re-export of DB types under Db namespace so you can still access
 * raw schema types (e.g. Db.Project, Db.DepartmentReview) if needed without conflicts.
 */
export * as Db from "../drizzle/schema";
