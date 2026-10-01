/**
 * MySQL/MariaDB adapter for ProjectStore. All SQL for the Project slice lives
 * here; the domain layer sees only the ProjectStore/ProjectTx ports.
 */
import { and, asc, desc, eq, gt, inArray, lt, lte, or, sql, type SQL } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { DomainEventSchema, type DomainEvent } from "@shared/domain-events";
import {
  MAX_PAGE_SIZE,
  type ListProjectsInput,
  type ProjectDetail,
  type ProjectListItem,
  type ProjectSummary,
} from "@shared/project-contract";
import {
  auditLog, departmentReviews, projectChecklists, projectChecklistAnswers, scheduleSlots, type ProjectChecklist, type ScheduleSlot, domainEvents, idempotencyKeys, notifications, notificationUnread, projects, projectWatchers, type Project,
} from "../../drizzle/schema";
import type { AuditRow, IdempotencyClaim, ProjectStore, ProjectTx } from "../domain/ports";
import { syncProjectGeo } from "./geoModel";
import type { ChecklistDTO } from "@shared/checklist-contract";
import type { SlotDTO } from "@shared/booking-contract";
import { clusterCellDegrees, MAP_MAX_MARKERS, MAP_POINT_ZOOM, type MapQuery, type MapResult, type MapStation, type MapStationProjects, type MapStationQuery } from "@shared/map-contract";
import * as rm from "./readModels";

type Db = MySql2Database<Record<string, never>>;
// drizzle's transaction handle has the same query surface as the db
type Executor = Pick<Db, "select" | "insert" | "update" | "delete" | "execute">;

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** Wire form of a date column: yyyy-mm-dd at midnight UTC, full ISO otherwise. */
export function dateToWire(d: Date | null | undefined): string | null {
  if (!d) return null;
  const s = d.toISOString();
  return s.endsWith("T00:00:00.000Z") ? s.slice(0, 10) : s;
}

/** Only the columns a list row needs: no fullRowData, no free-text blobs. */
const SUMMARY_COLUMNS = {
  id: projects.id,
  syncVersion: projects.syncVersion,
  projektnummer: projects.projektnummer,
  bahnhofsmanagement: projects.bahnhofsmanagement,
  station: projects.station,
  projektstand: projects.projektstand,
  projektleiter: projects.projektleiter,
  terminProjektvorstellung: projects.terminProjektvorstellung,
  updatedAt: projects.updatedAt,
};
const DETAIL_COLUMNS = {
  bahnhofsnummer: projects.bahnhofsnummer,
  streckennummer: projects.streckennummer,
  projektbeschreibung: projects.projektbeschreibung,
  eigvEinstufung: projects.eigvEinstufung,
  kommentar: projects.kommentar,
  projektLink: projects.projektLink,
  createdAt: projects.createdAt,
};
const TABLE_COLUMNS = {
  bahnhofsnummer: projects.bahnhofsnummer,
  streckennummer: projects.streckennummer,
  projektbeschreibung: projects.projektbeschreibung,
  kommentar: projects.kommentar,
  projektLink: projects.projektLink,
};
type SummaryRow = Pick<Project, keyof typeof SUMMARY_COLUMNS>;

export function toSummary(p: SummaryRow): ProjectSummary {
  return {
    id: p.id,
    version: p.syncVersion,
    projektnummer: p.projektnummer,
    bahnhofsmanagement: p.bahnhofsmanagement,
    station: p.station,
    projektstand: p.projektstand,
    projektleiter: p.projektleiter,
    terminProjektvorstellung: dateToWire(p.terminProjektvorstellung),
    updatedAt: p.updatedAt.toISOString(),
  };
}

async function loadDetail(x: Executor, id: number): Promise<ProjectDetail | null> {
  const rows = await x.select().from(projects).where(eq(projects.id, id)).limit(1);
  const p = rows[0];
  if (!p) return null;
  const reviews = await x
    .select()
    .from(departmentReviews)
    .where(eq(departmentReviews.projectId, id))
    .orderBy(asc(departmentReviews.department));
  return {
    ...toSummary(p),
    bahnhofsnummer: p.bahnhofsnummer,
    streckennummer: p.streckennummer,
    projektbeschreibung: p.projektbeschreibung,
    eigvEinstufung: p.eigvEinstufung,
    kommentar: p.kommentar,
    projektLink: p.projektLink,
    createdAt: p.createdAt.toISOString(),
    reviews: reviews.map(r => ({
      id: r.id,
      department: r.department,
      prueferName: r.prueferName,
      datum: dateToWire(r.datum),
      status: r.status,
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}

const parseEnvelope = (raw: unknown): DomainEvent =>
  DomainEventSchema.parse(typeof raw === "string" ? JSON.parse(raw) : raw);

async function loadEventsSince(x: Executor, aggregateId: number, after: number, limit: number) {
  const rows = await x
    .select({ envelope: domainEvents.envelope })
    .from(domainEvents)
    .where(
      and(
        eq(domainEvents.aggregateType, "project"),
        eq(domainEvents.aggregateId, aggregateId),
        gt(domainEvents.aggregateVersion, after),
      ),
    )
    .orderBy(asc(domainEvents.aggregateVersion))
    .limit(limit);
  return rows.map(r => parseEnvelope(r.envelope));
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function toSlotDTO(r: ScheduleSlot, redacted = false): SlotDTO {
  return {
    id: r.id, slotKey: r.slotKey, version: r.syncVersion, datum: ymd(r.datum), von: r.von, bis: r.bis, status: r.status,
    station: redacted ? null : r.station, projektleitung: redacted ? null : r.projektleitung, projektstand: redacted ? null : r.projektstand,
    info: redacted ? null : r.info, hinweis: redacted ? null : r.hinweis, projectId: redacted ? null : r.projectId, redacted,
  };
}

const HEADER_FIELDS = ["projektnummer", "projektbezeichnung", "stationsname", "bahnhofsnummer", "streckennummer", "projektstand", "bahnhofsmanagement", "projektleitung", "pkpLink", "freischaltungFaa", "unterschriftenblatt", "mitProjektvorstellung", "anmerkungen"] as const;
async function loadChecklist(x: Executor, id: number): Promise<ChecklistDTO | null> {
  const [r] = await x.select().from(projectChecklists).where(eq(projectChecklists.id, id)).limit(1);
  if (!r) return null;
  const answers = await x.select().from(projectChecklistAnswers).where(eq(projectChecklistAnswers.checklistId, id)).orderBy(asc(projectChecklistAnswers.nr));
  return toChecklistDTO(r, answers);
}
function toChecklistDTO(r: ProjectChecklist, answers: Array<{ questionKey: string; answer: string | null; secondary: string | null; comment: string | null }>): ChecklistDTO {
  const header: Record<string, string | null> = Object.fromEntries(HEADER_FIELDS.map(f => [f, (r as unknown as Record<string, string | null>)[f] ?? null]));
  for (const f of ["uebergabeDatum", "terminDatum"] as const) header[f] = r[f] ? r[f]!.toISOString().slice(0, 10) : null;
  header.terminVon = r.terminVon; header.terminBis = r.terminBis;
  return {
    id: r.id, version: r.syncVersion, mode: r.mode as ChecklistDTO["mode"], status: r.status, projectId: r.projectId, header,
    answers: Object.fromEntries(answers.map(a => [a.questionKey, { answer: a.answer, secondary: a.secondary, comment: a.comment }])),
    createdBy: r.createdBy, submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null, updatedAt: r.updatedAt.toISOString(),
  };
}

function txAdapter(x: Executor): ProjectTx {
  return {
    async lockSlot(id) {
      const rows = await x.select().from(scheduleSlots).where(eq(scheduleSlots.id, id)).limit(1).for("update");
      return rows[0] ?? null;
    },
    async updateSlotVersioned(id, expectedVersion, set) {
      const [res] = await x.update(scheduleSlots).set({ ...set, syncVersion: expectedVersion + 1 }).where(and(eq(scheduleSlots.id, id), eq(scheduleSlots.syncVersion, expectedVersion)));
      return (res as unknown as { affectedRows: number }).affectedRows === 1;
    },
    async lockChecklist(id) {
      const rows = await x.select().from(projectChecklists).where(eq(projectChecklists.id, id)).limit(1).for("update");
      return rows[0] ?? null;
    },
    async insertChecklist(values) {
      const [res] = await x.insert(projectChecklists).values({ mode: "Projektanmeldung", ...values, syncVersion: 1 } as typeof projectChecklists.$inferInsert);
      return Number((res as unknown as { insertId: number }).insertId);
    },
    async updateChecklistVersioned(id, expectedVersion, set) {
      const [res] = await x.update(projectChecklists).set({ ...set, syncVersion: expectedVersion + 1 }).where(and(eq(projectChecklists.id, id), eq(projectChecklists.syncVersion, expectedVersion)));
      return (res as unknown as { affectedRows: number }).affectedRows === 1;
    },
    async replaceAnswers(checklistId, rows) {
      await x.delete(projectChecklistAnswers).where(eq(projectChecklistAnswers.checklistId, checklistId));
      if (rows.length) await x.insert(projectChecklistAnswers).values(rows.map(r => ({ checklistId, ...r })));
    },
    checklistDetail: id => loadChecklist(x, id),
    async lockProject(id) {
      const rows = await x.select().from(projects).where(eq(projects.id, id)).limit(1).for("update");
      return rows[0] ?? null;
    },
    async updateVersioned(id, expectedVersion, set) {
      // read models follow workspace/station changes: capture the "before" while the row is still locked by the caller
      const moves = "bahnhofsmanagement" in set || "station" in set;
      let before: { bm: string | null; station: string | null } | null = null;
      if (moves) {
        const [pre] = await x.select({ bm: projects.bahnhofsmanagement, station: projects.station }).from(projects).where(eq(projects.id, id)).limit(1);
        before = pre ?? null;
      }
      const [res] = await x
        .update(projects)
        .set({ ...set, syncVersion: expectedVersion + 1 })
        .where(and(eq(projects.id, id), eq(projects.syncVersion, expectedVersion)));
      // mysql2 reports matched rows in affectedRows (CLIENT_FOUND_ROWS default)
      const ok = (res as unknown as { affectedRows: number }).affectedRows === 1;
      if (ok && before) {
        const bm = "bahnhofsmanagement" in set ? (set.bahnhofsmanagement ?? null) : before.bm;
        const station = "station" in set ? (set.station ?? null) : before.station;
        if (bm !== before.bm) await rm.moveWorkspace(x, id, before.bm, bm);
        if (bm !== before.bm || station !== before.station) await syncProjectGeo(x, id, station, bm);
      }
      return ok;
    },
    async insertProject(values) {
      const [res] = await x.insert(projects).values({ ...values, syncVersion: 1 } as typeof projects.$inferInsert);
      const id = Number((res as unknown as { insertId: number }).insertId);
      await rm.projectDelta(x, values.bahnhofsmanagement ?? null, 1);
      await syncProjectGeo(x, id, values.station ?? null, values.bahnhofsmanagement ?? null);
      return id;
    },
    async deleteProject(id) {
      const [pre] = await x.select({ bm: projects.bahnhofsmanagement }).from(projects).where(eq(projects.id, id)).limit(1);
      if (pre) await rm.removeProject(x, id, pre.bm); // BEFORE the rows disappear
      await x.execute(sql`DELETE FROM project_geo WHERE projectId = ${id}`);
      await x.delete(departmentReviews).where(eq(departmentReviews.projectId, id));
      await x.delete(projectWatchers).where(eq(projectWatchers.projectId, id));
      await x.delete(projects).where(eq(projects.id, id));
    },
    async watchersOf(projectId) {
      const rows = await x.select({ u: projectWatchers.userId }).from(projectWatchers).where(eq(projectWatchers.projectId, projectId));
      return rows.map(r => r.u);
    },
    async insertNotification(row) {
      const [res] = await x.insert(notifications).values({ ...row, kind: row.kind as never, createdAt: new Date() });
      await x.execute(sql`INSERT INTO notification_unread (userId, workspace, n) VALUES (${row.userId}, ${row.workspace ?? ""}, 1) ON DUPLICATE KEY UPDATE n = n + 1`);
      return Number((res as unknown as { insertId: number }).insertId);
    },
    async lockReview(projectId, department) {
      const rows = await x
        .select()
        .from(departmentReviews)
        .where(and(eq(departmentReviews.projectId, projectId), eq(departmentReviews.department, department)))
        .limit(1)
        .for("update");
      const r = rows[0];
      return r ? { id: r.id, status: r.status, prueferName: r.prueferName, datum: r.datum } : null;
    },
    async insertReview(projectId, v) {
      const [res] = await x.insert(departmentReviews).values({ projectId, department: v.department, status: v.status, prueferName: v.prueferName, datum: v.datum });
      const [pre] = await x.select({ bm: projects.bahnhofsmanagement }).from(projects).where(eq(projects.id, projectId)).limit(1);
      await rm.reviewDelta(x, { workspace: pre?.bm ?? null, department: v.department, status: v.status, pruefer: v.prueferName }, 1);
      return Number((res as unknown as { insertId: number }).insertId);
    },
    async updateReview(id, set) {
      const [pre] = await x
        .select({ department: departmentReviews.department, status: departmentReviews.status, pruefer: departmentReviews.prueferName, bm: projects.bahnhofsmanagement })
        .from(departmentReviews).innerJoin(projects, eq(projects.id, departmentReviews.projectId)).where(eq(departmentReviews.id, id)).limit(1);
      await x.update(departmentReviews).set(set).where(eq(departmentReviews.id, id));
      if (pre && (("status" in set && (set.status ?? null) !== pre.status) || ("prueferName" in set && (set.prueferName ?? null) !== pre.pruefer))) {
        await rm.reviewDelta(x, { workspace: pre.bm, department: pre.department, status: pre.status, pruefer: pre.pruefer }, -1);
        await rm.reviewDelta(x, { workspace: pre.bm, department: pre.department, status: "status" in set ? (set.status ?? null) : pre.status, pruefer: "prueferName" in set ? (set.prueferName ?? null) : pre.pruefer }, 1);
      }
    },
    detail: id => loadDetail(x, id),
    async appendAudit(rows: AuditRow[]) {
      if (rows.length) await x.insert(auditLog).values(rows);
    },
    async appendEvent(e) {
      await x.insert(domainEvents).values({
        eventId: e.eventId,
        eventType: e.eventType,
        aggregateType: e.aggregateType,
        aggregateId: Number(e.aggregateId),
        aggregateVersion: e.aggregateVersion,
        envelope: e,
        createdAt: new Date(e.timestamp),
      });
    },
    eventsSince: (id, after, limit) => loadEventsSince(x, id, after, limit),
    async claimIdempotency(actorId, key, operation, requestHash): Promise<IdempotencyClaim> {
      const [res] = await x
        .insert(idempotencyKeys)
        .ignore()
        .values({ actorId, idempotencyKey: key, operation, requestHash, response: null, createdAt: new Date() });
      if ((res as unknown as { affectedRows: number }).affectedRows === 1) return { state: "new" };
      // Duplicate key: the holder committed (row visible) or we would have
      // inserted. FOR SHARE is a locking read (sees the latest committed row
      // regardless of snapshot) and matches the shared lock INSERT IGNORE
      // already holds on the duplicate — FOR UPDATE here upgrades S→X and
      // deadlocks when several retries race (observed with 10 concurrent).
      // LOCK IN SHARE MODE, not FOR SHARE: the former is accepted by both
      // MySQL 8 and MariaDB.
      const [rows] = (await x.execute(
        sql`SELECT requestHash, operation, response FROM idempotency_keys WHERE actorId = ${actorId} AND idempotencyKey = ${key} LIMIT 1 LOCK IN SHARE MODE`,
      )) as unknown as [Array<{ requestHash: string; operation: string; response: unknown }>];
      const row = rows[0];
      if (!row || row.requestHash !== requestHash || row.operation !== operation) return { state: "mismatch" };
      const response = typeof row.response === "string" ? JSON.parse(row.response) : row.response;
      return { state: "replay", response };
    },
    async completeIdempotency(actorId, key, response) {
      await x
        .update(idempotencyKeys)
        .set({ response })
        .where(and(eq(idempotencyKeys.actorId, actorId), eq(idempotencyKeys.idempotencyKey, key)));
    },
  };
}

/** Terms for BOOLEAN MODE: strip operators, drop tokens the FT index cannot hold (<3). */
export function fulltextQuery(search: string): { boolean: string | null; prefix: string } {
  const tokens = search
    .replace(/[+\-<>()~*"@]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const indexable = tokens.filter(t => t.length >= 3);
  return {
    boolean: indexable.length ? indexable.map(t => `+${t}*`).join(" ") : null,
    prefix: tokens.join(" "),
  };
}

const encodeCursor = (o: { v: string | number; id: number }) =>
  Buffer.from(JSON.stringify(o)).toString("base64url");
function decodeCursor(c: string): { v: string | number; id: number } | null {
  try {
    const o = JSON.parse(Buffer.from(c, "base64url").toString("utf8"));
    if (typeof o?.id === "number" && (typeof o.v === "string" || typeof o.v === "number")) return o;
  } catch { /* fallthrough */ }
  return null;
}

function isDeadlock(err: unknown): boolean {
  for (let e: any = err; e; e = e.cause) if (e.errno === 1213 || e.code === "ER_LOCK_DEADLOCK") return true;
  return false;
}

export class MysqlProjectStore implements ProjectStore {
  constructor(private readonly db: Db) {}

  /**
   * Runs fn in one transaction. A deadlock victim is rolled back in full by
   * the server, so re-running fn from the top is safe; bounded to 3 attempts.
   */
  async transaction<T>(fn: (tx: ProjectTx) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.transaction(t => fn(txAdapter(t as unknown as Executor)));
      } catch (err) {
        if (attempt < 3 && isDeadlock(err)) continue;
        throw err;
      }
    }
  }

  detail(id: number) {
    return loadDetail(this.db, id);
  }

  eventsSince(aggregateId: number, afterVersion: number, limit: number) {
    return loadEventsSince(this.db, aggregateId, afterVersion, limit);
  }

  async versions(ids: number[]) {
    const out = new Map<number, { version: number; bahnhofsmanagement: string | null }>();
    if (!ids.length) return out;
    const rows = await this.db
      .select({ id: projects.id, v: projects.syncVersion, bm: projects.bahnhofsmanagement })
      .from(projects)
      .where(inArray(projects.id, ids));
    for (const r of rows) out.set(r.id, { version: r.v, bahnhofsmanagement: r.bm });
    return out;
  }

  // ---- notifications & watching (reads/writes outside the mutation transaction) ----------------

  async watch(projectId: number, userId: string) {
    await this.db.insert(projectWatchers).ignore().values({ projectId, userId, createdAt: new Date() });
  }
  async unwatch(projectId: number, userId: string) {
    await this.db.delete(projectWatchers).where(and(eq(projectWatchers.projectId, projectId), eq(projectWatchers.userId, userId)));
  }
  async isWatching(projectId: number, userId: string) {
    const r = await this.db.select({ n: sql<number>`1` }).from(projectWatchers).where(and(eq(projectWatchers.projectId, projectId), eq(projectWatchers.userId, userId))).limit(1);
    return r.length > 0;
  }

  /** Newest first, keyset on id. `workspaces`: null = unrestricted; a list re-checks the recipient's CURRENT access. */
  async listNotifications(userId: string, o: { cursor?: number; limit: number; unreadOnly?: boolean }, workspaces: readonly string[] | null) {
    if (workspaces !== null && workspaces.length === 0) return { items: [], nextCursor: null as number | null };
    const conds: SQL[] = [eq(notifications.userId, userId)];
    if (o.cursor) conds.push(lt(notifications.id, o.cursor));
    if (o.unreadOnly) conds.push(sql`${notifications.readAt} IS NULL`);
    if (workspaces !== null) conds.push(inArray(notifications.workspace, [...workspaces]));
    const rows = await this.db.select().from(notifications).where(and(...conds)).orderBy(desc(notifications.id)).limit(o.limit + 1);
    const page = rows.slice(0, o.limit);
    return {
      items: page.map(r => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, createdAt: r.createdAt.toISOString(), read: r.readAt !== null })),
      nextCursor: rows.length > o.limit ? page[page.length - 1]!.id : null,
    };
  }
  async unreadCount(userId: string, workspaces: readonly string[] | null) {
    if (workspaces !== null && workspaces.length === 0) return 0;
    // counter table: a few rows per user (one per workspace), never COUNT(*) over the inbox
    const conds: SQL[] = [eq(notificationUnread.userId, userId)];
    if (workspaces !== null) conds.push(inArray(notificationUnread.workspace, [...workspaces]));
    const [r] = await this.db.select({ n: sql<number>`COALESCE(SUM(${notificationUnread.n}), 0)` }).from(notificationUnread).where(and(...conds));
    return Number(r?.n ?? 0);
  }
  async markRead(userId: string, ids: number[] | "all") {
    await this.db.transaction(async tx => {
      const cond = ids === "all" ? eq(notifications.userId, userId) : and(eq(notifications.userId, userId), inArray(notifications.id, ids));
      // lock the rows we are about to flip, so the counter change below matches exactly what this call changed
      const flipped = await tx.select({ id: notifications.id, ws: notifications.workspace }).from(notifications).where(and(cond, sql`${notifications.readAt} IS NULL`)).for("update");
      if (!flipped.length) return;
      await tx.update(notifications).set({ readAt: new Date() }).where(inArray(notifications.id, flipped.map(f => f.id)));
      const by = new Map<string, number>();
      for (const f of flipped) by.set(f.ws ?? "", (by.get(f.ws ?? "") ?? 0) + 1);
      for (const [w, n] of by) await tx.execute(sql`UPDATE notification_unread SET n = GREATEST(0, n - ${n}) WHERE userId = ${userId} AND workspace = ${w}`);
    });
  }

  async filterOptions(workspaces: readonly string[]) {
    if (workspaces.length === 0) return { regions: [], projektleiter: [], pruefer: [] };
    const bm = inArray(projects.bahnhofsmanagement, [...workspaces]);
    const leaders = await this.db.selectDistinct({ v: projects.projektleiter }).from(projects).where(and(bm, sql`${projects.projektleiter} IS NOT NULL AND ${projects.projektleiter} != ''`)).orderBy(asc(projects.projektleiter));
    const pruefer = await this.db.selectDistinct({ v: departmentReviews.prueferName }).from(departmentReviews).innerJoin(projects, eq(projects.id, departmentReviews.projectId))
      .where(and(bm, sql`${departmentReviews.prueferName} IS NOT NULL AND ${departmentReviews.prueferName} != '' AND ${departmentReviews.prueferName} != 'Zuordnung erforderlich'`)).orderBy(asc(departmentReviews.prueferName));
    return { regions: [...workspaces], projektleiter: leaders.map(l => l.v!).filter(Boolean), pruefer: pruefer.map(l => l.v!).filter(Boolean) };
  }

  async feedHead() {
    const [row] = await this.db.select({ h: sql<number>`COALESCE(MAX(${domainEvents.feedSeq}), 0)` }).from(domainEvents);
    return Number(row?.h ?? 0);
  }

  async changesSince(after: number, limit: number, upTo?: number) {
    const rows = await this.db
      .select({ envelope: domainEvents.envelope, feedSeq: domainEvents.feedSeq })
      .from(domainEvents)
      .where(and(gt(domainEvents.feedSeq, after), ...(upTo !== undefined ? [lte(domainEvents.feedSeq, upTo)] : [])))
      .orderBy(asc(domainEvents.feedSeq))
      .limit(limit);
    return rows.map(r => ({ ...parseEnvelope(r.envelope), feedSeq: Number(r.feedSeq) }));
  }

  async shellSummary() {
    const [row] = await this.db
      .select({ n: sql<number>`COUNT(*)`, last: sql<Date | null>`MAX(${projects.updatedAt})` })
      .from(projects);
    return { projectCount: Number(row?.n ?? 0), lastUpdatedAt: iso(row?.last ? new Date(row.last) : null) };
  }

  /** The WHERE predicates shared by list() and count(); null = the principal can see nothing. */
  buildConds(
    input: Pick<ListProjectsInput, "bahnhofsmanagement" | "projektstand" | "projektleiter" | "search" | "department" | "reviewStatus" | "pruefer">,
    visibility: { workspaces: readonly string[] | null },
    opts: { stationPrefix?: string } = {},
  ): SQL[] | null {
    const conds: SQL[] = [];
    // null = unrestricted; [] = no workspace access (must return nothing, never everything)
    if (visibility.workspaces !== null && visibility.workspaces.length === 0) return null;
    if (visibility.workspaces !== null) conds.push(inArray(projects.bahnhofsmanagement, [...visibility.workspaces]));
    if (input.bahnhofsmanagement) conds.push(eq(projects.bahnhofsmanagement, input.bahnhofsmanagement));
    if (input.projektstand) conds.push(eq(projects.projektstand, input.projektstand));
    if (input.projektleiter) conds.push(eq(projects.projektleiter, input.projektleiter));

    if (opts.stationPrefix) {
      const like = `${opts.stationPrefix.replace(/[\\%_]/g, m => `\\${m}`)}%`;
      conds.push(sql`${projects.station} LIKE ${like}`);
    }

    if (input.search) {
      const { boolean, prefix } = fulltextQuery(input.search);
      if (boolean) {
        conds.push(
          sql`MATCH(${projects.projektnummer}, ${projects.station}, ${projects.projektbeschreibung}, ${projects.projektleiter}) AGAINST (${boolean} IN BOOLEAN MODE)`,
        );
      } else if (prefix) {
        // very short input: index-usable prefix match, never %term%
        const like = `${prefix.replace(/[\\%_]/g, m => `\\${m}`)}%`;
        conds.push(or(sql`${projects.projektnummer} LIKE ${like}`, sql`${projects.station} LIKE ${like}`)!);
      }
    }

    // review-based filters: EXISTS keeps one row per project and uses department_reviews' indexes
    const reviewConds: SQL[] = [];
    if (input.department) reviewConds.push(sql`r.department = ${input.department}`);
    if (input.reviewStatus) reviewConds.push(sql`r.status = ${input.reviewStatus}`);
    if (input.pruefer) reviewConds.push(sql`r.prueferName = ${input.pruefer}`);
    if (reviewConds.length) {
      conds.push(sql`EXISTS (SELECT 1 FROM department_reviews r WHERE r.projectId = ${projects.id} AND ${sql.join(reviewConds, sql` AND `)})`);
    }
    return conds;
  }

  /**
   * Map markers inside a bounding box, from the geo read model. Authorization and filters are the SAME
   * predicates as the list (workspace restriction included), so the map can never show what the table may not.
   * Below MAP_POINT_ZOOM (or when the box holds too many stations) the answer is a grid of clusters.
   */
  async mapQuery(q: MapQuery, visibility: { workspaces: readonly string[] | null }): Promise<MapResult> {
    const conds = this.buildConds(q, visibility);
    if (conds === null) return { mode: "clusters", markers: [], total: 0 };
    const box = sql`g.lat BETWEEN ${q.bbox.minLat} AND ${q.bbox.maxLat} AND g.lng BETWEEN ${q.bbox.minLng} AND ${q.bbox.maxLng}`;
    const where = conds.length ? sql`${and(...conds)} AND ${box}` : box;
    const from = sql`FROM project_geo g JOIN projects ON projects.id = g.projectId WHERE ${where}`;
    const rows = async <T>(query: SQL) => ((await this.db.execute(query)) as unknown as [T[]])[0];
    if (q.zoom >= MAP_POINT_ZOOM) {
      const stations = await rows<{ k: string; name: string; lat: number; lng: number; n: number | string; prec: MapStation["precision"] }>(
        sql`SELECT g.stationKey AS k, MIN(g.stationName) AS name, MIN(g.lat) AS lat, MIN(g.lng) AS lng, COUNT(*) AS n, MIN(g.\`precision\`) AS prec ${from} GROUP BY g.stationKey LIMIT ${MAP_MAX_MARKERS + 1}`);
      if (stations.length <= MAP_MAX_MARKERS) {
        return { mode: "stations", total: stations.reduce((a, r) => a + Number(r.n), 0), markers: stations.map(r => ({ kind: "station" as const, key: r.k, name: r.name, lat: Number(r.lat), lng: Number(r.lng), count: Number(r.n), precision: r.prec })) };
      }
    }
    const cell = clusterCellDegrees(q.zoom);
    const cl = await rows<{ gy: number | string; gx: number | string; lat: number; lng: number; n: number | string }>(
      sql`SELECT FLOOR(g.lat / ${cell}) AS gy, FLOOR(g.lng / ${cell}) AS gx, AVG(g.lat) AS lat, AVG(g.lng) AS lng, COUNT(*) AS n ${from} GROUP BY gy, gx LIMIT ${MAP_MAX_MARKERS}`);
    return { mode: "clusters", total: cl.reduce((a, r) => a + Number(r.n), 0), markers: cl.map(r => ({ kind: "cluster" as const, key: `${q.zoom}:${r.gy}:${r.gx}`, lat: Number(r.lat), lng: Number(r.lng), count: Number(r.n) })) };
  }

  /** The projects at one station marker (popup content), authorized and filtered like the map. */
  async mapStation(q: MapStationQuery, visibility: { workspaces: readonly string[] | null }): Promise<MapStationProjects> {
    const conds = this.buildConds(q, visibility);
    if (conds === null) return { stationKey: q.stationKey, total: 0, projects: [] };
    const where = conds.length ? sql`${and(...conds)} AND g.stationKey = ${q.stationKey}` : sql`g.stationKey = ${q.stationKey}`;
    const from = sql`FROM project_geo g JOIN projects ON projects.id = g.projectId WHERE ${where}`;
    const rows = async <T>(query: SQL) => ((await this.db.execute(query)) as unknown as [T[]])[0];
    const [t] = await rows<{ n: number | string }>(sql`SELECT COUNT(*) AS n ${from}`);
    const list = await rows<{ id: number; projektnummer: string | null; station: string | null; projektstand: string | null; projektleiter: string | null }>(
      sql`SELECT projects.id AS id, projects.projektnummer AS projektnummer, projects.station AS station, projects.projektstand AS projektstand, projects.projektleiter AS projektleiter ${from} ORDER BY projects.id DESC LIMIT 50`);
    return { stationKey: q.stationKey, total: Number(t?.n ?? 0), projects: list };
  }

  async slotDetail(id: number): Promise<SlotDTO | null> {
    const [r] = await this.db.select().from(scheduleSlots).where(eq(scheduleSlots.id, id)).limit(1);
    return r ? toSlotDTO(r) : null;
  }
  async listSlots(range: { from: string; to: string; status?: string }) {
    const conds: SQL[] = [sql`${scheduleSlots.datum} >= ${new Date(`${range.from}T00:00:00Z`)}`, sql`${scheduleSlots.datum} < ${new Date(new Date(`${range.to}T00:00:00Z`).getTime() + 86_400_000)}`];
    if (range.status) conds.push(sql`${scheduleSlots.status} = ${range.status}`);
    return this.db.select().from(scheduleSlots).where(and(...conds)).orderBy(asc(scheduleSlots.datum), asc(scheduleSlots.von)).limit(5000);
  }
  checklistDetail(id: number) { return loadChecklist(this.db as unknown as Executor, id); }
  async listChecklists(o: { workspaces: readonly string[] | null; principalId: string; isAdmin: boolean; status?: "draft" | "submitted" | "cancelled"; limit: number }) {
    if (o.workspaces !== null && o.workspaces.length === 0) return [];
    const conds: SQL[] = [];
    if (o.status) conds.push(sql`${projectChecklists.status} = ${o.status}`);
    if (o.workspaces !== null) conds.push(inArray(projectChecklists.bahnhofsmanagement, [...o.workspaces]));
    // drafts are private to their author (admins see all)
    if (!o.isAdmin) conds.push(sql`(${projectChecklists.status} <> 'draft' OR ${projectChecklists.createdBy} = ${o.principalId})`);
    const rows = await this.db.select().from(projectChecklists).where(conds.length ? and(...conds) : undefined).orderBy(desc(projectChecklists.id)).limit(Math.min(o.limit, 200));
    const out: ChecklistDTO[] = [];
    for (const r of rows) out.push((await loadChecklist(this.db as unknown as Executor, r.id))!);
    return out;
  }

  /** Exact COUNT(*) for a filter set. Deliberately a separate call: pages never pay for it. */
  async count(
    input: Pick<ListProjectsInput, "bahnhofsmanagement" | "projektstand" | "projektleiter" | "search" | "department" | "reviewStatus" | "pruefer">,
    visibility: { workspaces: readonly string[] | null },
  ): Promise<number> {
    const conds = this.buildConds(input, visibility);
    if (conds === null) return 0;
    const [r] = await this.db.select({ n: sql<number>`COUNT(*)` }).from(projects).where(conds.length ? and(...conds) : undefined);
    return Number(r?.n ?? 0);
  }

  async list(
    input: ListProjectsInput,
    visibility: { workspaces: readonly string[] | null },
    opts: { offset?: number; stationPrefix?: string } = {},
  ) {
    const limit = Math.min(input.limit, MAX_PAGE_SIZE);
    const conds = this.buildConds(input, visibility, opts);
    if (conds === null) return { items: [], nextCursor: null, ...(input.includeTotal ? { total: 0 } : {}) };

    // Column and direction come from closed enums, never from raw input.
    const desc_ = input.dir === "desc";
    const textCol = {
      projektnummer: projects.projektnummer, station: projects.station, projektstand: projects.projektstand,
      projektleiter: projects.projektleiter, bahnhofsmanagement: projects.bahnhofsmanagement,
    }[input.sort as string] as typeof projects.station | undefined;
    // text sorts order NULLs as '' so the keyset comparison is total
    const sortExpr: SQL = textCol ? sql`COALESCE(${textCol}, '')` : input.sort === "id" ? sql`${projects.id}` : sql`${projects.updatedAt}`;
    const dirFn = desc_ ? desc : asc;
    const order = input.sort === "id" ? [dirFn(projects.id)] : [dirFn(sortExpr), dirFn(projects.id)];

    const total =
      input.includeTotal
        ? Number(
            (await this.db.select({ n: sql<number>`COUNT(*)` }).from(projects).where(conds.length ? and(...conds) : undefined))[0]?.n ?? 0,
          )
        : undefined;

    if (input.cursor) {
      const c = decodeCursor(input.cursor);
      if (c) {
        const cmp = desc_ ? lt : gt;
        if (input.sort === "id") {
          conds.push(cmp(projects.id, c.id));
        } else {
          const at = input.sort === "updatedAt" ? new Date(String(c.v)) : String(c.v);
          conds.push(or(cmp(sortExpr, at), and(eq(sortExpr, at), cmp(projects.id, c.id)))!);
        }
      }
    }

    const wantDetails = input.expand.includes("details");
    const wantTable = !wantDetails && input.expand.includes("table");
    const rows = await this.db
      .select(wantDetails ? { ...SUMMARY_COLUMNS, ...DETAIL_COLUMNS } : wantTable ? { ...SUMMARY_COLUMNS, ...TABLE_COLUMNS } : SUMMARY_COLUMNS)
      .from(projects)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(...order)
      .limit(limit + 1)
      .offset(opts.offset ?? 0);

    const page = rows.slice(0, limit);
    const last = page[page.length - 1] as (SummaryRow & Record<string, unknown>) | undefined;
    const cursorValue = (r: SummaryRow) =>
      input.sort === "id" ? r.id : input.sort === "updatedAt" ? r.updatedAt.toISOString() : String(r[input.sort as keyof SummaryRow] ?? "");
    const nextCursor = rows.length > limit && last ? encodeCursor({ v: cursorValue(last), id: last.id }) : null;

    let reviewsById: Map<number, NonNullable<ProjectListItem["reviews"]>> | null = null;
    const fullReviews = input.expand.includes("reviews");
    if ((fullReviews || input.expand.includes("reviewSummary")) && page.length) {
      reviewsById = new Map();
      const rr = await this.db
        .select()
        .from(departmentReviews)
        .where(inArray(departmentReviews.projectId, page.map(p => p.id)))
        .orderBy(asc(departmentReviews.department));
      for (const r of rr) {
        const list = reviewsById.get(r.projectId) ?? [];
        list.push(fullReviews
          ? { id: r.id, department: r.department, prueferName: r.prueferName, datum: dateToWire(r.datum), status: r.status, updatedAt: r.updatedAt.toISOString() }
          : { department: r.department, prueferName: r.prueferName, datum: dateToWire(r.datum), status: r.status });
        reviewsById.set(r.projectId, list);
      }
    }
    const items: ProjectListItem[] = page.map(r => {
      const item: ProjectListItem = toSummary(r);
      if (wantDetails) {
        const d = r as unknown as Project;
        Object.assign(item, {
          bahnhofsnummer: d.bahnhofsnummer, streckennummer: d.streckennummer, projektbeschreibung: d.projektbeschreibung,
          eigvEinstufung: d.eigvEinstufung, kommentar: d.kommentar, projektLink: d.projektLink, createdAt: d.createdAt.toISOString(),
        });
      }
      if (wantTable) {
        const d = r as unknown as Project;
        Object.assign(item, { bahnhofsnummer: d.bahnhofsnummer, streckennummer: d.streckennummer, projektbeschreibung: d.projektbeschreibung, kommentar: d.kommentar, projektLink: d.projektLink });
      }
      if (reviewsById) item.reviews = reviewsById.get(r.id) ?? [];
      return item;
    });
    return { items, nextCursor, ...(total !== undefined ? { total } : {}) };
  }
}
