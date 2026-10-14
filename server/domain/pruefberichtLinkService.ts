/**
 * The link between an ITK Prüfbericht and its canonical project (`itk_pruefberichte.projectId`).
 *
 * Same discipline as every other write: authorize → ONE transaction → idempotency claim → row lock → optimistic version →
 * audit rows. Every link, re-link and unlink writes one audit row per report (entityType "pruefbericht", field
 * "projectId", old → new); a repeated request with the same key replays the stored answer; a stale `expectedVersion`
 * is a CONFLICT, never a silent overwrite.
 *
 * Two entry points:
 *   setLink   one report, one person's explicit choice (`manual`). Needs an all-workspaces editor and edit rights on the
 *             target project. Setting the value it already has writes nothing.
 *   autoLink  every unlinked report whose evidence identifies exactly ONE project (`auto`, shared/itk/project-link.ts).
 *             Admin only. Ambiguous and unmatched reports are counted and reported, never linked. A report that already
 *             has a link (manual or auto) is never touched by it.
 *
 * Reports are not part of the Project aggregate and carry no workspace, so no project event is emitted: the project's
 * version does not move when a report is attached. Clients re-read the linked reports when they open a project.
 */
import { indexProjects, matchPruefbericht } from "@shared/itk/project-link";
import type { AutoLinkInput, AutoLinkResult, SetLinkInput, SetLinkResult } from "@shared/itk/pruefbericht-contract";
import { ForbiddenError, IdempotencyKeyReuseError, NotFoundError, StaleVersionError } from "./errors";
import { canBulkLink, canEditProject, canLinkPruefberichte, type Principal } from "./permissions";
import type { AuditRow, ProjectStore, PruefberichtLinkRow } from "./ports";
import { requestHash, type RequestContext } from "./projectService";

const SAMPLE_LIMIT = 50;
const CHUNK = 100;
/** reasons the dialog prints as they are */
const GONE = "Projekt inzwischen gelöscht — nicht zugeordnet";
const CHANGED = "inzwischen geändert — nicht angefasst, bitte erneut starten";

const auditRow = (principal: Principal, ctx: RequestContext, pb: PruefberichtLinkRow, to: number | null, source: "auto" | "manual" | "detached", version: number): AuditRow => ({
  userId: /^\d+$/.test(principal.id) ? Number(principal.id) : null,
  userName: principal.name || principal.email || principal.id,
  entityType: "pruefbericht", entityId: pb.id, action: "update", field: "projectId",
  oldValue: pb.projectId === null ? null : String(pb.projectId), newValue: to === null ? null : String(to),
  eventId: null, aggregateVersion: version, traceId: ctx.traceId,
  // reports have no workspace; a null scope is visible to unrestricted principals only (like the import's audit rows)
  workspace: null,
  entityLabel: `${pb.year} / ${pb.laufendeNummer}${source === "auto" ? " · automatisch" : source === "detached" ? " · bewusst gelöst" : ""}`.slice(0, 255),
});

export class PruefberichtLinkService {
  constructor(private readonly store: ProjectStore) {}

  async setLink(principal: Principal, input: SetLinkInput, ctx: RequestContext): Promise<SetLinkResult> {
    if (!canLinkPruefberichte(principal)) throw new ForbiddenError();
    const hash = requestHash("pruefbericht.setLink", { id: input.id, v: input.expectedVersion, p: input.projectId });
    return this.store.transaction(async (tx) => {
      const claim = await tx.claimIdempotency(principal.id, input.idempotencyKey, "pruefbericht.setLink", hash);
      if (claim.state === "mismatch") throw new IdempotencyKeyReuseError();
      if (claim.state === "replay") return { ...(claim.response as SetLinkResult), replayed: true };

      // lock order everywhere: project, then its reports (project deletion unlinks its reports in that order)
      if (input.projectId !== null) {
        // not visible and not existing are the same answer (no oracle); editing rights on the target are required
        const project = await tx.lockProject(input.projectId);
        if (!project || !canEditProject(principal, project)) throw new NotFoundError();
      }
      const pb = await tx.lockPruefbericht(input.id);
      if (!pb) throw new NotFoundError("Prüfbericht");
      if (pb.version !== input.expectedVersion) throw new StaleVersionError("Prüfbericht", input.expectedVersion, pb.version);

      let res: SetLinkResult;
      if (pb.projectId === input.projectId) {
        res = { id: pb.id, projectId: pb.projectId, version: pb.version, replayed: false };
      } else {
        const ok = await tx.setPruefberichtProject(pb.id, pb.version, { projectId: input.projectId, source: input.projectId === null ? "detached" : "manual" });
        if (!ok) throw new StaleVersionError("Prüfbericht", input.expectedVersion, pb.version + 1);
        await tx.appendAudit([auditRow(principal, ctx, pb, input.projectId, input.projectId === null ? "detached" : "manual", pb.version + 1)]);
        res = { id: pb.id, projectId: input.projectId, version: pb.version + 1, replayed: false };
      }
      await tx.completeIdempotency(principal.id, input.idempotencyKey, res);
      return res;
    });
  }

  async autoLink(principal: Principal, input: AutoLinkInput, ctx: RequestContext): Promise<AutoLinkResult> {
    if (!canBulkLink(principal)) throw new ForbiddenError();
    const hash = requestHash("pruefbericht.autoLink", { dry: input.dryRun });
    return this.store.transaction(async (tx) => {
      if (!input.dryRun) {
        const claim = await tx.claimIdempotency(principal.id, input.idempotencyKey, "pruefbericht.autoLink", hash);
        if (claim.state === "mismatch") throw new IdempotencyKeyReuseError();
        if (claim.state === "replay") return { ...(claim.response as AutoLinkResult), replayed: true };
      }
      const unlinked = await tx.unlinkedPruefberichte();
      const byPn = indexProjects(await tx.projectsForLinking());
      const result: AutoLinkResult = { dryRun: input.dryRun, examined: unlinked.length, linked: 0, ambiguous: { count: 0, samples: [] }, unmatched: {}, replayed: false };
      const unique: Array<{ pb: PruefberichtLinkRow; projectId: number }> = [];
      for (const pb of unlinked) {
        const v = matchPruefbericht(pb, byPn);
        if (v.status === "unique") unique.push({ pb, projectId: v.projectId });
        else if (v.status === "ambiguous") {
          result.ambiguous.count += 1;
          if (result.ambiguous.samples.length < SAMPLE_LIMIT) result.ambiguous.samples.push({ id: pb.id, year: pb.year, laufendeNummer: pb.laufendeNummer, candidates: v.candidateIds.length });
        } else {
          result.unmatched[v.reason] = (result.unmatched[v.reason] ?? 0) + 1;
        }
      }
      if (input.dryRun) {
        result.linked = unique.length;
      } else {
        // Chunks: share-lock the target projects FIRST (a project deleted meanwhile cannot receive a link, and its deletion
        // waits for us), then write each report with its own version guard. A report somebody changed since the snapshot is
        // left alone and counted — one concurrent edit never aborts or rolls back the rest.
        for (let i = 0; i < unique.length; i += CHUNK) {
          const part = unique.slice(i, i + CHUNK);
          const alive = await tx.shareLockProjects([...new Set(part.map((u) => u.projectId))]);
          const audits: AuditRow[] = [];
          for (const { pb, projectId } of part) {
            if (!alive.has(projectId)) { result.unmatched[GONE] = (result.unmatched[GONE] ?? 0) + 1; continue; }
            const ok = await tx.setPruefberichtProject(pb.id, pb.version, { projectId, source: "auto" });
            if (!ok) { result.unmatched[CHANGED] = (result.unmatched[CHANGED] ?? 0) + 1; continue; }
            result.linked += 1;
            audits.push(auditRow(principal, ctx, pb, projectId, "auto", pb.version + 1));
          }
          if (audits.length) await tx.appendAudit(audits);
        }
      }
      if (!input.dryRun) await tx.completeIdempotency(principal.id, input.idempotencyKey, result);
      return result;
    });
  }
}
