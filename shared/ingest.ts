/**
 * The data ingest boundary.
 *
 * Everything the client renders enters through one of two doors: a fetch of
 * /data.json, or a read of the localStorage cache that door writes. Until now
 * neither door checked anything:
 *
 *   normalizeProjects(projects: any[]): Project[]   // ...p spread, then `as Project[]`
 *   return JSON.parse(stored);                      // straight out of localStorage
 *
 * The `as Project[]` was an assertion, not a check — whatever shape arrived
 * became a `Project` as far as the type system was concerned. The localStorage
 * path was worse: a user edits a project (which writes the cache), a later
 * deploy changes the shape, and the stale shape is served from that browser
 * indefinitely with nothing to notice.
 *
 * This module makes the boundary explicit. Rows are validated against
 * ProjectSchema — the same schema shared/data-integrity.test.ts proves accepts
 * all 1,298 production rows — and anything that fails is *reported*, never
 * silently dropped and never silently admitted.
 *
 * Validation checks; it does not transform. Rows are kept as they arrived (not
 * as Zod re-emits them) so that fields outside the schema survive round-trips
 * instead of being stripped on the way through.
 */

import { normalizeBahnhofsmanagement } from "./bahnhofsmanagement";
import { ProjectSchema } from "./validation";

export type IngestedProject = ReturnType<typeof normalizeRow>;

export interface IngestResult<T> {
  projects: T[];
  /** Rows that did not satisfy ProjectSchema, with enough detail to fix them. */
  rejected: Array<{ index: number; id: unknown; reason: string }>;
  /** True when every row validated. Callers use this to decide whether a cache is trustworthy. */
  clean: boolean;
}

/** Values that mean "no answer" in the source workbook rather than a real string. */
const PLACEHOLDER_TOKENS = new Set([
  "",
  "-",
  "--",
  "?",
  "??",
  "???",
  "n/a",
  "na",
  "null",
  "undefined",
  "bitte auswählen",
  "bitte ausfüllen",
]);

export function cleanStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  if (PLACEHOLDER_TOKENS.has(s.toLowerCase())) return null;
  return s;
}

function normalizeRow<T extends Record<string, unknown>>(row: T) {
  const reviews = Array.isArray(row.reviews) ? row.reviews : [];
  return {
    ...row,
    // Canonical BM, so `===` region filters, the station cascade and the map
    // all agree. Never guesses — an unknown value becomes null and is visible
    // as such rather than being assigned to a plausible region.
    bahnhofsmanagement: normalizeBahnhofsmanagement(row.bahnhofsmanagement).value,
    station: cleanStr(row.station),
    projektleiter: cleanStr(row.projektleiter),
    projektstand: cleanStr(row.projektstand),
    projektnummer: cleanStr(row.projektnummer),
    reviews: reviews.map((r: Record<string, unknown>) => ({
      ...r,
      prueferName: cleanStr(r?.prueferName),
      status: cleanStr(r?.status),
    })),
  };
}

/**
 * Validate and normalize a payload of unknown provenance.
 *
 * Accepts either a bare array or the `{ projects: [...] }` envelope, because
 * /data.json has shipped in both shapes.
 */
export function ingestProjects(raw: unknown): IngestResult<IngestedProject> {
  const rows: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { projects?: unknown })?.projects)
      ? ((raw as { projects: unknown[] }).projects)
      : [];

  const projects: IngestedProject[] = [];
  const rejected: IngestResult<IngestedProject>["rejected"] = [];

  rows.forEach((row, index) => {
    if (row === null || typeof row !== "object") {
      rejected.push({ index, id: undefined, reason: `not an object (${typeof row})` });
      return;
    }
    const parsed = ProjectSchema.safeParse(row);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      rejected.push({
        index,
        id: (row as { id?: unknown }).id,
        reason: first ? `${first.path.join(".") || "<root>"}: ${first.message}` : "invalid",
      });
      return;
    }
    // Normalize the row as it arrived, not Zod's re-emission: z.object strips
    // keys it does not declare, and dropping a field the UI reads would be a
    // silent data loss dressed up as validation.
    projects.push(normalizeRow(row as Record<string, unknown>));
  });

  return { projects, rejected, clean: rejected.length === 0 };
}

/**
 * One-line summary for logs. Deliberately says the count out loud: a cache that
 * quietly drops 40 rows looks identical to a healthy one otherwise.
 */
export function describeIngest(result: IngestResult<unknown>): string {
  if (result.clean) return `${result.projects.length} Projekte geladen`;
  const sample = result.rejected
    .slice(0, 3)
    .map((r) => `#${r.id ?? r.index} (${r.reason})`)
    .join(", ");
  return `${result.projects.length} Projekte geladen, ${result.rejected.length} verworfen: ${sample}${
    result.rejected.length > 3 ? " …" : ""
  }`;
}
