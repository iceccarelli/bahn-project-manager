/** Wire contract of the Übersichtsliste import (`projects.registerPreview` / `projects.registerApply`). */
import { z } from "zod";
import { DEPARTMENTS } from "../validation";
import type { RegisterFields, RegisterRecord, RegisterReview } from "./register-import";
import { REGISTER_FIELD_KEYS } from "./register-import";

const text = z.string().max(5000).nullable();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

export const RegisterFieldsSchema = z.object({
  projektnummer: text,
  bahnhofsmanagement: text,
  station: text,
  bahnhofsnummer: text,
  streckennummer: text,
  projektbeschreibung: text,
  projektstand: text,
  projektleiter: text,
  terminProjektvorstellung: day,
  kommentar: text,
  projektLink: text,
}) satisfies z.ZodType<RegisterFields>;

const ReviewSchema = z.object({ status: z.string().max(128).nullable(), prueferName: z.string().max(256).nullable(), datum: day }) satisfies z.ZodType<RegisterReview>;

export const RegisterRecordSchema = z.object({
  ref: z.number().int().min(1),
  fields: RegisterFieldsSchema,
  reviews: z.object(Object.fromEntries(DEPARTMENTS.map((d) => [d, ReviewSchema.optional()])) as Record<(typeof DEPARTMENTS)[number], z.ZodOptional<typeof ReviewSchema>>),
}) satisfies z.ZodType<RegisterRecord>;

/** Rows per request. The API body limit is 256 kB; `chunkRecords` keeps a chunk well below it. */
export const REGISTER_MAX_ROWS = 150;

/**
 * Records of the same chunk that the request does not act on, reduced to the fields identity is made of. The planner needs
 * them to judge fairly ("this project is already accounted for by that record"); without them a request that carries only
 * some rows of a chunk would see an existing project as unclaimed and hold a perfectly clear row.
 */
export const RegisterContextSchema = z.object({
  ref: z.number().int().min(1),
  projektnummer: z.string().max(5000).nullable(),
  station: z.string().max(5000).nullable(),
  projektbeschreibung: z.string().max(5000).nullable(),
  projektstand: z.string().max(5000).nullable(),
  terminProjektvorstellung: day,
});
export type RegisterContext = z.infer<typeof RegisterContextSchema>;

export const RegisterPreviewInputSchema = z.object({
  records: z.array(RegisterRecordSchema).min(1).max(REGISTER_MAX_ROWS),
  context: z.array(RegisterContextSchema).max(REGISTER_MAX_ROWS).optional(),
});
export type RegisterPreviewInput = z.infer<typeof RegisterPreviewInputSchema>;

const idempotencyKey = z.string().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/);

/**
 * One row of an apply request: the record and what the administrator decided for it. The server does not take the
 * preview's word for anything — it re-plans under row locks and refuses a decision the evidence no longer supports.
 */
export const RegisterApplyRowSchema = z.object({
  record: RegisterRecordSchema,
  action: z.enum(["create", "update", "skip", "unskip"]),
  /** the project to update, with the version the preview saw */
  target: z.object({ projectId: z.number().int().positive(), expectedVersion: z.number().int().min(1) }).optional(),
  /** the administrator accepted replacing non-empty values */
  overwrite: z.boolean().default(false),
  /** the administrator chose `target` among the candidates of an ambiguous row — or, with action "create", said "this is a new project" (no automatic evidence required) */
  confirmed: z.boolean().default(false),
}).refine((r) => r.action !== "update" || r.target !== undefined, "update braucht ein Zielprojekt");
export type RegisterApplyRow = z.infer<typeof RegisterApplyRowSchema>;

export const RegisterApplyInputSchema = z.object({
  source: z.string().trim().min(1).max(200),
  part: z.object({ index: z.number().int().min(1), total: z.number().int().min(1) }),
  rows: z.array(RegisterApplyRowSchema).min(1).max(REGISTER_MAX_ROWS),
  context: z.array(RegisterContextSchema).max(REGISTER_MAX_ROWS).optional(),
  idempotencyKey,
});
export type RegisterApplyInput = z.infer<typeof RegisterApplyInputSchema>;

export type ApplyOutcomeKind =
  | "created"    // new project written
  | "updated"    // existing project changed
  | "unchanged"  // nothing to write (the source key is remembered)
  | "held"       // overwrite not confirmed
  | "stale"      // the project changed since the preview
  | "exists"     // `create` refused: a project with this identity exists now
  | "skipped"    // "do not import this row" recorded (or already on record)
  | "unskipped"  // an earlier exclusion withdrawn
  | "refused";   // the decision is not supported by the evidence / the project is gone
export interface ApplyOutcome {
  ref: number;
  outcome: ApplyOutcomeKind;
  projectId?: number;
  reason?: string;
}
export interface RegisterApplyResult {
  outcomes: ApplyOutcome[];
  counts: Record<ApplyOutcomeKind, number>;
  replayed: boolean;
}

export const emptyCounts = (): Record<ApplyOutcomeKind, number> => ({ created: 0, updated: 0, unchanged: 0, held: 0, stale: 0, exists: 0, skipped: 0, unskipped: 0, refused: 0 });
export { REGISTER_FIELD_KEYS };
