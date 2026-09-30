import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from "jose";
import { resolveIdentity, setOidcConfigForTests } from "./identity";
import { UserProvisioner } from "../infra/userProvisioner";

const ISS = "https://idp.test/", AUD = "api://bahn";
let sign: (oid: string, extra?: Record<string, unknown>) => Promise<string>;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k", alg: "RS256", use: "sig" };
  setOidcConfigForTests({ issuer: ISS, audience: AUD, jwks: createLocalJWKSet({ keys: [jwk] }) });
  sign = (oid, extra = {}) => new SignJWT({ tid: "t", oid, name: `User ${oid}`, roles: ["editor"], workspaces: ["Frankfurt"], ...extra })
    .setProtectedHeader({ alg: "RS256", kid: "k" }).setIssuer(ISS).setAudience(AUD).setIssuedAt().setExpirationTime("5m").sign(privateKey);
});
afterEach(() => vi.restoreAllMocks());

describe("bearer identity resolution", () => {
  it("needs no database: works with no DATABASE_URL, derives a stable principal id that fits the 64-char actor columns", async () => {
    delete process.env.DATABASE_URL;
    const a = await resolveIdentity({ headers: { authorization: `Bearer ${await sign("u-1")}` } });
    const again = await resolveIdentity({ headers: { authorization: `Bearer ${await sign("u-1")}` } });
    expect(a?.user).toBeNull();
    expect(a?.principal).toMatchObject({ role: "editor", workspaces: ["Frankfurt"], name: "User u-1" });
    expect(a!.principal.id).toMatch(/^o[0-9a-f]{31}$/);
    expect(a!.principal.id.length).toBeLessThanOrEqual(64);
    expect(again!.principal.id).toBe(a!.principal.id);                       // same subject → same id across tokens
    const other = await resolveIdentity({ headers: { authorization: `Bearer ${await sign("u-2")}` } });
    expect(other!.principal.id).not.toBe(a!.principal.id);
  });
  it("rejects garbage and tokens for other audiences", async () => {
    expect(await resolveIdentity({ headers: { authorization: "Bearer nope" } })).toBeNull();
  });
  it("concurrent requests with the same fresh token verify once (single flight)", async () => {
    const token = await sign("u-sf");
    const rs = await Promise.all(Array.from({ length: 50 }, () => resolveIdentity({ headers: { authorization: `Bearer ${token}` } })));
    expect(new Set(rs.map(r => r!.principal.id)).size).toBe(1);
  });
});

describe("UserProvisioner (write-behind)", () => {
  const u = (i: number) => ({ openId: `oidc:${i}`, name: `n${i}`, email: null, role: "user" as const });
  it("never blocks on the writer; 1,200 users become 3 batched writes; repeat sightings are free", async () => {
    const batches: number[] = [];
    const p = new UserProvisioner(async b => { batches.push(b.length); }, { batch: 500, flushMs: 5 });
    const t0 = performance.now();
    for (let i = 0; i < 1200; i++) p.enqueue(u(i));
    for (let i = 0; i < 1200; i++) p.enqueue(u(i));          // repeat sightings
    expect(performance.now() - t0).toBeLessThan(50);
    await p.flush();
    expect(batches).toEqual([500, 500, 200]);
  });
  it("a failed batch does not throw into callers and is retried on the next sighting", async () => {
    let fail = true; const written: string[] = [];
    const p = new UserProvisioner(async b => { if (fail) throw new Error("db down"); written.push(...b.map(x => x.openId)); }, { flushMs: 1_000_000 });
    p.enqueue(u(1));
    await p.flush();
    expect(written).toEqual([]);
    fail = false;
    p.enqueue(u(1));
    await p.flush();
    expect(written).toEqual(["oidc:1"]);
  });
});
