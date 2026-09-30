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
  auditLog, departmentReviews, domainEvents, idempotencyKeys, projects, type Project,
} from "../../drizzle/schema";
import type { AuditRow, IdempotencyClaim, ProjectStore, ProjectTx } from "../domain/ports";

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

function txAdapter(x: Executor): ProjectTx {
  return {
    async lockProject(id) {
      const rows = await x.select().from(projects).where(eq(projects.id, id)).limit(1).for("update");
      return rows[0] ?? null;
    },
    async updateVersioned(id, expectedVersion, set) {
      const [res] = await x
        .update(projects)
        .set({ ...set, syncVersion: expectedVersion + 1 })
        .where(and(eq(projects.id, id), eq(projects.syncVersion, expectedVersion)));
      // mysql2 reports matched rows in affectedRows (CLIENT_FOUND_ROWS default)
      return (res as unknown as { affectedRows: number }).affectedRows === 1;
    },
    async insertProject(values) {
      const [res] = await x.insert(projects).values({ ...values, syncVersion: 1 } as typeof projects.$inferInsert);
      return Number((res as unknown as { insertId: number }).insertId);
    },
    async deleteProject(id) {
      await x.delete(departmentReviews).where(eq(departmentReviews.projectId, id));
      await x.delete(projects).where(eq(projects.id, id));
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
    async updateReview(id, set) {
      await x.update(departmentReviews).set(set).where(eq(departmentReviews.id, id));
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

  async list(
    input: ListProjectsInput,
    visibility: { workspaces: readonly string[] | null },
    opts: { offset?: number; stationPrefix?: string } = {},
  ) {
    const limit = Math.min(input.limit, MAX_PAGE_SIZE);
    const conds: SQL[] = [];

    // null = unrestricted; [] = no workspace access (must return nothing, never everything)
    if (visibility.workspaces !== null && visibility.workspaces.length === 0) return { items: [], nextCursor: null, ...(input.includeTotal ? { total: 0 } : {}) };
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
    const rows = await this.db
      .select(wantDetails ? { ...SUMMARY_COLUMNS, ...DETAIL_COLUMNS } : SUMMARY_COLUMNS)
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
    if (input.expand.includes("reviews") && page.length) {
      reviewsById = new Map();
      const rr = await this.db
        .select()
        .from(departmentReviews)
        .where(inArray(departmentReviews.projectId, page.map(p => p.id)))
        .orderBy(asc(departmentReviews.department));
      for (const r of rr) {
        const list = reviewsById.get(r.projectId) ?? [];
        list.push({ id: r.id, department: r.department, prueferName: r.prueferName, datum: dateToWire(r.datum), status: r.status, updatedAt: r.updatedAt.toISOString() });
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
      if (reviewsById) item.reviews = reviewsById.get(r.id) ?? [];
      return item;
    });
    return { items, nextCursor, ...(total !== undefined ? { total } : {}) };
  }
}
