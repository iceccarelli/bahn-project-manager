import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { sdk } from "./_core/sdk";
import {
  getFilterOptions,
  upsertUser,
} from "./db";
import { ODataQuerySchema, parseODataFilter } from "@shared/server/odata";
import {
  CreateProjectInputSchema,
  ListProjectsInputSchema,
  SyncInputSchema,
  UpdateProjectInputSchema,
  UpdateReviewInputSchema,
  CreateReviewInputSchema,
  MAX_PAGE_SIZE,
} from "@shared/project-contract";
import { requireServices } from "./_core/services";
import { deriveProjectMetrics } from "@shared/project-metrics";
import { SingleFlightCache } from "./infra/singleFlightCache";
import { KeyedCache, scopeKey } from "./infra/keyedCache";
import { readDashboard, readDepartment } from "./infra/readModels";
import { loadPortfolioProjects } from "./infra/portfolioModel";
import { pageAudit } from "./infra/auditQuery";
import { searchGlobal } from "./infra/searchQuery";
import { buildPortfolio, buildReelView } from "@shared/portfolio-view";
import { AUDIT_DOCUMENT_KINDS } from "@shared/audit-contract";
import type { PortfolioProject } from "@shared/portfolio-metrics";
import { MapQuerySchema, MapStationQuerySchema } from "@shared/map-contract";
import { BookSlotInputSchema, ListSlotsInputSchema, ReleaseSlotInputSchema } from "@shared/booking-contract";
import { SaveChecklistInputSchema, SubmitChecklistInputSchema } from "@shared/checklist-contract";
import type { MysqlProjectStore } from "./infra/mysqlProjectStore";
import { canViewAudit, workspaceRestriction } from "./domain/permissions";
import { m } from "./observability/metrics";
import { ConflictError } from "./domain/errors";

/** 5 s in-process cache: the shell polls this, it must not become a COUNT(*) per tab. */
const shellScoped = new KeyedCache<{ projectCount: number; lastUpdatedAt: string | null }>("shell", 5_000, 200);
const shellSummaryCached = (key: string, load: () => Promise<{ projectCount: number; lastUpdatedAt: string | null }>) => shellScoped.get(key, load);

// The read is a few tiny indexed lookups; this short cache only absorbs bursts (one load per scope per 5 s).
const departmentScoped = new KeyedCache<Awaited<ReturnType<typeof readDepartment>>>("department", 5_000, 500);
// Authorized portfolio rows per scope (one lean scan per scope per TTL, shared by every viewer of that scope); the
// finished figures are derived from them once per scope per TTL as well.
const portfolioRows = new KeyedCache<PortfolioProject[]>("portfolio-rows", 30_000, 100);
const portfolioView = new KeyedCache<ReturnType<typeof buildPortfolio>>("portfolio", 30_000, 100);
// 5 s burst absorber per (scope, user, term): typing the same prefix from many tabs costs one set of queries.
const auditRecordWindow = new Map<string, { n: number; reset: number }>();
const searchCache = new KeyedCache<{ q: string; entries: Awaited<ReturnType<typeof searchGlobal>> }>("search", 5_000, 2000);
const dashboardScoped = new KeyedCache<Awaited<ReturnType<typeof readDashboard>>>("dashboard", 5_000);
/** Per-project review statuses → shared/project-metrics.ts. `workspaces` null = all. */
async function computeMetrics(workspaces: readonly string[] | null) {
  const { pool } = await requireServices();
  if (workspaces !== null && workspaces.length === 0) return deriveProjectMetrics([]);
  const [rows] = (await pool.query(
    `SELECT p.id AS id, r.status AS status FROM projects p LEFT JOIN department_reviews r ON r.projectId = p.id${workspaces ? " WHERE p.bahnhofsmanagement IN (?)" : ""}`,
    workspaces ? [workspaces] : [],
  )) as unknown as [Array<{ id: number; status: string | null }>];
  const by = new Map<number, Array<{ status: string | null }>>();
  for (const r of rows) {
    const list = by.get(r.id) ?? [];
    if (r.status !== null) list.push({ status: r.status }); // LEFT JOIN: review-less projects yield one null row
    by.set(r.id, list);
  }
  return deriveProjectMetrics([...by.values()].map(reviews => ({ reviews })));
}
const metricsCache = new SingleFlightCache("metrics", 30_000, () => computeMetrics(null));
const filterOptionsCache = new SingleFlightCache("filters", 60_000, () => getFilterOptions());
// Restricted principals share results per NORMALIZED authorization scope (the key encodes the scope: never crosses scopes).
const scopedFilterCache = new KeyedCache<Awaited<ReturnType<MysqlProjectStore["filterOptions"]>>>("filters-scoped", 60_000);
const scopedMetricsCache = new KeyedCache<ReturnType<typeof computeMetrics> extends Promise<infer R> ? R : never>("metrics-scoped", 30_000);
/** Exact totals: cached per (authorization scope, filter set). Pages never compute them. */
const countCache = new KeyedCache<number>("count", 15_000, 1000);

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    /** The verified principal (what authorization actually uses): role, workspaces, departments. */
    session: publicProcedure.query(({ ctx }) =>
      ctx.principal
        ? { id: ctx.principal.id, name: ctx.principal.name, email: ctx.principal.email, role: ctx.principal.role, workspaces: ctx.principal.workspaces, departments: [...ctx.principal.departments] }
        : null,
    ),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),

    // Demo login procedure - replaces OAuth for standalone deployment
    demoLogin: publicProcedure
      .input(z.object({
        email: z.string().email(),
        password: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Demo credentials are a development convenience and DO NOT EXIST in production (the boot also refuses
        // ALLOW_DEMO_LOGIN there) — production identity is OIDC bearer tokens only (docs/auth.md).
        if (process.env.NODE_ENV === "production") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
        }
        const { DEMO_USERS } = await import("./_core/demoUsers");
        const demoUser = DEMO_USERS.find(u => u.email === input.email && u.password === input.password);
        if (!demoUser) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Ungültige Anmeldedaten" });
        }

        await upsertUser({
          openId: demoUser.openId,
          name: demoUser.name,
          email: demoUser.email,
          role: demoUser.role,
          loginMethod: "demo",
          lastSignedIn: new Date(),
        });

        const token = await sdk.createSessionToken(demoUser.openId, {
          name: demoUser.name,
        });

        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, {
          ...cookieOptions,
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });

        return { success: true, user: { name: demoUser.name, email: demoUser.email, role: demoUser.role } };
      }),
  }),

  // ============= PROJECTS =============
  // Server-authoritative slice: docs/data-plane.md. Reads are cursor-paginated
  // summaries; writes are versioned, idempotent, audited and evented.
  projects: router({
    list: protectedProcedure
      .input(ListProjectsInputSchema)
      .query(async ({ input, ctx }) => {
        const { store } = await requireServices();
        // Read the feed head BEFORE the page: any change committed after this
        // number is delivered live or by projects.changes, so nothing falls
        // between the list snapshot and the subscription.
        const feedHead = await store.feedHead();
        const page = await store.list(input, { workspaces: workspaceRestriction(ctx.principal) });
        return { ...page, feedHead };
      }),

    /**
     * Exact total for a filter set, requested separately from the pages (cursor pagination is authoritative).
     * Cached per normalized authorization scope + filters; a stale-by-seconds total is fine for a header count.
     */
    count: protectedProcedure
      .input(ListProjectsInputSchema.pick({ search: true, bahnhofsmanagement: true, projektstand: true, projektleiter: true, department: true, reviewStatus: true, pruefer: true }))
      .query(async ({ input, ctx }) => {
        const { store } = await requireServices();
        const restriction = workspaceRestriction(ctx.principal);
        const key = `${scopeKey(restriction)}#${JSON.stringify(Object.entries(input).filter(([, v]) => v !== undefined).sort())}`;
        return { total: await countCache.get(key, () => store.count(input, { workspaces: restriction })), exact: true as const };
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input, ctx }) => {
        const { projects } = await requireServices();
        return projects.get(ctx.principal, input.id);
      }),

    update: protectedProcedure
      .input(UpdateProjectInputSchema)
      .mutation(async ({ input, ctx }) => {
        const { projects } = await requireServices();
        const start = performance.now();
        try {
          const res = await projects.update(ctx.principal, input, { traceId: ctx.traceId, requestId: ctx.requestId });
          m.mutations.inc({ outcome: res.replayed ? "replay" : "ok" });
          return res;
        } catch (e) {
          if (e instanceof ConflictError) { m.conflicts.inc(); m.mutations.inc({ outcome: "conflict" }); }
          else m.mutations.inc({ outcome: "error" });
          throw e;
        } finally {
          m.dbMs.observe(performance.now() - start);
        }
      }),

    create: protectedProcedure
      .input(CreateProjectInputSchema)
      .mutation(async ({ input, ctx }) => {
        const { projects } = await requireServices();
        return projects.create(ctx.principal, input, { traceId: ctx.traceId, requestId: ctx.requestId });
      }),

    delete: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        expectedVersion: z.number().int().min(1),
        idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/),
      }))
      .mutation(async ({ input, ctx }) => {
        const { projects } = await requireServices();
        return projects.delete(ctx.principal, input, { traceId: ctx.traceId, requestId: ctx.requestId });
      }),

    /** Collection recovery: visible changes after a feed cursor (see docs/data-plane.md). */
    changes: protectedProcedure
      .input(z.object({ after: z.number().int().min(0), upTo: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(500).optional() }))
      .query(async ({ input, ctx }) => {
        const { projects } = await requireServices();
        return projects.changes(ctx.principal, input);
      }),

    /** Reconnect recovery: what changed since the versions the client holds. */
    sync: protectedProcedure
      .input(SyncInputSchema)
      .mutation(async ({ input, ctx }) => {
        const { projects } = await requireServices();
        return projects.sync(ctx.principal, input.known);
      }),

    /** Department-review edit: versioned (project version), audited, evented. */
    updateReview: protectedProcedure
      .input(UpdateReviewInputSchema)
      .mutation(async ({ input, ctx }) => {
        const { projects } = await requireServices();
        try {
          const res = await projects.updateReview(ctx.principal, input, { traceId: ctx.traceId, requestId: ctx.requestId });
          m.mutations.inc({ outcome: res.replayed ? "replay" : "ok" });
          return res;
        } catch (e) {
          if (e instanceof ConflictError) { m.conflicts.inc(); m.mutations.inc({ outcome: "conflict" }); } else m.mutations.inc({ outcome: "error" });
          throw e;
        }
      }),

    createReview: protectedProcedure
      .input(CreateReviewInputSchema)
      .mutation(async ({ input, ctx }) => {
        const { projects } = await requireServices();
        return projects.createReview(ctx.principal, input, { traceId: ctx.traceId, requestId: ctx.requestId });
      }),

    /** Follow / unfollow a project (recipient set of the notification policy). */
    watch: protectedProcedure
      .input(z.object({ projectId: z.number().int().positive(), on: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        const { store, projects } = await requireServices();
        await projects.get(ctx.principal, input.projectId); // NOT_FOUND unless the caller may see it
        if (input.on) await store.watch(input.projectId, ctx.principal.id); else await store.unwatch(input.projectId, ctx.principal.id);
        return { watching: input.on };
      }),
    watching: protectedProcedure
      .input(z.object({ projectId: z.number().int().positive() }))
      .query(async ({ input, ctx }) => {
        const { store } = await requireServices();
        return { watching: await store.isWatching(input.projectId, ctx.principal.id) };
      }),

    /** Global-chrome summary: replaces useAllProjects() in the shell. */
    shellSummary: protectedProcedure.query(async ({ ctx }) => {
      const { store } = await requireServices();
      const restriction = workspaceRestriction(ctx.principal);
      return shellSummaryCached(scopeKey(restriction), () => store.shellSummary(restriction));
    }),

    // `searchSuggestions` is gone: it read every workspace's names. `search.query` is the scoped replacement.
  }),

  // ============= NOTIFICATIONS =============
  // Source of truth for the bell: rows written in the same transaction as the change (see
  // ProjectService.notifyWatchers), delivered live on notifications:<self>.
  notifications: router({
    list: protectedProcedure
      .input(z.object({ cursor: z.number().int().positive().optional(), limit: z.number().int().min(1).max(100).default(30), unreadOnly: z.boolean().default(false) }))
      .query(async ({ input, ctx }) => {
        const { store } = await requireServices();
        return store.listNotifications(ctx.principal.id, input, workspaceRestriction(ctx.principal));
      }),
    unreadCount: protectedProcedure.query(async ({ ctx }) => {
      const { store } = await requireServices();
      return { count: await store.unreadCount(ctx.principal.id, workspaceRestriction(ctx.principal)) };
    }),
    markRead: protectedProcedure
      .input(z.object({ ids: z.union([z.literal("all"), z.array(z.number().int().positive()).min(1).max(200)]) }))
      .mutation(async ({ input, ctx }) => {
        const { store } = await requireServices();
        await store.markRead(ctx.principal.id, input.ids);
        return { ok: true as const };
      }),
  }),

  // ============= DASHBOARD =============
  dashboard: router({
    // Aggregates are a server-side read model: computed once per TTL (single
    // flight, stale-while-revalidate), never per browser or per request.
    // Served from the rm_* counters (updated in the write transactions), per authorization scope: a restricted
    // principal gets exactly the aggregates of its own workspaces, an unrestricted one the global figures.
    stats: protectedProcedure.query(async ({ ctx }) => {
      const restriction = workspaceRestriction(ctx.principal);
      const { pool } = await requireServices();
      return dashboardScoped.get(scopeKey(restriction), () => readDashboard(pool, restriction));
    }),
    /** One Gewerk's counters (the BVB-EEA / PSV-ITK pages' KPIs), scoped to the caller's workspaces. */
    department: protectedProcedure.input(z.object({ department: z.string().min(1).max(64) })).query(async ({ input, ctx }) => {
      const restriction = workspaceRestriction(ctx.principal);
      const { pool } = await requireServices();
      return departmentScoped.get(`${input.department}#${scopeKey(restriction)}`, () => readDepartment(pool, restriction, input.department));
    }),
    /** Every Dashboard figure that needs row-level data, derived server-side for the caller's workspaces only. */
    portfolio: protectedProcedure.query(async ({ ctx }) => {
      const restriction = workspaceRestriction(ctx.principal);
      const { pool } = await requireServices();
      const key = scopeKey(restriction);
      return portfolioView.get(key, async () => buildPortfolio(await portfolioRows.get(key, () => loadPortfolioProjects(pool, restriction)), Date.now()));
    }),
    /** The card "reel" of one Gewerk, built on demand (not for all fourteen on every mount). */
    reel: protectedProcedure.input(z.object({ department: z.string().min(1).max(64) })).query(async ({ input, ctx }) => {
      const restriction = workspaceRestriction(ctx.principal);
      const { pool } = await requireServices();
      const key = scopeKey(restriction);
      return buildReelView(await portfolioRows.get(key, () => loadPortfolioProjects(pool, restriction)), input.department, []);
    }),
    /** KPI cards: shared/project-metrics.ts run server-side over (project, status) rows. */
    metrics: protectedProcedure.query(({ ctx }) => {
      const restriction = workspaceRestriction(ctx.principal);
      return restriction === null ? metricsCache.get() : scopedMetricsCache.get(scopeKey(restriction), () => computeMetrics(restriction));
    }),
  }),

  // ============= BOOKINGS (Fachspezialistenprüfung calendar) =============
  bookings: router({
    list: protectedProcedure.input(ListSlotsInputSchema).query(async ({ input, ctx }) => {
      const { bookings } = await requireServices();
      return bookings.list(ctx.principal, input);
    }),
    book: protectedProcedure.input(BookSlotInputSchema).mutation(async ({ input, ctx }) => {
      const { bookings } = await requireServices();
      return bookings.book(ctx.principal, input, { traceId: ctx.traceId, requestId: ctx.requestId });
    }),
    release: protectedProcedure.input(ReleaseSlotInputSchema).mutation(async ({ input, ctx }) => {
      const { bookings } = await requireServices();
      return bookings.release(ctx.principal, input, { traceId: ctx.traceId, requestId: ctx.requestId });
    }),
  }),

  // ============= CHECKLISTS (Projektanmeldung) =============
  checklists: router({
    list: protectedProcedure.input(z.object({ status: z.enum(["draft", "submitted", "cancelled"]).optional(), limit: z.number().int().min(1).max(200).default(50) }).default({ limit: 50 })).query(async ({ input, ctx }) => {
      const { checklists } = await requireServices();
      return checklists.list(ctx.principal, input);
    }),
    get: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ input, ctx }) => {
      const { checklists } = await requireServices();
      return checklists.get(ctx.principal, input.id);
    }),
    save: protectedProcedure.input(SaveChecklistInputSchema).mutation(async ({ input, ctx }) => {
      const { checklists } = await requireServices();
      return checklists.save(ctx.principal, input, { traceId: ctx.traceId, requestId: ctx.requestId });
    }),
    submit: protectedProcedure.input(SubmitChecklistInputSchema).mutation(async ({ input, ctx }) => {
      const { checklists } = await requireServices();
      return checklists.submit(ctx.principal, input, { traceId: ctx.traceId, requestId: ctx.requestId });
    }),
  }),

  // ============= MAP =============
  // Bounding-box queries over the geo read model. Same authorization + filters as the list; never the list as source.
  map: router({
    query: protectedProcedure.input(MapQuerySchema).query(async ({ input, ctx }) => {
      const { store } = await requireServices();
      return store.mapQuery(input, { workspaces: workspaceRestriction(ctx.principal) });
    }),
    station: protectedProcedure.input(MapStationQuerySchema).query(async ({ input, ctx }) => {
      const { store } = await requireServices();
      return store.mapStation(input, { workspaces: workspaceRestriction(ctx.principal) });
    }),
  }),

  // BVB-EEA and PSV-ITK are Gewerk views over the Project aggregate (department EEA / ITK reviews). Their former
  // standalone tables had unauthenticated-by-role write endpoints here; they were removed (see docs/data-plane.md).

  // ============= AUDIT LOG =============
  audit: router({
    /** Server-paginated (keyset), workspace-scoped, filterable. The only audit read the UI uses. */
    page: protectedProcedure
      .input(z.object({
        cursor: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        entityType: z.enum(["project", "checklist", "booking", "user", "document"]).optional(),
        entityId: z.number().int().positive().optional(),
        action: z.enum(["create", "update", "delete", "document"]).optional(),
        user: z.string().trim().min(1).max(100).optional(),
        label: z.string().trim().min(1).max(100).optional(),
        q: z.string().trim().min(1).max(100).optional(),
        statusOnly: z.boolean().optional(),
        days: z.number().int().min(0).max(3650).default(30),
      }).default({ limit: 50, days: 30 }))
      .query(async ({ input, ctx }) => {
        if (!canViewAudit(ctx.principal)) throw new TRPCError({ code: "FORBIDDEN" });
        const { pool } = await requireServices();
        return pageAudit(pool, workspaceRestriction(ctx.principal), input);
      }),
    /**
     * Durable document actions (PDF, export, mail, Teams). Authorized like a read of the project (or scoped to the caller's
     * workspace), closed vocabulary, rate-limited per principal. Aggregate changes never come through here: those are audited
     * inside their own transaction by the domain services.
     */
    record: protectedProcedure
      .input(z.object({ kind: z.enum(AUDIT_DOCUMENT_KINDS), details: z.string().trim().min(1).max(500), projectId: z.number().int().positive().optional() }))
      .mutation(async ({ input, ctx }) => {
        const k = ctx.principal.id; const now = Date.now(); const w = auditRecordWindow.get(k);
        if (w && now < w.reset) { if (++w.n > 120) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "zu viele Protokolleinträge" }); } else auditRecordWindow.set(k, { n: 1, reset: now + 60_000 });
        if (auditRecordWindow.size > 5000) auditRecordWindow.clear();
        const { projects } = await requireServices();
        await projects.recordDocumentAction(ctx.principal, input, { traceId: ctx.traceId, requestId: ctx.requestId });
        return { ok: true as const };
      }),
    // There is no unscoped `audit.list`: `audit.page` is the only audit read (workspace-scoped, keyset-paginated).
  }),

  // ============= GLOBAL SEARCH =============
  search: router({
    /** Typed, authorization-scoped candidates for the command palette (projects, stations, people, regions, audit, bookings, own notifications). */
    query: protectedProcedure.input(z.object({ q: z.string().trim().min(2).max(80) })).query(async ({ input, ctx }) => {
      const { pool } = await requireServices();
      const workspaces = workspaceRestriction(ctx.principal);
      const canAudit = canViewAudit(ctx.principal);
      const key = `${scopeKey(workspaces)}|${canAudit}|${ctx.principal.id}|${input.q.toLowerCase()}`;
      return searchCache.get(key, async () => ({ q: input.q, entries: await searchGlobal(pool, { workspaces, userId: ctx.principal.id, canAudit }, input.q) }));
    }),
  }),

  // ============= FILTERS =============
  filters: router({
    options: protectedProcedure.query(async ({ ctx }) => {
      const restriction = workspaceRestriction(ctx.principal);
      if (restriction === null) return filterOptionsCache.get();
      // Restricted principals: only their own workspaces' options; names from other workspaces stay hidden.
      const { store } = await requireServices();
      return scopedFilterCache.get(scopeKey(restriction), () => store.filterOptions(restriction));
    }),
  }),

  // ============= ODATA (tRPC facade + full Express router available at /odata) =============
  odata: router({
    /**
     * tRPC-friendly OData query (used by future React Query hooks)
     * Returns standard ODataResponse shape
     */
    queryProjects: protectedProcedure
      .input(ODataQuerySchema)
      .query(async ({ input, ctx }) => {
        // $filter is compiled to SQL (indexed WHERE), never applied in JS after
        // loading the table. station is a prefix match so it can use the index.
        const { store } = await requireServices();
        const $top = Math.min(input.$top ?? 100, MAX_PAGE_SIZE);
        const $skip = Math.min(input.$skip ?? 0, 10_000);
        const parsed = (input.$filter ? parseODataFilter(input.$filter) : {}) as Record<string, string | undefined>;
        const page = await store.list(
          {
            limit: $top,
            sort: "id",
            dir: "asc",
            includeTotal: true,
            expand: [],
            ...(parsed.projektstand ? { projektstand: parsed.projektstand } : {}),
          },
          { workspaces: workspaceRestriction(ctx.principal) },
          { offset: $skip, ...((parsed.station ?? parsed.station_contains) ? { stationPrefix: String(parsed.station ?? parsed.station_contains) } : {}) },
        );
        return {
          value: page.items,
          "@odata.count": page.total ?? page.items.length,
          "@odata.context": "/odata/$metadata#projects",
        };
      }),

    /**
     * Returns the EDM metadata (same as Express $metadata)
     */
    metadata: publicProcedure.query(() => {
      return { metadataUrl: "/odata/$metadata", version: "4.0" };
    }),
  }),
});

export type AppRouter = typeof appRouter;
