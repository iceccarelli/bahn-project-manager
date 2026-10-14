/**
 * From the preview and the administrator's choices to the rows an apply request carries — pure, so the mapping from
 * "what the screen offered" to "what the server is asked to do" is tested rather than trusted.
 *
 *   open     nothing is sent; the question comes back at the next import
 *   skip     recorded for good (this exact row content), audited
 *   replace  conflict: take the file's values        (update, overwrite)
 *   new      take it as a new registration/project   (create, confirmed)
 *   <id>     ambiguous: this project                 (update, confirmed, overwrite)
 *   wins     a group of undecidable source rows: this row; every other row of the group is excluded for good
 */
import type { RegisterApplyRow, RegisterContext } from "./register-contract";
import type { RegisterRecord } from "./register-import";
import type { PlanRow } from "./register-plan";

export type Choice = "open" | "skip" | "replace" | "new" | "wins" | number;
export interface ReviewRow { plan: PlanRow; record: RegisterRecord; chunk: number }

export interface BuiltRows {
  rows: RegisterApplyRow[];
  /** refs of group winners whose own plan still needs a decision (their losers are excluded; the winner stays a question) */
  winnerNeedsDecision: number[];
}

export function buildApplyRows(
  rows: readonly ReviewRow[],
  choices: Readonly<Record<number, Choice | undefined>>,
  /** the plan of each chosen group winner, judged alone (its siblings excluded) */
  winnerPlans: ReadonlyMap<number, PlanRow> = new Map(),
): BuiltRows {
  const out: RegisterApplyRow[] = [];
  const winnerNeedsDecision: number[] = [];
  const base = { overwrite: false, confirmed: false };
  const byRef = new Map(rows.map((r) => [r.record.ref, r.record]));

  for (const { plan, record } of rows) {
    const c = choices[plan.ref] ?? "open";
    const match = plan.match;
    const update = (overwrite: boolean, confirmed = false): RegisterApplyRow | null =>
      match ? { record, action: "update", target: { projectId: match.projectId, expectedVersion: match.version }, overwrite, confirmed } : null;
    let row: RegisterApplyRow | null = null;

    switch (plan.status) {
      case "add":
        row = { record, action: "create", ...base };
        break;
      case "unchanged":
      case "update":
        row = update(false);
        break;
      case "skipped":
        break; // already on record; only an explicit take-back (handled by the caller) changes that
      case "conflict":
        if (c === "replace") row = update(true);
        else if (c === "new" && plan.basis === "core") row = { record, action: "create", overwrite: false, confirmed: true };
        else if (c === "skip") row = { record, action: "skip", ...base };
        break;
      case "ambiguous": {
        if (plan.sourceRows) {
          if (c === "skip") row = { record, action: "skip", ...base };
          else if (c === "wins") {
            const w = winnerPlans.get(plan.ref);
            if (w?.status === "add") row = { record, action: "create", ...base };
            else if (w && (w.status === "unchanged" || w.status === "update") && w.match) row = { record, action: "update", target: { projectId: w.match.projectId, expectedVersion: w.match.version }, ...base };
            else winnerNeedsDecision.push(plan.ref);
            // every other row of the group is excluded together with the choice
            for (const ref of plan.sourceRows) {
              const other = byRef.get(ref);
              if (ref !== plan.ref && other && choices[ref] !== "wins") out.push({ record: other, action: "skip", ...base });
            }
          }
        } else if (c === "skip") row = { record, action: "skip", ...base };
        else if (c === "new") row = { record, action: "create", overwrite: false, confirmed: true };
        else if (typeof c === "number") {
          const cand = plan.candidates.find((x) => x.projectId === c);
          if (cand) row = { record, action: "update", target: { projectId: cand.projectId, expectedVersion: cand.version }, overwrite: true, confirmed: true };
        }
        break;
      }
    }
    if (row) out.push(row);
  }
  // a row can be asked to be excluded twice (own "skip" and the winner's group exclusion): once is enough
  const seen = new Set<string>();
  return { rows: out.filter((r) => (r.action === "skip" ? (seen.has(`s${r.record.ref}`) ? false : (seen.add(`s${r.record.ref}`), true)) : true)), winnerNeedsDecision };
}

/** "Früher ausgeschlossen" → take-back rows. */
export const unskipRows = (rows: readonly ReviewRow[], refs: ReadonlySet<number>): RegisterApplyRow[] =>
  rows.filter((r) => r.plan.status === "skipped" && refs.has(r.plan.ref)).map((r) => ({ record: r.record, action: "unskip" as const, overwrite: false, confirmed: false }));

/**
 * The identity-only records of a chunk that a request does not act on, for the planner's context (see RegisterContextSchema).
 * Rows that are themselves open questions about the FILE (undecided source groups) and earlier exclusions take no part.
 */
export function contextFor(chunkRows: readonly ReviewRow[], actedOn: ReadonlySet<number>): RegisterContext[] {
  return chunkRows
    .filter((r) => !actedOn.has(r.record.ref) && r.plan.status !== "skipped" && !r.plan.sourceRows)
    .map(({ record: r }) => ({
      ref: r.ref, projektnummer: r.fields.projektnummer, station: r.fields.station, projektbeschreibung: r.fields.projektbeschreibung,
      projektstand: r.fields.projektstand, terminProjektvorstellung: r.fields.terminProjektvorstellung,
    }));
}
