import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from "jose";
import { verifyBearer, type OidcConfig } from "./oidc";
import { assertProductionConfig, sameOriginForCookies } from "./security";

const ISS = "https://login.microsoftonline.com/tenant-1/v2.0", AUD = "api://bahn";
let cfg: OidcConfig, sign: (claims: Record<string, unknown>, o?: { iss?: string; aud?: string; exp?: string; key?: CryptoKey }) => Promise<string>;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  cfg = { issuer: ISS, audience: AUD, jwks: createLocalJWKSet({ keys: [jwk] }) };
  sign = (claims, o = {}) =>
    new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(o.iss ?? ISS).setAudience(o.aud ?? AUD)
      .setIssuedAt().setExpirationTime(o.exp ?? "5m").sign(o.key ?? privateKey);
});

describe("OIDC bearer verification (Entra-shaped tokens)", () => {
  it("accepts a valid token and derives identity + role from claims, not from the client", async () => {
    const id = await verifyBearer(await sign({ tid: "t", oid: "o-1", name: "Markus", preferred_username: "m@bahn.de", roles: ["Editor"], workspaces: ["Frankfurt"], departments: ["ITK"] }), cfg);
    expect(id).toMatchObject({ subject: "t:o-1", name: "Markus", email: "m@bahn.de", role: "editor", workspaces: ["Frankfurt"], departments: ["ITK"] });
  });
  it("missing roles AND missing workspaces → viewer with no workspace access (never an implicit grant)", async () => {
    const id = await verifyBearer(await sign({ tid: "t", oid: "o-2", name: "Nobody" }), cfg);
    expect(id.role).toBe("viewer");
    expect(id.workspaces).toEqual([]);
    expect(id.departments).toEqual([]);
    const junk = await verifyBearer(await sign({ sub: "s", roles: ["superuser", "Owner"], workspaces: "ALL" }), cfg);
    expect(junk.role).toBe("viewer");
    expect(junk.workspaces).toEqual([]);
    expect((await verifyBearer(await sign({ sub: "s", roles: ["editor"], workspaces: ["ALL"] }), cfg)).workspaces).toBe("ALL");
  });
  it("no roles claim → viewer (least privilege); admin wins over editor", async () => {
    expect((await verifyBearer(await sign({ sub: "s" }), cfg)).role).toBe("viewer");
    expect((await verifyBearer(await sign({ sub: "s", roles: ["editor", "admin"] }), cfg)).role).toBe("admin");
  });
  it("rejects wrong issuer, wrong audience, expired, and a token signed by another key", async () => {
    await expect(verifyBearer(await sign({ sub: "s" }, { iss: "https://evil.example" }), cfg)).rejects.toThrow();
    await expect(verifyBearer(await sign({ sub: "s" }, { aud: "api://other" }), cfg)).rejects.toThrow();
    await expect(verifyBearer(await sign({ sub: "s" }, { exp: "-1m" as never }), cfg)).rejects.toThrow();
    const other = (await generateKeyPair("RS256")).privateKey;
    await expect(verifyBearer(await sign({ sub: "s" }, { key: other }), cfg)).rejects.toThrow();
  });
  it("rejects unsigned (alg=none) tokens", async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const none = `${b64({ alg: "none" })}.${b64({ iss: ISS, aud: AUD, sub: "x", exp: 9999999999, roles: ["admin"] })}.`;
    await expect(verifyBearer(none, cfg)).rejects.toThrow();
  });
});

describe("production guards", () => {
  it("refuses to boot with the development JWT secret or without an identity provider", () => {
    expect(() => assertProductionConfig({ NODE_ENV: "production", DATABASE_URL: "mysql://x" } as never)).toThrow(/JWT_SECRET/);
    expect(() => assertProductionConfig({ NODE_ENV: "production", DATABASE_URL: "mysql://x", JWT_SECRET: "demo-jwt-secret-change-in-production-2024" } as never)).toThrow(/JWT_SECRET/);
    expect(() => assertProductionConfig({ NODE_ENV: "production", DATABASE_URL: "mysql://x", JWT_SECRET: "x".repeat(40) } as never)).toThrow(/OIDC/);
    expect(() => assertProductionConfig({ NODE_ENV: "production", DATABASE_URL: "mysql://x", JWT_SECRET: "x".repeat(40), OIDC_ISSUER: ISS, OIDC_AUDIENCE: AUD, REDIS_URL: "redis://r" } as never)).not.toThrow();
    // Redis is the shared transport: required unless a single node is declared
    expect(() => assertProductionConfig({ NODE_ENV: "production", DATABASE_URL: "mysql://x", JWT_SECRET: "x".repeat(40), OIDC_ISSUER: ISS, OIDC_AUDIENCE: AUD } as never)).toThrow(/REDIS_URL/);
    expect(() => assertProductionConfig({ NODE_ENV: "production", DATABASE_URL: "mysql://x", JWT_SECRET: "x".repeat(40), OIDC_ISSUER: ISS, OIDC_AUDIENCE: AUD, ALLOW_SINGLE_INSTANCE: "1" } as never)).not.toThrow();
    expect(() => assertProductionConfig({ NODE_ENV: "production", DATABASE_URL: "mysql://x", JWT_SECRET: "x".repeat(40), OIDC_ISSUER: ISS, REDIS_URL: "redis://r" } as never)).toThrow(/OIDC_AUDIENCE/);
    expect(() => assertProductionConfig({ NODE_ENV: "development" } as never)).not.toThrow();
  });
  it("CSRF: cross-origin cookie-authenticated POST is rejected; same-origin, bearer and non-browser pass", () => {
    const run = (headers: Record<string, string>, method = "POST") => {
      let status = 0; let nexted = false;
      sameOriginForCookies({ method, headers } as never, { status: (s: number) => ({ json: () => { status = s; } }) } as never, () => { nexted = true; });
      return { status, nexted };
    };
    expect(run({ origin: "https://evil.example", host: "bahn.example" }).status).toBe(403);
    expect(run({ origin: "https://bahn.example", host: "bahn.example" }).nexted).toBe(true);
    expect(run({ origin: "https://evil.example", host: "bahn.example", authorization: "Bearer x" }).nexted).toBe(true);
    expect(run({ host: "bahn.example" }).nexted).toBe(true);
    expect(run({ origin: "https://evil.example", host: "bahn.example" }, "GET").nexted).toBe(true);
  });
});
