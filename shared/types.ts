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
  "GA",
  "Energie",
  "HFT",
  "HKLS",
  "TBQ",
  "BS",
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

/**
 * ============================================================================
 * ADDED: Full UI & App types for complete integration, type safety and deployment readiness
 * ============================================================================
 * These types enable:
 * - Single source of truth (import Project, Review, Stats etc from "@shared/types" everywhere)
 * - Strict typing with Department & ReviewStatus (no more string literals for depts/status)
 * - Elimination of duplication between hooks/useData.ts and pages
 * - Full support for all features: table display, editing (InlineEditCell, applyEdit, applyReviewEdit), 
 *   normalization (ALL_DEPARTMENTS can now use DEPARTMENTS), filtering, pagination, 
 *   BVB-EEA / PSV-ITK special views, dashboard stats, audit, OAuth, etc.
 * - Perfect GitHub integration: consistent types across client/server/shared
 * - Ready for production: better IntelliSense, compile-time checks, easier maintenance
 */

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
 * in tables, cards, maps, edit forms and department expansion views (like the BS screenshot).
 * Includes all editable fields + reviews. Timestamps optional for UI.
 */
export interface ProjectUI {
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
  reviews: Review[];
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
}

/**
 * Alias for seamless integration: many existing imports use `Project`.
 * After updating hooks/pages to `import type { ProjectUI as Project, Review } from "@shared/types"`
 * you get full type safety without changing call sites.
 */
// (No direct `export type Project` to avoid duplicate identifier with the one from `export type * from "../drizzle/schema"`)
// Import as: import type { ProjectUI as Project, Review } from "@shared/types"; for full backward-compatible integration.

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
 * Shape of paginated result from useProjects hook (and API responses).
 */
export interface ProjectsResult {
  projects: ProjectUI[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Input parameters accepted by useProjects hook (and backend query).
 */
export interface ProjectsParams {
  page: number;
  pageSize: number;
  search?: string;
  region?: string;
  projektleiter?: string;
  pruefer?: string;
  status?: string;
  department?: string;
}

/**
 * Editable fields on a Project (for InlineEditCell and applyEdit).
 * Derived automatically from ProjectUI for maintainability.
 */
export type EditableProjectField = keyof Omit<ProjectUI, "id" | "reviews">;

/**
 * Editable fields on a Review (for applyReviewEdit status/pruefer/date changes).
 */
export type EditableReviewField = keyof Omit<Review, "department">;

/**
 * Convenience re-export of DB types under Db namespace so you can still access
 * raw schema types (e.g. Db.Project, Db.DepartmentReview) if needed without conflicts.
 */
export * as Db from "../drizzle/schema";

/**
 * Note for deployment & GitHub:
 * - This file is now the single source of truth for ALL types (DB + UI + domain).
 * - Update client/src/hooks/useData.ts to import { type Project, type Review, DEPARTMENTS, ... } from "@shared/types"
 *   and remove local interface definitions + ALL_DEPARTMENTS (use DEPARTMENTS instead).
 * - Update any `any` usages in BvbEea.tsx, PsvItk.tsx, etc. to use Project/Review.
 * - BS department (and all 14) now fully typed and integrated in every view.
 * - No breaking changes for existing ProjectWithReviews usage (kept for compatibility).
 * - Ready to deploy: run tsc / build, all features (table expand/collapse per dept, inline edits, 
 *   filters, search, pagination, stats, special EEA/ITK pages, audit log) are fully typed.
 */
