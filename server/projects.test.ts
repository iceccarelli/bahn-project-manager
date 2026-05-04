import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("projects.list", () => {
  it("returns paginated projects with total count", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.projects.list({ page: 1, pageSize: 10 });

    expect(result).toHaveProperty("projects");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.projects)).toBe(true);
    expect(typeof result.total).toBe("number");
    expect(result.total).toBeGreaterThan(0);
    expect(result.projects.length).toBeLessThanOrEqual(10);
  });

  it("supports search filtering", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.projects.list({
      page: 1,
      pageSize: 10,
      search: "Frankfurt",
    });

    expect(result.projects.length).toBeGreaterThan(0);
    // All results should have Frankfurt in some field
    for (const project of result.projects) {
      const hasMatch =
        project.station?.includes("Frankfurt") ||
        project.bahnhofsmanagement?.includes("Frankfurt") ||
        project.projektbeschreibung?.includes("Frankfurt") ||
        project.projektnummer?.includes("Frankfurt") ||
        project.projektleiter?.includes("Frankfurt");
      expect(hasMatch).toBe(true);
    }
  });

  it("supports region filtering", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.projects.list({
      page: 1,
      pageSize: 10,
      region: "Kassel",
    });

    expect(result.projects.length).toBeGreaterThan(0);
    for (const project of result.projects) {
      expect(project.bahnhofsmanagement).toBe("Kassel");
    }
  });

  it("includes department reviews for each project", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.projects.list({ page: 1, pageSize: 5 });

    expect(result.projects.length).toBeGreaterThan(0);
    for (const project of result.projects) {
      expect(project).toHaveProperty("reviews");
      expect(Array.isArray(project.reviews)).toBe(true);
    }
  });
});

describe("dashboard.stats", () => {
  it("returns complete dashboard statistics", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const stats = await caller.dashboard.stats();

    expect(stats).not.toBeNull();
    expect(stats).toHaveProperty("totalProjects");
    expect(stats).toHaveProperty("statusDistribution");
    expect(stats).toHaveProperty("departmentStats");
    expect(stats).toHaveProperty("regionStats");
    expect(stats).toHaveProperty("prueferWorkload");
    expect(stats!.totalProjects).toBeGreaterThan(0);
    expect(Array.isArray(stats!.statusDistribution)).toBe(true);
    expect(Array.isArray(stats!.regionStats)).toBe(true);
  });
});

describe("filters.options", () => {
  it("returns filter options with regions and projektleiter", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const options = await caller.filters.options();

    expect(options).toHaveProperty("regions");
    expect(options).toHaveProperty("projektleiter");
    expect(options).toHaveProperty("pruefer");
    expect(Array.isArray(options.regions)).toBe(true);
    expect(options.regions.length).toBeGreaterThan(0);
    expect(options.projektleiter.length).toBeGreaterThan(0);
  });
});

describe("projects.update", () => {
  it("requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.projects.update({ id: 1, field: "kommentar", value: "test" })
    ).rejects.toThrow();
  });

  it("updates a project field when authenticated", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.projects.update({
      id: 1,
      field: "kommentar",
      value: "Test-Kommentar",
    });

    expect(result).toEqual({ success: true });
  });
});

describe("bvbEea.list", () => {
  it("returns BVB-EEA records", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.bvbEea.list();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("psvItk.list", () => {
  it("returns PSV-ITK records", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.psvItk.list();
    expect(Array.isArray(result)).toBe(true);
  });
});
