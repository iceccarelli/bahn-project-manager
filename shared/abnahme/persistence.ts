import { z } from "zod";
import { ABNAHME_STATUS, ABNAHME_TECHNIKEN, type AbnahmeAnswers } from "./types";

/**
 * The shape an Abnahme takes once it is stored. First increment: this file is
 * the contract only — nothing writes it to the server. It is used today to
 * validate what the browser hands back from sessionStorage, so the exact bytes a
 * later `abnahme_records` row would hold are already exercised.
 *
 * Later (docs/abnahme.md): one row per (projectId, technik), `answers` as JSON
 * or one child row per item, optimistic `version` as in projectSyncEngine, and
 * an AUDIT_ACTIONS entry per save.
 */
export const ItemStateSchema = z.object({
  selected: z.enum(ABNAHME_STATUS).nullable(),
  mangel: z.string().max(2000),
});

export const AbnahmeRecordSchema = z.object({
  /** null while the Abnahme is not bound to a project (free session). */
  projectId: z.number().int().positive().nullable(),
  technik: z.enum(ABNAHME_TECHNIKEN),
  templateVersion: z.string().min(1),
  header: z.object({ gewerkAnlage: z.string().max(200), errichter: z.string().max(200) }),
  answers: z.record(z.string(), ItemStateSchema),
});
export type AbnahmeRecord = z.infer<typeof AbnahmeRecordSchema>;

/**
 * Keeps only answers whose item still exists in the template. A stored set
 * written against an older template must not resurrect answers for questions
 * that were removed, nor crash on them.
 */
export function pruneAnswers(answers: AbnahmeAnswers, knownItemIds: ReadonlySet<string>): AbnahmeAnswers {
  const out: Record<string, AbnahmeAnswers[string]> = {};
  for (const [id, state] of Object.entries(answers)) {
    if (knownItemIds.has(id) && (state.selected !== null || state.mangel !== "")) out[id] = state;
  }
  return out;
}
