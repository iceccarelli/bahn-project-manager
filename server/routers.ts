import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { sdk } from "./_core/sdk";
import {
  getProjects,
  getProjectWithReviews,
  getProjectReviews,
  updateProject,
  createProject,
  deleteProject,
  updateDepartmentReview,
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
  upsertUser,
  getUserByOpenId,
} from "./db";

// Demo users for authentication without OAuth
const DEMO_USERS = [
  { openId: "demo-admin-001", name: "Admin Demo", email: "admin@bahn.de", role: "admin" as const, password: "admin" },
  { openId: "demo-user-001", name: "Prüfer Demo", email: "pruefer@bahn.de", role: "user" as const, password: "user" },
];

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
        const demoUser = DEMO_USERS.find(u => u.email === input.email && u.password === input.password);
        if (!demoUser) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Ungültige Anmeldedaten" });
        }

        // Upsert user in database
        await upsertUser({
          openId: demoUser.openId,
          name: demoUser.name,
          email: demoUser.email,
          role: demoUser.role,
          loginMethod: "demo",
          lastSignedIn: new Date(),
        });

        // Create JWT token using the SDK (includes openId, appId, name)
        const token = await sdk.createSessionToken(demoUser.openId, {
          name: demoUser.name,
        });

        // Set cookie
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, {
          ...cookieOptions,
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        });

        return { success: true, user: { name: demoUser.name, email: demoUser.email, role: demoUser.role } };
      }),
  }),

  // ============= PROJECTS =============
  projects: router({
    list: publicProcedure
      .input(z.object({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(200).default(50),
        search: z.string().optional(),
        region: z.string().optional(),
        projektleiter: z.string().optional(),
        department: z.string().optional(),
        status: z.string().optional(),
        sortBy: z.string().default('id'),
        sortDir: z.enum(['asc', 'desc']).default('asc'),
      }).optional())
      .query(async ({ input }) => {
        const params = input ?? {};
        const result = await getProjects(params);

        // Fetch reviews for all returned projects
        const projectIds = result.projects.map(p => p.id);
        const reviews = await getProjectReviews(projectIds);

        // Group reviews by project
        const reviewsByProject: Record<number, typeof reviews> = {};
        for (const review of reviews) {
          if (!reviewsByProject[review.projectId]) {
            reviewsByProject[review.projectId] = [];
          }
          reviewsByProject[review.projectId].push(review);
        }

        const projectsWithReviews = result.projects.map(p => ({
          ...p,
          reviews: reviewsByProject[p.id] || [],
        }));

        return { projects: projectsWithReviews, total: result.total };
      }),

    get: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return getProjectWithReviews(input.id);
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        field: z.string(),
        value: z.any(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, field, value } = input;

        const oldProject = await getProjectWithReviews(id);
        const oldValue = oldProject ? (oldProject as any)[field] : null;

        await updateProject(id, { [field]: value });

        await createAuditEntry({
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.email || 'Unknown',
          entityType: 'project',
          entityId: id,
          action: 'update',
          field,
          oldValue: oldValue != null ? String(oldValue) : null,
          newValue: value != null ? String(value) : null,
        });

        return { success: true };
      }),

    create: protectedProcedure
      .input(z.object({
        projektnummer: z.string().optional(),
        bahnhofsmanagement: z.string().optional(),
        station: z.string().optional(),
        bahnhofsnummer: z.string().optional(),
        streckennummer: z.string().optional(),
        projektbeschreibung: z.string().optional(),
        eigvEinstufung: z.string().optional(),
        projektleiter: z.string().optional(),
        kommentar: z.string().optional(),
        projektLink: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const id = await createProject(input);

        await createAuditEntry({
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.email || 'Unknown',
          entityType: 'project',
          entityId: id!,
          action: 'create',
          field: null,
          oldValue: null,
          newValue: JSON.stringify(input),
        });

        return { id };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        await createAuditEntry({
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.email || 'Unknown',
          entityType: 'project',
          entityId: input.id,
          action: 'delete',
          field: null,
          oldValue: null,
          newValue: null,
        });

        await deleteProject(input.id);
        return { success: true };
      }),
  }),

  // ============= DEPARTMENT REVIEWS =============
  reviews: router({
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        field: z.string(),
        value: z.any(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, field, value } = input;

        await updateDepartmentReview(id, { [field]: value });

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
    stats: publicProcedure.query(async () => {
      return getDashboardStats();
    }),
  }),

  // ============= BVB-EEA =============
  bvbEea: router({
    list: publicProcedure.query(async () => {
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
        id: z.number(),
        field: z.string(),
        value: z.any(),
      }))
      .mutation(async ({ input }) => {
        await updateBvbEea(input.id, { [input.field]: input.value });
        return { success: true };
      }),
  }),

  // ============= PSV-ITK =============
  psvItk: router({
    list: publicProcedure.query(async () => {
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
        id: z.number(),
        field: z.string(),
        value: z.any(),
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
      .query(async ({ input }) => {
        return getAuditLog(input ?? {});
      }),
  }),

  // ============= FILTERS =============
  filters: router({
    options: publicProcedure.query(async () => {
      return getFilterOptions();
    }),
  }),
});

export type AppRouter = typeof appRouter;
