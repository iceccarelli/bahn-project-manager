/**
 * Cookie-session users (development demo login / legacy OAuth) act under their numeric id. `upsertUser` must store that id in
 * `users.principalId` — otherwise department-notification recipient resolution (which reads principalId) never sees them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasTestDb, createTestDatabase, TEST_DB_URL } from "./testing/testDb";

describe.skipIf(!hasTestDb)("upsertUser stores the principal id of cookie-session users (real DB)", () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let db: typeof import("./db");
  beforeAll(async () => {
    t = await createTestDatabase(4);
    process.env.DATABASE_URL = `${TEST_DB_URL}/${t.name}`;
    db = await import("./db");
  });
  afterAll(async () => { await db?.closeDb?.(); await t?.drop(); });

  it("a demo user gets principalId = its numeric id on first upsert, keeps it on later ones; an OIDC row is left to the provisioner", async () => {
    await db.upsertUser({ openId: "demo-admin", name: "Admin", email: "admin@bahn.de", role: "admin", loginMethod: "demo", lastSignedIn: new Date() });
    const [[row]] = (await t.pool.query("SELECT id, principalId FROM users WHERE openId='demo-admin'")) as unknown as [Array<{ id: number; principalId: string | null }>];
    expect(row!.principalId).toBe(String(row!.id));
    await db.upsertUser({ openId: "demo-admin", name: "Admin 2", loginMethod: "demo", lastSignedIn: new Date() });
    const [[again]] = (await t.pool.query("SELECT id, principalId, name FROM users WHERE openId='demo-admin'")) as unknown as [Array<{ id: number; principalId: string | null; name: string }>];
    expect(again!.principalId).toBe(String(row!.id));
    expect(again!.name).toBe("Admin 2");
    await db.upsertUser({ openId: "oidc:t:o", name: "O", loginMethod: "oidc", lastSignedIn: new Date() });
    const [[oidc]] = (await t.pool.query("SELECT principalId FROM users WHERE openId='oidc:t:o'")) as unknown as [Array<{ principalId: string | null }>];
    expect(oidc!.principalId).toBeNull();
  });
});
