/** Projektanmeldung checklist aggregate contract. */
import { z } from "zod";
import { CHECKLIST_MODES } from "./checklist";

const idempotencyKey = z.string().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
const t = (n: number) => z.string().trim().max(n).nullable().optional();

export const ChecklistHeaderSchema = z.object({
  projektnummer: t(256), projektbezeichnung: t(512), stationsname: t(256), bahnhofsnummer: t(32), streckennummer: t(32),
  projektstand: t(128), bahnhofsmanagement: t(128), projektleitung: t(256),
  pkpLink: t(2000), freischaltungFaa: t(64), unterschriftenblatt: t(64), mitProjektvorstellung: t(8), anmerkungen: t(4000),
  uebergabeDatum: t(40), terminDatum: t(40), terminVon: t(8), terminBis: t(8),
}).strict();
export type ChecklistHeader = z.infer<typeof ChecklistHeaderSchema>;

export const ChecklistAnswerInputSchema = z.object({
  answer: z.string().max(512).nullable(),
  secondary: z.enum(["Ja", "Nein"]).nullable().optional(),
  comment: z.string().max(4000).nullable().optional(),
});
export const ChecklistAnswersInputSchema = z.record(z.string().min(1).max(64), ChecklistAnswerInputSchema);

export const SaveChecklistInputSchema = z.object({
  /** absent = create a new draft */
  id: z.number().int().positive().optional(),
  expectedVersion: z.number().int().min(1).optional(),
  mode: z.enum(CHECKLIST_MODES),
  header: ChecklistHeaderSchema.default({}),
  answers: ChecklistAnswersInputSchema.default({}),
  idempotencyKey,
});
export type SaveChecklistInput = z.infer<typeof SaveChecklistInputSchema>;

export const SubmitChecklistInputSchema = z.object({ id: z.number().int().positive(), expectedVersion: z.number().int().min(1), idempotencyKey });
export type SubmitChecklistInput = z.infer<typeof SubmitChecklistInputSchema>;

export interface ChecklistDTO {
  id: number;
  version: number;
  mode: (typeof CHECKLIST_MODES)[number];
  status: "draft" | "submitted" | "cancelled";
  projectId: number | null;
  header: Record<string, string | null>;
  answers: Record<string, { answer: string | null; secondary: string | null; comment: string | null }>;
  createdBy: string | null;
  submittedAt: string | null;
  updatedAt: string;
}
