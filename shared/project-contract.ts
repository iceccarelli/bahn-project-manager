/**
 * Wire contract for Project mutations and reads. Shared by the tRPC router and
 * the client so both sides validate against the same schema.
 *
 * Reuses ProjectSchema for the per-field rules — no second definition of what a
 * valid Projektstand or Projektbeschreibung is.
 */
import { z } from "zod";
import { ProjectSchema } from "./validation";
import type { FieldChange } from "./domain-events";

/** The only columns a client may write on a project. Everything else is server-owned. */
export const EDITABLE_PROJECT_FIELDS = [
  "projektnummer",
  "bahnhofsmanagement",
  "station",
  "bahnhofsnummer",
  "streckennummer",
  "projektbeschreibung",
  "projektstand",
  "eigvEinstufung",
  "projektleiter",
  "terminProjektvorstellung",
  "kommentar",
  "projektLink",
] as const;
export type EditableProjectField = (typeof EDITABLE_PROJECT_FIELDS)[number];

const shape = ProjectSchema.shape;
export const ProjectFieldsSchema = z.object({
  projektnummer: shape.projektnummer,
  bahnhofsmanagement: shape.bahnhofsmanagement,
  station: shape.station,
  bahnhofsnummer: shape.bahnhofsnummer,
  streckennummer: shape.streckennummer,
  projektbeschreibung: shape.projektbeschreibung,
  projektstand: shape.projektstand,
  eigvEinstufung: shape.eigvEinstufung,
  projektleiter: shape.projektleiter,
  terminProjektvorstellung: shape.terminProjektvorstellung,
  kommentar: shape.kommentar,
  projektLink: shape.projektLink,
});

/** strict(): an unknown key is a 400, never silently dropped or written. */
export const ProjectPatchSchema = ProjectFieldsSchema.partial().strict();
export type ProjectPatch = z.infer<typeof ProjectPatchSchema>;

const idempotencyKey = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/);

export const UpdateProjectInputSchema = z.object({
  id: z.number().int().positive(),
  /** the version the client's edit was based on */
  expectedVersion: z.number().int().min(1),
  changes: ProjectPatchSchema.refine(p => Object.keys(p).length > 0, "changes must not be empty"),
  idempotencyKey,
  /** client-generated, echoed in logs/traces to correlate one user action */
  mutationId: z.string().max(64).optional(),
});
export type UpdateProjectInput = z.infer<typeof UpdateProjectInputSchema>;

export const REVIEW_FIELDS = ["status", "prueferName", "datum"] as const;
export type ReviewField = (typeof REVIEW_FIELDS)[number];
/** Change keys for review edits live in the same `changes` map as project fields: review.<Gewerk>.<field>. */
export const reviewChangeKey = (department: string, field: ReviewField) => `review.${department}.${field}`;
export const REVIEW_KEY_RE = /^review\.([^.]+)\.(status|prueferName|datum)$/;

export const UpdateReviewInputSchema = z.object({
  projectId: z.number().int().positive(),
  department: z.string().min(1).max(64),
  /** the PROJECT version: a review is part of the Project aggregate */
  expectedVersion: z.number().int().min(1),
  changes: z
    .object({
      status: z.string().max(128).nullable().optional(),
      prueferName: z.string().max(256).nullable().optional(),
      datum: z.string().max(40).nullable().optional(),
    })
    .strict()
    .refine(p => Object.keys(p).length > 0, "changes must not be empty"),
  idempotencyKey,
  mutationId: z.string().max(64).optional(),
});
export type UpdateReviewInput = z.infer<typeof UpdateReviewInputSchema>;

export const CreateProjectInputSchema = z.object({
  fields: ProjectPatchSchema,
  idempotencyKey,
  mutationId: z.string().max(64).optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

/** What the list returns: no reviews, no fullRowData. */
export interface ProjectSummary {
  id: number;
  version: number;
  projektnummer: string | null;
  bahnhofsmanagement: string | null;
  station: string | null;
  projektstand: string | null;
  projektleiter: string | null;
  terminProjektvorstellung: string | null;
  updatedAt: string;
}

export interface ProjectDetail extends ProjectSummary {
  bahnhofsnummer: string | null;
  streckennummer: string | null;
  projektbeschreibung: string | null;
  eigvEinstufung: string | null;
  kommentar: string | null;
  projektLink: string | null;
  createdAt: string;
  reviews: Array<{
    id: number;
    department: string;
    prueferName: string | null;
    datum: string | null;
    status: string | null;
    updatedAt: string;
  }>;
}

export interface MutationResult {
  project: ProjectDetail;
  eventId: string;
  /** true when this response replays an earlier request with the same key */
  replayed: boolean;
}

/** Structured payload of a VERSION_CONFLICT (tRPC CONFLICT, HTTP 409). */
export interface ConflictInfo {
  code: "VERSION_CONFLICT";
  projectId: number;
  expectedVersion: number;
  currentVersion: number;
  /** current server values of the fields the caller tried to change */
  serverValues: Record<string, string | null>;
  /** what the caller tried to write */
  localValues: Record<string, string | null>;
  /** fields the caller tried to change that someone else also changed since expectedVersion */
  conflictingFields: string[];
  /** every field changed by intervening versions */
  changedSince: Record<string, FieldChange>;
  lastChange: { actorId: string; actorName: string | null; at: string } | null;
  /** true when the intervening changes touch none of the caller's fields */
  disjoint: boolean;
  /** the full current row so the client can reconcile without another round trip */
  current: ProjectDetail;
}

/** Closed set: each maps to one column in the store. `updatedAt`/`id` are index-backed. */
export const PROJECT_SORTS = ["updatedAt", "id", "projektnummer", "station", "projektstand", "projektleiter", "bahnhofsmanagement"] as const;

/** A list row: the summary plus whatever `expand` asked for. Reviews only when expanded. */
export type ProjectListItem = ProjectSummary &
  Partial<Pick<ProjectDetail, "bahnhofsnummer" | "streckennummer" | "projektbeschreibung" | "eigvEinstufung" | "kommentar" | "projektLink" | "createdAt" | "reviews">>;
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 50;

export const ListProjectsInputSchema = z.object({
  cursor: z.string().max(256).optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: z.enum(PROJECT_SORTS).default("updatedAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().trim().max(100).optional(),
  bahnhofsmanagement: z.string().max(128).optional(),
  projektstand: z.string().max(256).optional(),
  projektleiter: z.string().max(256).optional(),
  /** review-based filters (EXISTS on department_reviews) */
  department: z.string().max(64).optional(),
  reviewStatus: z.string().max(128).optional(),
  pruefer: z.string().max(256).optional(),
  /** optional detail expansion; the default row is the lean summary */
  expand: z.array(z.enum(["reviews", "details"])).max(2).default([]),
  includeTotal: z.boolean().default(false),
});
export type ListProjectsInput = z.infer<typeof ListProjectsInputSchema>;

export const SyncInputSchema = z.object({
  /** projects the client holds → the version it holds. Bounded. */
  known: z.array(z.object({ id: z.number().int().positive(), version: z.number().int().min(1) })).max(200),
});
export type SyncInput = z.infer<typeof SyncInputSchema>;
