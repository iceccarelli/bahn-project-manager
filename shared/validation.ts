import { z } from 'zod';
import { BAHNHOFSMANAGEMENT } from './bahnhofsmanagement';
import {
  CHECKLIST_MODES, CHECKLIST_QUESTIONS, FREISCHALTUNG_OPTIONS, JA_NEIN,
} from './checklist';

// ============================================
// SINGLE SOURCE OF TRUTH — ALL ZOD SCHEMAS (v2.0 — PERFECT INTEGRATION)
// Merged with existing types + const for maximum consistency
// ============================================

// ================== ENUMS (Merged & Centralized) ==================
export const DEPARTMENTS = [
  "EEA", "ITK", "BS", "GA", "Energie", "HFT", "HKLS", "TBQ",
  "UM", "BIM", "LST", "Vermessung", "Baubetriebstechnologie", "Baubetriebsplanung"
] as const;

export const REVIEW_STATUSES = [
  "nicht erforderlich", "offen", "Projektkonfig.", "in Bearbeitung",
  "Nachforderung", "prüffähig", "Prüfung erfolgt", "Zustimmung erteilt",
  "Niederschrift erstellt", "abgelehnt", "zurückgestellt", "gestoppt"
] as const;

/**
 * @deprecated Legacy list, kept only so existing imports keep compiling.
 * It contains data-entry debris ("doppelt siehe Zeile 197", "FA - Stand Spalte AJ")
 * and covers 18 of the 81 values actually present in client/public/data.json,
 * which is why ProjectSchema no longer uses it as an enum.
 * The canonical vocabulary is PROJEKTSTAENDE in shared/projektstand.ts.
 */
export const PROJECT_STANDS = [
  "AP", "EP", "FA", "EIGV Einstufung durch TBQ", "EIGV Einstufung durch TBQ/ Sammelfreigabe",
  "EP/ EIGV", "Gestoppt", "Projektstoppt siehe Ersatzprojekt", "Mieterumbau",
  "realisiert", "VEP", "TBQ GP", "EIGV erfolgt", "Umbau Start Q2 2024",
  "Mieterumbau iAG", "Mieterumbau MAG", "VEP, Projekt gestoppt, Mail PL vom 25.04.2022",
  "doppelt siehe Zeile 197", "FA - Stand Spalte AJ"
] as const;

/**
 * Bahnhofsmanagement / region vocabulary.
 * Single source of truth is shared/bahnhofsmanagement.ts, which is derived from
 * `Hilfsdatei!N17:N25` of the live Projektanmeldung form. Re-exported here under
 * the historical name so existing imports keep working.
 */
export const REGIONS = BAHNHOFSMANAGEMENT;

export const USER_ROLES = ["admin", "user", "viewer"] as const;

export type Department = (typeof DEPARTMENTS)[number];

// ================== CORE SCHEMAS ==================
export const ReviewSchema = z.object({
  department: z.enum(DEPARTMENTS),
  // Stored as free text: data.json holds 14 distinct values, including
  // "Niederschrift erstellt (LP05-05-01-F31)" (80 rows), whose annotation is a
  // real document reference. Group with normalizeReviewStatus() from
  // shared/review-status.ts instead of constraining storage.
  status: z.string().max(128).nullable().optional(),
  prueferName: z.string().nullable().optional(),
  pruefDatum: z.string().nullable().optional(),
  id: z.number().optional(),
});

export const ProjectSchema = z.object({
  id: z.number().optional(),
  originalRowIndex: z.number().nullable().optional(),
  fullRowData: z.record(z.string(), z.any()).nullable().optional(),
  // 15 of the 1,298 rows have no Projektnummer, and the DB column is nullable.
  // Requiring it here is what made scripts/seed-perfect.ts throw on real data.
  projektnummer: z.string().max(256).nullable().optional(),
  bahnhofsmanagement: z.string().max(128).nullable().optional(),
  station: z.string().max(256).nullable().optional(),
  bahnhofsnummer: z.string().max(32).nullable().optional(),
  streckennummer: z.string().max(32).nullable().optional(),
  projektbeschreibung: z.string().max(5000).nullable().optional(),
  // Free text — 81 distinct values in the wild. Canonicalise for grouping with
  // normalizeProjektstand() from shared/projektstand.ts.
  projektstand: z.string().max(256).nullable().optional(),
  eigvEinstufung: z.string().max(1000).nullable().optional(),
  projektleiter: z.string().max(256).nullable().optional(),
  terminProjektvorstellung: z.string().nullable().optional(),
  kommentar: z.string().max(5000).nullable().optional(),
  // Not .url(): the column holds SharePoint paths and free-text notes, and a
  // stricter schema than the data would reject 1,298 rows to no benefit.
  projektLink: z.string().max(2048).nullable().optional(),
  syncVersion: z.number().int().default(1),
  reviews: z.array(ReviewSchema).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const DepartmentReviewSchema = z.object({
  id: z.number().optional(),
  projectId: z.number(),
  department: z.enum(DEPARTMENTS),
  prueferName: z.string().nullable().optional(),
  datum: z.string().nullable().optional(),
  status: z.string().max(128).nullable().optional(),
});

export const BvbEeaSchema = z.object({
  id: z.number().optional(),
  projektnummer: z.string(),
  bahnhofsmanagement: z.string().nullable().optional(),
  station: z.string().nullable().optional(),
  bahnhofsnummer: z.string().nullable().optional(),
  streckennummer: z.string().nullable().optional(),
  projektbeschreibung: z.string().nullable().optional(),
  projektleiter: z.string().nullable().optional(),
  eigvAnzeige: z.string().nullable().optional(),
  datum: z.string().nullable().optional(),
  kommentar: z.string().nullable().optional(),
  freigabeNummer: z.string().nullable().optional(),
  kosteneinsparung: z.string().nullable().optional(),
});

export const PsvItkSchema = z.object({
  id: z.number().optional(),
  projektnummer: z.string(),
  bahnhofsmanagement: z.string().nullable().optional(),
  station: z.string().nullable().optional(),
  bahnhofsnummer: z.string().nullable().optional(),
  streckennummer: z.string().nullable().optional(),
  projektbeschreibung: z.string().nullable().optional(),
  projektstand: z.string().max(256).nullable().optional(),
  projektleiter: z.string().nullable().optional(),
  terminProjektvorstellung: z.string().nullable().optional(),
  itkPruefer: z.string().nullable().optional(),
  datum: z.string().nullable().optional(),
  kommentar: z.string().nullable().optional(),
});

export const AuditLogSchema = z.object({
  id: z.number().optional(),
  userId: z.number().nullable().optional(),
  userName: z.string().nullable().optional(),
  entityType: z.enum(["project", "department_review", "bvb_eea", "psv_itk"]),
  entityId: z.number(),
  action: z.enum(["create", "update", "delete", "import", "export"]),
  field: z.string().nullable().optional(),
  oldValue: z.any().nullable().optional(),
  newValue: z.any().nullable().optional(),
  createdAt: z.string().optional(),
});

// ================== PROJEKTANMELDUNG CHECKLIST ==================
// The 22-question form from "Projektanmeldung Fachspezialistenprüfung_neu.xlsm".
// Question keys, modes and the trigger rule live in shared/checklist.ts; this is
// the validation surface over them.

/** Every valid question key, derived from the checklist so the two cannot drift. */
export const CHECKLIST_QUESTION_KEYS = CHECKLIST_QUESTIONS.map((q) => q.key) as [string, ...string[]];

export const ChecklistAnswerSchema = z.object({
  questionKey: z.enum(CHECKLIST_QUESTION_KEYS),
  /** Formular column F */
  answer: z.string().max(512).nullable().optional(),
  /** Formular column H — only rows 17/18/19 have one */
  secondary: z.enum(JA_NEIN).nullable().optional(),
  /** Formular column G */
  comment: z.string().max(2000).nullable().optional(),
});

export const ProjectChecklistSchema = z.object({
  id: z.number().optional(),
  projectId: z.number().nullable().optional(),
  mode: z.enum(CHECKLIST_MODES),
  status: z.enum(["draft", "submitted", "cancelled"]).default("draft"),

  // Formular rows 6-9
  projektnummer: z.string().max(256).nullable().optional(),
  projektbezeichnung: z.string().max(512).nullable().optional(),
  stationsname: z.string().max(256).nullable().optional(),
  bahnhofsnummer: z.string().max(32).nullable().optional(),
  streckennummer: z.string().max(32).nullable().optional(),
  projektstand: z.string().max(128).nullable().optional(),
  bahnhofsmanagement: z.enum(BAHNHOFSMANAGEMENT).nullable().optional(),
  projektleitung: z.string().max(256).nullable().optional(),

  // Formular rows 13-16
  pkpLink: z.string().max(2048).nullable().optional(),
  freischaltungFaa: z.enum(FREISCHALTUNG_OPTIONS).nullable().optional(),
  unterschriftenblatt: z.enum(FREISCHALTUNG_OPTIONS).nullable().optional(),
  mitProjektvorstellung: z.enum(JA_NEIN).nullable().optional(),
  uebergabeDatum: z.string().nullable().optional(),
  anmerkungen: z.string().max(5000).nullable().optional(),

  // booked Fachspezialistenprüfung slot
  terminDatum: z.string().nullable().optional(),
  terminVon: z.string().max(8).nullable().optional(),
  terminBis: z.string().max(8).nullable().optional(),

  answers: z.array(ChecklistAnswerSchema).default([]),
  syncVersion: z.number().int().default(1),
  submittedAt: z.string().nullable().optional(),
  submittedBy: z.string().max(256).nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

/**
 * What the wizard must supply to actually submit (as opposed to save a draft).
 * Mirrors the two guards in `Makro_mit_Termin.PDF_und_Mail`:
 *   If Range("D6") = "" Then MsgBox "Sie haben noch keine Projektnummer eingegeben"
 *   If Range("D6") = "" Then MsgBox "Sie haben noch keinen Projektstand ausgewählt"
 * The second guard tests D6 again instead of D9 — a copy-paste bug in the
 * workbook that lets a project be submitted with Projektstand "Bitte auswählen".
 * Here the intended check is applied to the right field.
 */
export const ChecklistSubmitSchema = ProjectChecklistSchema.extend({
  projektnummer: z.string().min(1, "Projektnummer ist erforderlich").max(256),
  projektbezeichnung: z.string().min(1, "Projektbezeichnung ist erforderlich").max(512),
  stationsname: z.string().min(1, "Stationsname ist erforderlich").max(256),
  projektstand: z.string().min(1, "Projektstand ist erforderlich").max(128),
  bahnhofsmanagement: z.enum(BAHNHOFSMANAGEMENT),
  projektleitung: z.string().min(1, "Name der Projektleitung ist erforderlich").max(256),
});

// ================== INPUT SCHEMAS ==================
export const ProjectInputSchema = ProjectSchema.omit({
  id: true, createdAt: true, updatedAt: true, syncVersion: true, fullRowData: true
}).extend({
  reviews: z.array(ReviewSchema.omit({ id: true })).optional(),
});

export const BulkImportSchema = z.object({
  projects: z.array(ProjectInputSchema),
  mode: z.enum(["upsert", "replace"]).default("upsert"),
  checksum: z.string().optional(),
});

// ================== STATS & FILTERS ==================
export const StatsSchema = z.object({
  totalProjects: z.number(),
  statusDistribution: z.array(z.object({ status: z.string(), count: z.number() })),
  regionStats: z.array(z.object({ region: z.string(), count: z.number() })),
  prueferWorkload: z.array(z.object({ name: z.string(), count: z.number() })),
  departmentStats: z.array(z.object({
    department: z.enum(DEPARTMENTS),
    // nullable in the DB (department_reviews.status), free text in data.json
    status: z.string().nullable(),
    count: z.number()
  })),
});

export const FiltersSchema = z.object({
  search: z.string().optional(),
  region: z.string().optional(),
  projektleiter: z.string().optional(),
  pruefer: z.string().optional(),
  status: z.string().optional(),
  department: z.enum(DEPARTMENTS).optional(),
  projektstand: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

// ================== TYPE EXPORTS ==================
export type Review = z.infer<typeof ReviewSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type DepartmentReview = z.infer<typeof DepartmentReviewSchema>;
export type BvbEea = z.infer<typeof BvbEeaSchema>;
export type PsvItk = z.infer<typeof PsvItkSchema>;
export type AuditLog = z.infer<typeof AuditLogSchema>;
export type ProjectInput = z.infer<typeof ProjectInputSchema>;
export type BulkImport = z.infer<typeof BulkImportSchema>;
export type Stats = z.infer<typeof StatsSchema>;
export type Filters = z.infer<typeof FiltersSchema>;
export type ChecklistAnswerInput = z.infer<typeof ChecklistAnswerSchema>;
export type ProjectChecklist = z.infer<typeof ProjectChecklistSchema>;
export type ChecklistSubmit = z.infer<typeof ChecklistSubmitSchema>;

export const DEPARTMENT_LIST = DEPARTMENTS;
