import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { sdk } from "./_core/sdk";
import {
  updateDepartmentReview,
  getReviewContext,
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
  MAX_PAGE_SIZE,
} from "@shared/project-contract";
import { requireServices } from "./_core/services";
import { SingleFlightCache } from "./infra/singleFlightCache";
import { canApproveReview, canViewAudit } from "./domain/permissions";
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

const dashboardCache = new SingleFlightCache("dashboard", 30_000, () => getDashboardStats());
const filterOptionsCache = new SingleFlightCache("filters", 60_000, () => getFilterOptions());

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
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
        return store.list(input, { workspaces: ctx.principal.workspaces });
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

    /** Reconnect recovery: what changed since the versions the client holds. */
    sync: protectedProcedure
      .input(SyncInputSchema)
      .mutation(async ({ input, ctx }) => {
        const { projects } = await requireServices();
        return projects.sync(ctx.principal, input.known);
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
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        field: z.enum(["prueferName", "datum", "status"]),
        value: z.string().max(256).nullable(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, field, value } = input;

        const rctx = await getReviewContext(id);
        if (!rctx) throw new TRPCError({ code: "NOT_FOUND" });
        if (!canApproveReview(ctx.principal, { bahnhofsmanagement: rctx.bahnhofsmanagement }, rctx.department)) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        let column: string | Date | null = value;
        if (field === "datum" && value !== null) {
          column = new Date(value);
          if (Number.isNaN(column.getTime())) throw new TRPCError({ code: "BAD_REQUEST", message: "Ungültiges Datum" });
        }
        await updateDepartmentReview(id, { [field]: column });

        await createAuditEntry({
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.email || 'Unknown',
          entityType: 'review',
          entityId: id,
          action: 'update',
          field,
          oldValue: null,
          newValue: value != null ? String(value) : null,
        });

        return { success: true };
      }),

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
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.email || 'Unknown',
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

  // ============= DASHBOARD =============
  dashboard: router({
    // Aggregates are a server-side read model: computed once per TTL (single
    // flight, stale-while-revalidate), never per browser or per request.
    stats: protectedProcedure.query(() => dashboardCache.get()),
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
    options: protectedProcedure.query(() => filterOptionsCache.get()),
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
            ...(parsed.projektstand ? { projektstand: parsed.projektstand } : {}),
          },
          { workspaces: ctx.principal.workspaces },
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
