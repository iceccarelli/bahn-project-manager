/**
 * The tRPC surface end-to-end against a real database: identity → authorization
 * → validation → transaction → conflict payload. Replaces projects.test.ts,
 * whose live cases were `describe.skip`ped and whose update case targeted the
 * old unversioned `{field, value}` contract.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { hasTestDb, createTestDatabase, TEST_DB_URL } from "./testing/testDb";
import type { TrpcContext } from "./_core/context";
import type { Principal } from "./domain/permissions";

const user = (id: number, role: "admin" | "user") => ({
  id, openId: `t-${id}`, name: `User ${id}`, email: `u${id}@bahn.de`, loginMethod: "test", role,
  createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
});
const principal = (id: number, role: Principal["role"], extra: Partial<Principal> = {}): Principal =>
  ({ id: String(id), name: `User ${id}`, email: null, role, workspaces: [], departments: [], ...extra });
const ctxFor = (p: Principal | null): TrpcContext => ({
  user: p ? user(Number(p.id), p.role === "admin" ? "admin" : "user") : null,
  principal: p,
  traceId: "trace-router-0001",
  requestId: "req-1",
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: { clearCookie() {}, setHeader() {} } as unknown as TrpcContext["res"],
});

describe.skipIf(!hasTestDb)("tRPC projects router (real DB)", () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let appRouter: typeof import("./routers").appRouter;
  let closeDb: typeof import("./db").closeDb;
  let services: Awaited<ReturnType<typeof import("./_core/services").requireServices>>;
  const as = (p: Principal | null) => appRouter.createCaller(ctxFor(p));
  const editor = principal(2, "editor"), admin = principal(1, "admin"), viewer = principal(4, "viewer");
  let n = 0;
  const key = () => `router-key-${Date.now()}-${n++}-xxxx`;

  beforeAll(async () => {
    t = await createTestDatabase(10);
    process.env.DATABASE_URL = `${TEST_DB_URL}/${t.name}`;
    ({ appRouter } = await import("./routers"));
    ({ closeDb } = await import("./db"));
    services = await (await import("./_core/services")).requireServices();
  });
  afterAll(async () => {
    await services?.shutdown();
    await closeDb?.();
    await t?.drop();
  });

  it("rejects unauthenticated callers on every project procedure", async () => {
    const c = as(null);
    await expect(c.projects.list({} as never)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(c.projects.get({ id: 1 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(c.projects.update({ id: 1, expectedVersion: 1, changes: { kommentar: "x" }, idempotencyKey: key() })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(c.dashboard.stats()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(c.bvbEea.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("create → get → update → CONFLICT carries the structured payload on error.data", async () => {
    const created = await as(editor).projects.create({ fields: { station: "Gießen Hbf", bahnhofsmanagement: "Gießen", projektstand: "AP" }, idempotencyKey: key() });
    const id = created.project.id;
    expect((await as(viewer).projects.get({ id })).version).toBe(1);

    const ok = await as(editor).projects.update({ id, expectedVersion: 1, changes: { projektstand: "EP" }, idempotencyKey: key() });
    expect(ok.project.version).toBe(2);

    const err = await as(admin).projects.update({ id, expectedVersion: 1, changes: { projektstand: "FA" }, idempotencyKey: key() }).catch(e => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("CONFLICT");
    expect(err.cause.info).toMatchObject({ currentVersion: 2, conflictingFields: ["projektstand"] });
  });

  it("validation: unknown / server-owned fields are rejected, not ignored", async () => {
    const { project } = await as(editor).projects.create({ fields: { station: "X Stadt" }, idempotencyKey: key() });
    for (const bad of [{ id: 5 }, { syncVersion: 99 }, { fullRowData: {} }, { createdAt: "2020-01-01" }] as any[]) {
      await expect(as(editor).projects.update({ id: project.id, expectedVersion: 1, changes: bad, idempotencyKey: key() })).rejects.toBeInstanceOf(TRPCError);
    }
    await expect(as(editor).projects.update({ id: project.id, expectedVersion: 1, changes: {}, idempotencyKey: key() })).rejects.toBeInstanceOf(TRPCError);
    await expect(as(editor).projects.update({ id: project.id, expectedVersion: 1, changes: { kommentar: "x" }, idempotencyKey: "short" })).rejects.toBeInstanceOf(TRPCError);
  });

  it("list: page size is hard-capped, includes no reviews, ignores nothing silently", async () => {
    await expect(as(editor).projects.list({ limit: 101 } as never)).rejects.toBeInstanceOf(TRPCError);
    await expect(as(editor).projects.list({ limit: 10, sort: "fullRowData" } as never)).rejects.toBeInstanceOf(TRPCError);
    await expect(as(editor).projects.list({ limit: 10, showAll: true } as never).then(r => r.items.length)).resolves.toBeLessThanOrEqual(10);
    const page = await as(editor).projects.list({ limit: 10 } as never);
    expect(page.items[0]).not.toHaveProperty("reviews");
  });

  it("reviews/bvb/psv writes cannot target arbitrary columns", async () => {
    await expect(as(editor).reviews.update({ id: 1, field: "projectId" as never, value: "9" })).rejects.toBeInstanceOf(TRPCError);
    await expect(as(editor).bvbEea.update({ id: 1, field: "id" as never, value: "9" })).rejects.toBeInstanceOf(TRPCError);
    await expect(as(editor).psvItk.update({ id: 1, field: "createdAt" as never, value: "9" })).rejects.toBeInstanceOf(TRPCError);
  });

  it("audit is restricted to roles that may view it", async () => {
    await expect(as(viewer).audit.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as(editor).audit.list()).resolves.toBeInstanceOf(Array);
  });

  it("shellSummary is a cheap aggregate, not a project list", async () => {
    const s = await as(viewer).projects.shellSummary();
    expect(Object.keys(s).sort()).toEqual(["lastUpdatedAt", "projectCount"]);
    expect(s.projectCount).toBeGreaterThan(0);
  });

  it("OData is compiled to SQL and capped", async () => {
    const r = await as(editor).odata.queryProjects({ $top: 1000, $filter: "projektstand eq 'EP'" } as never);
    expect(r.value.length).toBeLessThanOrEqual(100);
    expect(r["@odata.count"]).toBeGreaterThan(0);
  });

  it("demo login is disabled in production", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await expect(as(null).auth.demoLogin({ email: "admin@bahn.de", password: "admin" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally { process.env.NODE_ENV = prev; }
  });
});
