/**
 * Unified Type Exports — Perfectly Aligned v2.0
 * Single entry point for all types. Inferred from validation.ts + Drizzle schema.
 */

import { z } from "zod";
import {
  DEPARTMENTS, REVIEW_STATUSES, PROJECT_STANDS, REGIONS,
  ReviewSchema, ProjectSchema,
  StatsSchema, FiltersSchema
} from "./validation";

export type {
  Review, Project, DepartmentReview, BvbEea, PsvItk, AuditLog,
  ProjectInput, BulkImport, Stats, Filters,
  ChecklistAnswerInput, ProjectChecklist, ChecklistSubmit
} from "./validation";

// Projektanmeldung checklist — the 22-question form
export {
  CHECKLIST_QUESTIONS, CHECKLIST_BY_KEY, DEPARTMENT_QUESTIONS, CHECKLIST_MODES,
  JA_NEIN, FREISCHALTUNG_OPTIONS, TERMIN_STATUS, UNTERSCHRIFTENBLATT,
  buildDepartmentReviews, defaultAnswers, isDepartmentRequired, notifiedRoles,
  visibleQuestions,
} from "./checklist";
export type {
  ChecklistQuestion, ChecklistMode, ChecklistAnswer, ChecklistAnswers,
  DepartmentQuestion, GeneratedReview, JaNein, FreischaltungOption, TerminStatus,
  SignatureBlock,
} from "./checklist";

// Canonical vocabularies
export { PROJEKTSTAENDE, normalizeProjektstand, toCanonicalProjektstand } from "./projektstand";
export type { Projektstand as CanonicalProjektstand } from "./projektstand";
export { normalizeReviewStatus, isOpen, isApproved, isBlocking } from "./review-status";
export { parseStoredDate, toDate, formatGerman } from "./date";
export type { ParsedDate } from "./date";

// Re-export enums
export { DEPARTMENTS, REVIEW_STATUSES, PROJECT_STANDS, REGIONS, DEPARTMENT_LIST } from "./validation";
export type Department = (typeof DEPARTMENTS)[number];
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export type ProjectStand = (typeof PROJECT_STANDS)[number];
export type Region = (typeof REGIONS)[number];

// Legacy compatibility types (kept for smooth migration)
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

export interface ProjectUI extends z.infer<typeof ProjectSchema> {
  reviews: z.infer<typeof ReviewSchema>[];
}

export interface AppData {
  projects: ProjectUI[];
  stats: z.infer<typeof StatsSchema>;
  filters: z.infer<typeof FiltersSchema>;
}

export interface ProjectsResult {
  projects: ProjectUI[];
  total: number;
}

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

export type EditableProjectField = keyof Omit<ProjectUI, "id" | "reviews" | "createdAt" | "updatedAt" | "originalRowIndex">;
export type EditableReviewField = keyof Omit<z.infer<typeof ReviewSchema>, "department">;

// OData types (for future Microsoft alignment)
export interface ODataResponse<T> {
  "@odata.context": string;
  value: T[];
  "@odata.count"?: number;
}

export interface ODataProjectsResponse extends ODataResponse<ProjectUI> {}
