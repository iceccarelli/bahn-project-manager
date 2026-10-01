/**
 * Checklist aggregate (Projektanmeldung) on the shared domain path.
 *
 *   save    create/update a DRAFT. Author (or admin) only. Header + answers are validated against the workbook
 *           vocabulary (unknown question keys are rejected, never stored). Optimistic version on update.
 *   submit  draft → submitted, in ONE transaction: creates the Project (same audit/event as a direct create) and the
 *           14 department reviews decided by the workbook's trigger rule, links them, bumps the checklist version.
 *           Nothing is half-done: a failure anywhere rolls back project, reviews and checklist together.
 *   read    a draft is visible to its author and admins; a submitted checklist to whoever may see its workspace.
 *
 * Events carry `context.recipient` while a checklist is a draft (so only the author's stream/feed sees it) and the
 * workspace once it is submitted.
 */
import { randomUUID } from "node:crypto";
import { EVENT_SCHEMA_VERSION, type DomainEvent, type FieldChange } from "@shared/domain-events";
import { CHECKLIST_BY_KEY, buildDepartmentReviews, type ChecklistAnswers } from "@shared/checklist";
import type { ChecklistDTO, SaveChecklistInput, SubmitChecklistInput } from "@shared/checklist-contract";
import { cleanStr } from "@shared/ingest";
import { normalizeBahnhofsmanagement } from "@shared/bahnhofsmanagement";
import type { ProjectChecklist } from "../../drizzle/schema";
import { AggregateConflictError, ForbiddenError, IdempotencyKeyReuseError, NotFoundError, ValidationError } from "./errors";
import { canEditProject, canViewProject, type Principal } from "./permissions";
import { requestHash, type ProjectService, type RequestContext } from "./projectService";
import type { BookingService } from "./bookingService";
import type { AfterCommit, AuditRow, ProjectStore } from "./ports";

const HEADER_COLS = ["projektnummer", "projektbezeichnung", "stationsname", "bahnhofsnummer", "streckennummer", "projektstand", "bahnhofsmanagement", "projektleitung", "pkpLink", "freischaltungFaa", "unterschriftenblatt", "mitProjektvorstellung", "anmerkungen", "terminVon", "terminBis"] as const;
const DATE_COLS = ["uebergabeDatum", "terminDatum"] as const;

const isAuthorOrAdmin = (p: Principal, c: { createdBy: string | null }) => p.role === "admin" || c.createdBy === p.id;

export class ChecklistService {
  constructor(
    private readonly store: ProjectStore,
    private readonly projects: ProjectService,
    private readonly bookings: BookingService,
    private readonly afterCommit: AfterCommit = () => {},
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async get(p: Principal, id: number): Promise<ChecklistDTO> {
    const c = await this.store.checklistDetail(id);
    if (!c || !this.canSee(p, c)) throw new NotFoundError("Checkliste");
    return c;
  }
  async list(p: Principal, o: { status?: "draft" | "submitted" | "cancelled"; limit?: number } = {}) {
    const { workspaceRestriction } = await import("./permissions");
    return this.store.listChecklists({ workspaces: workspaceRestriction(p), principalId: p.id, isAdmin: p.role === "admin", ...(o.status ? { status: o.status } : {}), limit: o.limit ?? 50 });
  }
  private canSee(p: Principal, c: ChecklistDTO) {
    if (c.status === "draft") return p.role === "admin" || c.createdBy === p.id;
    return canViewProject(p, { bahnhofsmanagement: c.header.bahnhofsmanagement ?? null });
  }

  async save(p: Principal, input: SaveChecklistInput, ctx: RequestContext): Promise<{ checklist: ChecklistDTO; eventId: string; replayed: boolean }> {
    const header = normHeader(input.header as Record<string, string | null | undefined>);
    const answers = normAnswers(input.answers);
    const hash = requestHash("checklist.save", { id: input.id ?? null, v: input.expectedVersion ?? null, m: input.mode, h: header, a: answers });
    const result = await this.store.transaction(async tx => {
      const claim = await tx.claimIdempotency(p.id, input.idempotencyKey, "checklist.save", hash);
      if (claim.state === "mismatch") throw new IdempotencyKeyReuseError();
      if (claim.state === "replay") return { ...(claim.response as { checklist: ChecklistDTO; eventId: string }), replayed: true };

      if (p.role === "viewer") throw new ForbiddenError("Keine Berechtigung zum Anlegen");
      const ws = (header.bahnhofsmanagement as string | null | undefined) ?? null;
      let id: number, version: number, eventType: DomainEvent["eventType"], before: ChecklistDTO | null = null;
      if (input.id === undefined) {
        if (ws !== null && !canEditProject(p, { bahnhofsmanagement: ws })) throw new ForbiddenError("Keine Berechtigung für diese Region");
        if (ws === null && workspaceLimited(p)) throw new ForbiddenError("Bahnhofsmanagement fehlt");
        id = await tx.insertChecklist({ mode: input.mode, status: "draft", createdBy: p.id, ...toColumns(header) });
        version = 1; eventType = "checklist.created";
      } else {
        const cur = await tx.lockChecklist(input.id);
        if (!cur || !isAuthorOrAdmin(p, cur)) throw new NotFoundError("Checkliste");
        if (cur.status !== "draft") throw new AggregateConflictError({ code: "VERSION_CONFLICT", aggregate: "checklist", id: cur.id, expectedVersion: input.expectedVersion ?? 0, currentVersion: cur.syncVersion, current: await tx.checklistDetail(cur.id), reason: "not-draft" });
        if (input.expectedVersion === undefined || cur.syncVersion !== input.expectedVersion) throw new AggregateConflictError({ code: "VERSION_CONFLICT", aggregate: "checklist", id: cur.id, expectedVersion: input.expectedVersion ?? 0, currentVersion: cur.syncVersion, current: await tx.checklistDetail(cur.id), reason: "stale" });
        if (ws !== null && !canEditProject(p, { bahnhofsmanagement: ws })) throw new ForbiddenError("Keine Berechtigung für diese Region");
        before = await tx.checklistDetail(cur.id);
        await tx.updateChecklistVersioned(cur.id, cur.syncVersion, { mode: input.mode, ...toColumns(header) });
        id = cur.id; version = cur.syncVersion + 1; eventType = "checklist.updated";
      }
      await tx.replaceAnswers(id, Object.entries(answers).map(([questionKey, a]) => ({ questionKey, nr: CHECKLIST_BY_KEY[questionKey]!.nr, answer: a.answer, secondary: a.secondary, comment: a.comment })));
      const after = (await tx.checklistDetail(id))!;
      const changes = diffDto(before, after);
      const event = this.event(p, ctx, eventType, id, version, changes, ws, p.id /* draft: author only */);
      await tx.appendAudit(this.audit(p, event, input.id === undefined ? "create" : "update", changes));
      await tx.appendEvent(event);
      const res = { checklist: after, eventId: event.eventId };
      await tx.completeIdempotency(p.id, input.idempotencyKey, res);
      return { ...res, replayed: false };
    });
    if (!result.replayed) this.nudge();
    return result;
  }

  async submit(p: Principal, input: SubmitChecklistInput, ctx: RequestContext): Promise<{ checklist: ChecklistDTO; projectId: number; eventId: string; replayed: boolean }> {
    const hash = requestHash("checklist.submit", { id: input.id, v: input.expectedVersion, slot: input.slot ?? null });
    const result = await this.store.transaction(async tx => {
      const claim = await tx.claimIdempotency(p.id, input.idempotencyKey, "checklist.submit", hash);
      if (claim.state === "mismatch") throw new IdempotencyKeyReuseError();
      if (claim.state === "replay") return { ...(claim.response as { checklist: ChecklistDTO; projectId: number; eventId: string }), replayed: true };

      const cur = await tx.lockChecklist(input.id);
      if (!cur || !isAuthorOrAdmin(p, cur)) throw new NotFoundError("Checkliste");
      const detail = (await tx.checklistDetail(cur.id))!;
      if (cur.status !== "draft") throw new AggregateConflictError({ code: "VERSION_CONFLICT", aggregate: "checklist", id: cur.id, expectedVersion: input.expectedVersion, currentVersion: cur.syncVersion, current: detail, reason: "not-draft" });
      if (cur.syncVersion !== input.expectedVersion) throw new AggregateConflictError({ code: "VERSION_CONFLICT", aggregate: "checklist", id: cur.id, expectedVersion: input.expectedVersion, currentVersion: cur.syncVersion, current: detail, reason: "stale" });
      if (!cur.bahnhofsmanagement) throw new ValidationError("Bahnhofsmanagement ist ein Pflichtfeld", "bahnhofsmanagement");
      if (!cur.stationsname && !cur.projektbezeichnung) throw new ValidationError("Station oder Projektbezeichnung ist ein Pflichtfeld", "stationsname");

      const projectFields = {
        projektnummer: cur.projektnummer, station: cur.stationsname, bahnhofsnummer: cur.bahnhofsnummer, streckennummer: cur.streckennummer,
        projektbeschreibung: cur.projektbezeichnung, projektstand: cur.projektstand, bahnhofsmanagement: cur.bahnhofsmanagement, projektleiter: cur.projektleitung,
        kommentar: cur.anmerkungen, projektLink: cur.pkpLink,
      } as const;
      const norm = Object.fromEntries(Object.entries(projectFields).map(([k, v]) => [k, cleanStr(v)]));
      // the project is created through the Project aggregate's own creation step (same authorization, audit rows and event)
      // ... including its 14 initial reviews: they are recorded in the project's own creation audit rows and event
      const answers: ChecklistAnswers = Object.fromEntries(Object.entries(detail.answers).map(([k, a]) => [k, { answer: a.answer, secondary: (a.secondary as "Ja" | "Nein" | null) ?? null, comment: a.comment }]));
      const reviews = buildDepartmentReviews(answers).map(r => ({ department: r.department, status: r.status, prueferName: null, datum: null }));
      const created = await this.projects.createWithin(tx, p, ctx, norm as never, reviews);

      // optional slot booking, same transaction: if the slot is gone the project, reviews and checklist roll back with it
      if (input.slot) {
        await this.bookings.bookWithin(tx, p, ctx, {
          id: input.slot.id, expectedVersion: input.slot.expectedVersion, status: input.slot.status,
          station: cur.stationsname, projektleitung: cur.projektleitung, projektstand: cur.projektstand,
          info: `${cur.projektleitung ?? ""} - ${cur.stationsname ?? ""} - ${cur.projektstand ?? ""}`, projectId: created.id,
        });
      }
      const ok = await tx.updateChecklistVersioned(cur.id, cur.syncVersion, { status: "submitted", projectId: created.id, submittedAt: this.clock(), submittedBy: p.name || p.email || p.id });
      if (!ok) throw new AggregateConflictError({ code: "VERSION_CONFLICT", aggregate: "checklist", id: cur.id, expectedVersion: input.expectedVersion, currentVersion: cur.syncVersion + 1, current: null, reason: "stale" });
      const after = (await tx.checklistDetail(cur.id))!;
      const changes: Record<string, FieldChange> = { status: { from: "draft", to: "submitted" }, projectId: { from: null, to: String(created.id) } };
      const event = this.event(p, ctx, "checklist.submitted", cur.id, cur.syncVersion + 1, changes, cur.bahnhofsmanagement, null);
      await tx.appendAudit(this.audit(p, event, "update", changes));
      await tx.appendEvent(event);
      const res = { checklist: after, projectId: created.id, eventId: event.eventId };
      await tx.completeIdempotency(p.id, input.idempotencyKey, res);
      return { ...res, replayed: false };
    });
    if (!result.replayed) this.nudge();
    return result;
  }

  private nudge() { try { this.afterCommit(); } catch { /* the relay also polls */ } this.projects; }

  private event(p: Principal, ctx: RequestContext, eventType: DomainEvent["eventType"], id: number, version: number, changes: Record<string, FieldChange>, workspace: string | null, draftRecipient: string | null): DomainEvent {
    return { schemaVersion: EVENT_SCHEMA_VERSION, eventId: randomUUID(), eventType, aggregateType: "checklist", aggregateId: String(id), aggregateVersion: version,
      actorId: p.id, actorName: p.name, timestamp: this.clock().toISOString(), traceId: ctx.traceId, changes, context: { workspace, ...(draftRecipient ? { recipient: draftRecipient } : {}) } };
  }
  private audit(p: Principal, e: DomainEvent, action: AuditRow["action"], changes: Record<string, FieldChange>): AuditRow[] {
    const base = { userId: /^\d+$/.test(p.id) ? Number(p.id) : null, userName: p.name || p.email || p.id, entityType: "checklist" as const, entityId: Number(e.aggregateId), action, eventId: e.eventId, aggregateVersion: e.aggregateVersion, traceId: e.traceId,
      // a draft's trail is private to its author's events (recipient set): never scoped to a workspace
      workspace: e.context?.recipient ? null : (e.context?.workspace ?? null) };
    const rows = Object.entries(changes);
    return rows.length ? rows.map(([field, c]) => ({ ...base, field, oldValue: c.from, newValue: c.to })) : [{ ...base, field: null, oldValue: null, newValue: null }];
  }
}

const workspaceLimited = (p: Principal) => p.role !== "admin" && p.workspaces !== "ALL";

function normHeader(h: Record<string, string | null | undefined>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined) continue;
    if (k === "bahnhofsmanagement") {
      const n = normalizeBahnhofsmanagement(v);
      if (v != null && cleanStr(v) !== null && n.value === null) throw new ValidationError(`Unbekanntes Bahnhofsmanagement: "${v}"`, k);
      out[k] = n.value;
    } else out[k] = cleanStr(v);
  }
  for (const d of DATE_COLS) if (out[d]) { const t = new Date(out[d]!); if (Number.isNaN(t.getTime())) throw new ValidationError(`Ungültiges Datum: "${out[d]}"`, d); out[d] = t.toISOString().slice(0, 10); }
  return out;
}
function normAnswers(a: SaveChecklistInput["answers"]) {
  const out: Record<string, { answer: string | null; secondary: string | null; comment: string | null }> = {};
  for (const [key, v] of Object.entries(a)) {
    const q = CHECKLIST_BY_KEY[key];
    if (!q) throw new ValidationError(`Unbekannte Frage: ${key}`, key);
    if (!q.secondary && v.secondary) throw new ValidationError(`Frage ${key} hat keine zweite Antwort`, key);
    out[key] = { answer: cleanStr(v.answer ?? null), secondary: v.secondary ?? null, comment: cleanStr(v.comment ?? null) };
  }
  return out;
}
function toColumns(h: Record<string, string | null>): Partial<ProjectChecklist> {
  const out: Record<string, unknown> = {};
  for (const c of HEADER_COLS) if (c in h) out[c] = h[c];
  for (const c of DATE_COLS) if (c in h) out[c] = h[c] ? new Date(h[c]!) : null;
  return out as Partial<ProjectChecklist>;
}
function diffDto(before: ChecklistDTO | null, after: ChecklistDTO): Record<string, FieldChange> {
  const out: Record<string, FieldChange> = {};
  for (const [k, v] of Object.entries(after.header)) { const from = before?.header[k] ?? null; if (from !== v) out[k] = { from, to: v }; }
  for (const [k, a] of Object.entries(after.answers)) {
    const b = before?.answers[k];
    for (const f of ["answer", "secondary", "comment"] as const) { const from = b?.[f] ?? null, to = a[f] ?? null; if (from !== to) out[`answer.${k}.${f}`] = { from, to }; }
  }
  if (!before) out.mode = { from: null, to: after.mode };
  return out;
}
