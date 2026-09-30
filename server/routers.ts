import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { sdk } from "./_core/sdk";
import {
  createDepartmentReview,
  getDashboardStats,
  getBvbEeaList,
  createBvbEea,
  updateBvbEea,
  getPsvItkList,
  createPsvItk,
  updatePsvItk,
  createAuditEntry,
  getAuditLog,
  getFilterOptions,
  getSearchSuggestions,
  upsertUser,
} from "./db";
import { ODataQuerySchema, parseODataFilter } from "@shared/server/odata";
import {
  CreateProjectInputSchema,
  ListProjectsInputSchema,
  SyncInputSchema,
  UpdateProjectInputSchema,
  UpdateReviewInputSchema,
  MAX_PAGE_SIZE,
} from "@shared/project-contract";
import { requireServices } from "./_core/services";
import { deriveProjectMetrics } from "@shared/project-metrics";
import { SingleFlightCache } from "./infra/singleFlightCache";
import { canViewAudit, workspaceRestriction } from "./domain/permissions";
import { m } from "./observability/metrics";
import { ConflictError } from "./domain/errors";

// Demo users for authentication without OAuth
const DEMO_USERS = [
  { openId: "demo-admin-001", name: "Admin Demo", email: "admin@bahn.de", role: "admin" as const, password: "admin" },
  { openId: "demo-user-001", name: "Prüfer Demo", email: "pruefer@bahn.de", role: "user" as const, password: "user" },
];

/** 5 s in-process cache: the shell polls this, it must not become a COUNT(*) per tab. */
let shellCache: { at: number; value: { projectCount: number; lastUpdatedAt: string | null } } | null = null;
async function shellSummaryCached(load: () => Promise<{ projectCount: number; lastUpdatedAt: string | null }>) {
  if (shellCache && Date.now() - shellCache.at < 5000) return shellCache.value;
  const value = await load();
  shellCache = { at: Date.now(), value };
  return value;
}

/** audit_log.userId is the legacy numeric id when there is one; OIDC identities are recorded by name. */
const auditActor = (p: import("./domain/permissions").Principal) => ({
  userId: /^\d+$/.test(p.id) ? Number(p.id) : null,
  userName: p.name || p.email || p.id,
});

const dashboardCache = new SingleFlightCache("dashboard", 30_000, () => getDashboardStats());
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
        // Demo credentials are a development convenience. In production they are
        // off unless explicitly enabled — production identity is OIDC (docs/auth.md).
        if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_LOGIN !== "1") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
        }
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
    shellSummary: protectedProcedure.query(async () => {
      const { store } = await requireServices();
      return shellSummaryCached(() => store.shellSummary());
    }),

    searchSuggestions: protectedProcedure
      .input(z.object({ term: z.string().trim().min(1).max(100) }))
      .query(async ({ input }) => {
        return getSearchSuggestions(input.term);
      }),
  }),

  // ============= DEPARTMENT REVIEWS =============
  reviews: router({
    // reviews.update (unversioned, unevented) was removed: use projects.updateReview.

    create: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        department: z.string(),
        prueferName: z.string().optional(),
        datum: z.string().optional(),
        status: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const id = await createDepartmentReview({
          ...input,
          datum: input.datum ? new Date(input.datum) : null,
        });

        await createAuditEntry({
          ...auditActor(ctx.principal),
          entityType: 'review',
          entityId: id!,
          action: 'create',
          field: null,
          oldValue: null,
          newValue: JSON.stringify(input),
        });

        return { id };
      }),
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
    stats: protectedProcedure.query(({ ctx }) => {
      // Global aggregates would leak other workspaces' figures to a restricted principal.
      if (workspaceRestriction(ctx.principal) !== null) throw new TRPCError({ code: "FORBIDDEN", message: "Dashboard nur mit Zugriff auf alle Workspaces" });
      return dashboardCache.get();
    }),
    /** KPI cards: shared/project-metrics.ts run server-side over (project, status) rows. */
    metrics: protectedProcedure.query(({ ctx }) => {
      const restriction = workspaceRestriction(ctx.principal);
      return restriction === null ? metricsCache.get() : computeMetrics(restriction);
    }),
  }),

  // ============= BVB-EEA =============
  bvbEea: router({
    list: protectedProcedure.query(async () => {
      return getBvbEeaList();
    }),

    create: protectedProcedure
      .input(z.object({
        projektnummer: z.string().optional(),
        bahnhofsmanagement: z.string().optional(),
        station: z.string().optional(),
        bahnhofsnummer: z.string().optional(),
        streckennummer: z.string().optional(),
        projektbeschreibung: z.string().optional(),
        projektleiter: z.string().optional(),
        eigvAnzeige: z.string().optional(),
        kommentar: z.string().optional(),
        freigabeNummer: z.string().optional(),
        kosteneinsparung: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const id = await createBvbEea({
          ...input,
          eigvAnzeige: input.eigvAnzeige ? new Date(input.eigvAnzeige) : null,
        });
        return { id };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        field: z.enum(["projektnummer","bahnhofsmanagement","station","bahnhofsnummer","streckennummer","projektbeschreibung","projektleiter","kommentar","freigabeNummer","kosteneinsparung"]),
        value: z.string().max(5000).nullable(),
      }))
      .mutation(async ({ input }) => {
        await updateBvbEea(input.id, { [input.field]: input.value });
        return { success: true };
      }),
  }),

  // ============= PSV-ITK =============
  psvItk: router({
    list: protectedProcedure.query(async () => {
      return getPsvItkList();
    }),

    create: protectedProcedure
      .input(z.object({
        projektnummer: z.string().optional(),
        bahnhofsmanagement: z.string().optional(),
        station: z.string().optional(),
        bahnhofsnummer: z.string().optional(),
        streckennummer: z.string().optional(),
        projektbeschreibung: z.string().optional(),
        projektstand: z.string().optional(),
        projektleiter: z.string().optional(),
        terminProjektvorstellung: z.string().optional(),
        itkPruefer: z.string().optional(),
        kommentar: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const id = await createPsvItk({
          ...input,
          terminProjektvorstellung: input.terminProjektvorstellung ? new Date(input.terminProjektvorstellung) : null,
        });
        return { id };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        field: z.enum(["projektnummer","bahnhofsmanagement","station","bahnhofsnummer","streckennummer","projektbeschreibung","projektstand","projektleiter","itkPruefer","kommentar"]),
        value: z.string().max(5000).nullable(),
      }))
      .mutation(async ({ input }) => {
        await updatePsvItk(input.id, { [input.field]: input.value });
        return { success: true };
      }),
  }),

  // ============= AUDIT LOG =============
  audit: router({
    list: protectedProcedure
      .input(z.object({
        entityType: z.string().optional(),
        entityId: z.number().optional(),
        limit: z.number().max(500).default(100),
      }).optional())
      .query(async ({ input, ctx }) => {
        if (!canViewAudit(ctx.principal)) throw new TRPCError({ code: "FORBIDDEN" });
        return getAuditLog(input ?? {});
      }),
  }),

  // ============= FILTERS =============
  filters: router({
    options: protectedProcedure.query(async ({ ctx }) => {
      const restriction = workspaceRestriction(ctx.principal);
      if (restriction === null) return filterOptionsCache.get();
      // Restricted principals: only their own workspaces' options; names from other workspaces stay hidden.
      const { store } = await requireServices();
      return store.filterOptions(restriction);
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

// Note: The full Express OData router (odataRouter) is exported from ./odata/router
// and should be mounted in server/_core/index.ts like:
// app.use("/odata", expressODataRouter);
