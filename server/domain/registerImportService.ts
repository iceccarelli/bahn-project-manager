/**
 * Übersichtsliste import — the bulk write path, built from the SAME domain transitions as a single edit.
 *
 *   preview   read-only: plan the records against the database (shared/register/register-plan.ts) and say, per record,
 *             what would happen and why. Admin only.
 *   apply     one transaction per chunk: claim the idempotency key → load candidates → RE-PLAN under the transaction (the
 *             preview is advice, never an instruction) → per record: create through `ProjectService.createWithin`, or
 *             lock the project, check its version and apply through `ProjectService.updateWithin` — audit rows, one
 *             `project.updated`/`created` event per project, read models and watcher notifications as for any edit →
 *             remember the source key → store the idempotent response → COMMIT. The outbox relay is nudged afterwards.
 *
 * What the server refuses to do on the client's word: create a project when the evidence now says one exists; update a
 * project that is not the planned match (unless the administrator picked it among the listed candidates); update a project
 * that changed since the preview (`stale`); replace a non-empty value without `overwrite`. Blank incoming cells never clear.
 */
import { createHash } from "node:crypto";
import { fullKey } from "@shared/project-identity";
import { DEPARTMENTS } from "@shared/validation";
import { ProjectPatchSchema, type EditableProjectField } from "@shared/project-contract";
import { REGISTER_SOURCE, type RegisterRecord } from "@shared/register/register-import";
import {
  emptyCounts, type ApplyOutcome, type RegisterApplyInput, type RegisterApplyResult, type RegisterContext, type RegisterPreviewInput,
} from "@shared/register/register-contract";
import { contentKey, diffRecord, planRegister, summarizePlan, type ExistingProject, type PlanRow, type PlanSummary } from "@shared/register/register-plan";
import { ForbiddenError, IdempotencyKeyReuseError, ValidationError } from "./errors";
import { canEditProject, canImportRegister, type Principal } from "./permissions";
import type { ProjectService, RequestContext } from "./projectService";
import { normalizePatch, requestHash } from "./projectService";
import type { ProjectStore } from "./ports";
import type { Project } from "../../drizzle/schema";
import { normalizeBahnhofsmanagement } from "@shared/bahnhofsmanagement";

/** The stored form of a registration's identity: fixed width, no readable project data in the key table. */
export const sourceKeyHash = (key: string): string => createHash("sha256").update(key).digest("hex");

const keyOf = (r: RegisterRecord) => fullKey({ ...r.fields });
/** "skip:" keeps the two kinds of key in different hash spaces: a row's identity and a row's exact content can never collide. */
const skipHashOf = (r: RegisterRecord) => sourceKeyHash(`skip:${contentKey(r)}`);

/** Re-validates what the browser sent against the app's own project schema; a record that would fail on write fails the request now. */
function assertValid(records: readonly RegisterRecord[]) {
  const refs = new Set<number>();
  for (const r of records) {
    if (refs.has(r.ref)) throw new ValidationError(`Zeile ${r.ref} kommt in dieser Anfrage zweimal vor`, "ref");
    refs.add(r.ref);
    const parsed = ProjectPatchSchema.safeParse(Object.fromEntries(Object.entries(r.fields).filter(([, v]) => v !== null)));
    if (!parsed.success) throw new ValidationError(`Zeile ${r.ref}: ${parsed.error.issues[0]?.message ?? "ungültig"}`, String(parsed.error.issues[0]?.path[0] ?? ""));
    const bm = normalizeBahnhofsmanagement(r.fields.bahnhofsmanagement);
    if (r.fields.bahnhofsmanagement !== null && bm.value !== r.fields.bahnhofsmanagement) throw new ValidationError(`Zeile ${r.ref}: Bahnhofsmanagement „${r.fields.bahnhofsmanagement}“ ist nicht kanonisch`, "bahnhofsmanagement");
    for (const d of Object.keys(r.reviews)) if (!(DEPARTMENTS as readonly string[]).includes(d)) throw new ValidationError(`Zeile ${r.ref}: unbekanntes Gewerk ${d}`, d);
  }
}

export class RegisterImportService {
  constructor(
    private readonly store: ProjectStore,
    private readonly projects: ProjectService,
  ) {}

  private lookupOf(records: readonly RegisterRecord[]) {
    return {
      hints: records.map((r) => ({ projektnummer: r.fields.projektnummer, station: r.fields.station })),
      keyHashes: records.map((r) => sourceKeyHash(keyOf(r))),
      skipHashes: records.map(skipHashOf),
    };
  }

  /** identity-only stand-ins for the records of the chunk the request does not act on; never acted on, never reported */
  private withContext(records: RegisterRecord[], context: readonly RegisterContext[] | undefined): RegisterRecord[] {
    const have = new Set(records.map((r) => r.ref));
    const extra = (context ?? []).filter((c) => !have.has(c.ref)).map((c): RegisterRecord => ({
      ref: c.ref, reviews: {},
      fields: { projektnummer: c.projektnummer, bahnhofsmanagement: null, station: c.station, bahnhofsnummer: null, streckennummer: null, projektbeschreibung: c.projektbeschreibung, projektstand: c.projektstand, projektleiter: null, terminProjektvorstellung: c.terminProjektvorstellung, kommentar: null, projektLink: null },
    }));
    return [...records, ...extra];
  }

  /** hashed owners → plain-key owners, as the pure planner wants them */
  private plan(records: readonly RegisterRecord[], found: { projects: ExistingProject[]; keyOwners: Map<string, number[]>; skipped: Set<string> }): PlanRow[] {
    const owners = new Map<string, readonly number[]>();
    const skips = new Set<string>();
    for (const r of records) {
      const ids = found.keyOwners.get(sourceKeyHash(keyOf(r)));
      if (ids?.length) owners.set(keyOf(r), ids);
      if (found.skipped.has(skipHashOf(r))) skips.add(contentKey(r));
    }
    return planRegister(records, found.projects, owners, skips);
  }

  async preview(principal: Principal, input: RegisterPreviewInput): Promise<{ rows: PlanRow[]; summary: PlanSummary }> {
    if (!canImportRegister(principal)) throw new ForbiddenError();
    assertValid(input.records);
    const all = this.withContext(input.records, input.context);
    const found = await this.store.registerCandidates(REGISTER_SOURCE, this.lookupOf(all));
    const asked = new Set(input.records.map((r) => r.ref));
    const rows = this.plan(all, found).filter((p) => asked.has(p.ref));
    return { rows, summary: summarizePlan(rows) };
  }

  async apply(principal: Principal, input: RegisterApplyInput, ctx: RequestContext): Promise<RegisterApplyResult> {
    if (!canImportRegister(principal)) throw new ForbiddenError();
    const records = input.rows.map((r) => r.record);
    assertValid(records);
    const hash = requestHash("project.registerApply", { rows: input.rows });

    const result = await this.store.transaction(async (tx) => {
      const claim = await tx.claimIdempotency(principal.id, input.idempotencyKey, "project.registerApply", hash);
      if (claim.state === "mismatch") throw new IdempotencyKeyReuseError();
      if (claim.state === "replay") return { ...(claim.response as RegisterApplyResult), replayed: true };

      // the plan of THIS transaction, for the whole chunk at once (so "claimed by another record's exact match" holds)
      const actingRows = input.rows.filter((r) => r.action !== "skip" && r.action !== "unskip").map((r) => r.record);
      const planRecords = this.withContext(actingRows, input.context);
      const found = await tx.registerCandidates(REGISTER_SOURCE, this.lookupOf(planRecords));
      // rows that are themselves decisions ("do not import this" / "take it back") take no part in the plan: the winner of a
      // group is judged without the loser the administrator is excluding in the same request
      const plan = this.plan(planRecords, found);
      const byRef = new Map(plan.map((p) => [p.ref, p]));
      const candidate = new Map(found.projects.map((p) => [p.id, p]));

      const outcomes: ApplyOutcome[] = [];
      const counts = emptyCounts();
      const done = (o: ApplyOutcome) => {
        outcomes.push(o);
        counts[o.outcome] += 1;
      };

      for (const row of input.rows) {
        const rec = row.record;
        const planned = byRef.get(rec.ref) as PlanRow; // undefined for skip/unskip rows, which never read it
        const remember = (projectId: number) => tx.recordSourceKeys(REGISTER_SOURCE, [{ projectId, keyHash: sourceKeyHash(keyOf(rec)) }]);

        if (row.action === "skip" || row.action === "unskip") {
          const label = `${rec.fields.station ?? "—"} · ${rec.fields.projektnummer ?? "ohne Nr."} · ${rec.fields.projektstand ?? "—"}`;
          const hash = skipHashOf(rec);
          const changed = row.action === "skip" ? await tx.recordSourceKeys(REGISTER_SOURCE, [{ projectId: null, keyHash: hash, kind: "skip" }]) : await tx.deleteSkipKeys(REGISTER_SOURCE, [hash]);
          if (changed > 0) {
            await tx.appendAudit([{
              userId: /^\d+$/.test(principal.id) ? Number(principal.id) : null, userName: principal.name || principal.email || principal.id,
              entityType: "project", entityId: 0, action: "update", field: row.action === "skip" ? "import.skip" : "import.unskip", oldValue: null,
              newValue: JSON.stringify({ zeile: rec.ref, station: rec.fields.station, projektnummer: rec.fields.projektnummer, projektstand: rec.fields.projektstand }).slice(0, 500),
              eventId: null, aggregateVersion: null, traceId: ctx.traceId, workspace: null, entityLabel: label.slice(0, 255),
            }]);
          }
          done({ ref: rec.ref, outcome: row.action === "skip" ? "skipped" : "unskipped" });
          continue;
        }

        if (planned.status === "skipped") {
          done({ ref: rec.ref, outcome: "held", reason: planned.reason });
          continue;
        }

        if (row.action === "create") {
          // "add" on the evidence, or an explicit "this is a new registration/project" for a row the evidence left open:
          // ambiguous, or the same job whose Projektstand/Termin moved on (a core match held as a conflict)
          const newRegistrationAllowed = row.confirmed && (planned.status === "ambiguous" || (planned.status === "conflict" && planned.basis === "core"));
          if (planned.status !== "add" && !newRegistrationAllowed) {
            done({ ref: rec.ref, outcome: "exists", reason: planned.reason ?? "Ein Projekt mit dieser Identität existiert inzwischen" });
            continue;
          }
          const fields = Object.fromEntries(Object.entries(rec.fields).filter(([, v]) => v !== null)) as Partial<Record<EditableProjectField, string | null>>;
          const reviews = Object.entries(rec.reviews).map(([department, r]) => ({
            department, status: r.status, prueferName: r.prueferName, datum: r.datum ? new Date(r.datum) : null,
          }));
          const { id } = await this.projects.createWithin(tx, principal, ctx, normalizeFields(fields), reviews);
          await remember(id);
          done({ ref: rec.ref, outcome: "created", projectId: id });
          continue;
        }

        // action === "update"
        const target = row.target as NonNullable<typeof row.target>;
        const isPlannedMatch = planned.match?.projectId === target.projectId;
        const isListedCandidate = planned.candidates.some((c) => c.projectId === target.projectId);
        if (!isPlannedMatch && !(row.confirmed && isListedCandidate)) {
          done({ ref: rec.ref, outcome: "refused", projectId: target.projectId, reason: "Das Zielprojekt ist nach den vorliegenden Angaben nicht die Zuordnung dieses Datensatzes" });
          continue;
        }
        const current = await tx.lockProject(target.projectId);
        if (!current) {
          done({ ref: rec.ref, outcome: "refused", projectId: target.projectId, reason: "Das Projekt existiert nicht mehr" });
          continue;
        }
        const snapshot = candidate.get(target.projectId);
        if (current.syncVersion !== target.expectedVersion || (snapshot && snapshot.version !== current.syncVersion)) {
          done({ ref: rec.ref, outcome: "stale", projectId: target.projectId, reason: `Das Projekt wurde inzwischen geändert (Version ${target.expectedVersion} → ${current.syncVersion})` });
          continue;
        }
        if (!canEditProject(principal, current)) throw new ForbiddenError();

        const changes = snapshot ? diffRecord(snapshot, rec) : [];
        if (changes.some((c) => c.kind === "overwrite") && !row.overwrite) {
          done({ ref: rec.ref, outcome: "held", projectId: target.projectId, reason: "Der Import würde vorhandene Werte ersetzen — nicht bestätigt" });
          continue;
        }
        if (changes.length === 0) {
          await remember(target.projectId);
          done({ ref: rec.ref, outcome: "unchanged", projectId: target.projectId });
          continue;
        }
        await this.projects.updateWithin(tx, principal, ctx, current as Project, splitChanges(changes));
        await remember(target.projectId);
        done({ ref: rec.ref, outcome: "updated", projectId: target.projectId });
      }

      await tx.appendAudit([{
        userId: /^\d+$/.test(principal.id) ? Number(principal.id) : null, userName: principal.name || principal.email || principal.id,
        entityType: "project", entityId: 0, action: "create", field: "import", oldValue: null, newValue: JSON.stringify(counts),
        eventId: null, aggregateVersion: null, traceId: ctx.traceId, workspace: null,
        entityLabel: `${input.source} · Teil ${input.part.index}/${input.part.total}`.slice(0, 255),
      }]);
      const res: RegisterApplyResult = { outcomes, counts, replayed: false };
      await tx.completeIdempotency(principal.id, input.idempotencyKey, res);
      return res;
    });

    if (!result.replayed && (result.counts.created > 0 || result.counts.updated > 0)) this.projects.nudgeAfterCommit();
    return result;
  }
}

/** The planner's change list → the field patch and review writes `updateWithin` takes. Values are exactly the incoming ones. */
function splitChanges(changes: ReturnType<typeof diffRecord>): Parameters<ProjectService["updateWithin"]>[4] {
  const fields: Partial<Record<EditableProjectField, string | null>> = {};
  const reviews = new Map<string, { department: string; status?: string; prueferName?: string; datum?: string }>();
  for (const c of changes) {
    const m = /^review\.([^.]+)\.(status|prueferName|datum)$/.exec(c.key);
    if (m) {
      const r = reviews.get(m[1] as string) ?? { department: m[1] as string };
      (r as Record<string, string>)[m[2] as string] = c.to;
      reviews.set(m[1] as string, r);
    } else fields[c.key as EditableProjectField] = c.to;
  }
  return { fields, reviews: [...reviews.values()] };
}

/** Create-time normalisation is `normalizePatch`, the one canonicalisation layer of every project write. */
function normalizeFields(fields: Partial<Record<EditableProjectField, string | null>>) {
  return normalizePatch(fields as Record<string, string | null | undefined>);
}
