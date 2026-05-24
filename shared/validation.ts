import { z } from 'zod';

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

export const PROJECT_STANDS = [
  "AP", "EP", "FA", "EIGV Einstufung durch TBQ", "EIGV Einstufung durch TBQ/ Sammelfreigabe",
  "EP/ EIGV", "Gestoppt", "Projektstoppt siehe Ersatzprojekt", "Mieterumbau",
  "realisiert", "VEP", "TBQ GP", "EIGV erfolgt", "Umbau Start Q2 2024",
  "Mieterumbau iAG", "Mieterumbau MAG", "VEP, Projekt gestoppt, Mail PL vom 25.04.2022",
  "doppelt siehe Zeile 197", "FA - Stand Spalte AJ", null
] as const;

export const REGIONS = [
  "Frankfurt", "Darmstadt", "Kassel", "Koblenz", "Saarbrücken",
  "Kaiserslautern", "Mainz", "Gießen"
] as const;

export const USER_ROLES = ["admin", "user", "viewer"] as const;

// ================== CORE SCHEMAS ==================
export const ReviewSchema = z.object({
  department: z.enum(DEPARTMENTS),
  status: z.enum(REVIEW_STATUSES).nullable().optional(),
  prueferName: z.string().nullable().optional(),
  pruefDatum: z.string().nullable().optional(),
  id: z.number().optional(),
});

export const ProjectSchema = z.object({
  id: z.number().optional(),
  originalRowIndex: z.number().nullable().optional(),
  fullRowData: z.record(z.any()).nullable().optional(),
  projektnummer: z.string().min(1).max(256),
  bahnhofsmanagement: z.string().max(128).nullable().optional(),
  station: z.string().max(256).nullable().optional(),
  bahnhofsnummer: z.string().max(32).nullable().optional(),
  streckennummer: z.string().max(32).nullable().optional(),
  projektbeschreibung: z.string().max(5000).nullable().optional(),
  projektstand: z.enum(PROJECT_STANDS).nullable().optional(),
  eigvEinstufung: z.string().max(1000).nullable().optional(),
  projektleiter: z.string().max(256).nullable().optional(),
  terminProjektvorstellung: z.string().datetime().nullable().optional(),
  kommentar: z.string().max(5000).nullable().optional(),
  projektLink: z.string().url().max(2048).nullable().optional(),
  syncVersion: z.number().int().default(1),
  reviews: z.array(ReviewSchema).default([]),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
  bahnhofsnummer: z.string().nullable().optional(),
  streckennummer: z.string().nullable().optional(),
  projektbeschreibung: z.string().nullable().optional(),
  projektstand: z.enum(PROJECT_STANDS).nullable().optional(),
  eigvEinstufung: z.string().nullable().optional(),
  projektleiter: z.string().nullable().optional(),
  terminProjektvorstellung: z.string().datetime().nullable().optional(),
  kommentar: z.string().nullable().optional(),
  projektLink: z.string().url().nullable().optional(),
  reviews: z.array(ReviewSchema).default([]),
  syncVersion: z.number().default(1),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export const DepartmentReviewSchema = z.object({
  id: z.number().optional(),
  projectId: z.number(),
  department: z.enum(DEPARTMENTS),
  prueferName: z.string().nullable().optional(),
  datum: z.string().datetime().nullable().optional(),
  status: z.enum(REVIEW_STATUSES).nullable().optional(),
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
  eigvAnzeige: z.string().datetime().nullable().optional(),
  datum: z.string().datetime().nullable().optional(),
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
  projektstand: z.enum(PROJECT_STANDS).nullable().optional(),
  projektleiter: z.string().nullable().optional(),
  terminProjektvorstellung: z.string().datetime().nullable().optional(),
  itkPruefer: z.string().nullable().optional(),
  datum: z.string().datetime().nullable().optional(),
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
  createdAt: z.string().datetime().optional(),
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
    status: z.enum(REVIEW_STATUSES),
    count: z.number()
  })),
});

export const FiltersSchema = z.object({
  search: z.string().optional(),
  region: z.string().optional(),
  projektleiter: z.string().optional(),
  pruefer: z.string().optional(),
  status: z.enum(REVIEW_STATUSES).optional(),
  department: z.enum(DEPARTMENTS).optional(),
  projektstand: z.enum(PROJECT_STANDS).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
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

export const DEPARTMENT_LIST = DEPARTMENTS;
