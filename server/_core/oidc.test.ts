import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from "jose";
import { grantsFromRoles, listOf, oidcConfigFromEnv, verifyBearer, type OidcConfig } from "./oidc";
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

describe("Entra v1 and v2 tokens (issuer and audience lists)", () => {
  const V1 = "https://sts.windows.net/tenant-1/", GUID = "11111111-2222-3333-4444-555555555555";
  it("listOf keeps a single value a string and splits comma/space lists", () => {
    expect(listOf(ISS)).toBe(ISS);
    expect(listOf(`${ISS}, ${V1}`)).toEqual([ISS, V1]);
    expect(listOf(`api://bahn ${GUID}`)).toEqual(["api://bahn", GUID]);
  });
  it("a v1 token (sts.windows.net issuer, App ID URI audience) verifies when both spellings are configured — and only then", async () => {
    const both: OidcConfig = { ...cfg, issuer: [ISS, V1], audience: ["api://bahn", GUID] };
    expect((await verifyBearer(await sign({ tid: "t", oid: "o-3", roles: ["editor"] }, { iss: V1 }), both)).role).toBe("editor");
    expect((await verifyBearer(await sign({ tid: "t", oid: "o-3" }, { aud: GUID }), both)).subject).toBe("t:o-3");
    await expect(verifyBearer(await sign({ sub: "s" }, { iss: V1 }), cfg)).rejects.toThrow();
    await expect(verifyBearer(await sign({ sub: "s" }, { iss: "https://sts.windows.net/other/" }), both)).rejects.toThrow();
    await expect(verifyBearer(await sign({ sub: "s" }, { aud: "api://other" }), both)).rejects.toThrow();
  });
  it("the JWKS URI is derived from the first issuer, v1 spelling included", () => {
    expect(oidcConfigFromEnv({ OIDC_ISSUER: `${V1},${ISS}`, OIDC_AUDIENCE: "a" } as never)).not.toBeNull();
    expect(oidcConfigFromEnv({ OIDC_ISSUER: ISS } as never)).toBeNull();
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
  it("production refuses demo/legacy authentication outright (a mis-set flag stops the boot)", () => {
    const base = { NODE_ENV: "production", DATABASE_URL: "mysql://x", JWT_SECRET: "x".repeat(40), OIDC_ISSUER: ISS, OIDC_AUDIENCE: AUD, REDIS_URL: "redis://r" };
    expect(() => assertProductionConfig({ ...base } as never)).not.toThrow();
    expect(() => assertProductionConfig({ ...base, ALLOW_DEMO_LOGIN: "1" } as never)).toThrow(/ALLOW_DEMO_LOGIN/);
    expect(() => assertProductionConfig({ ...base, ALLOW_DEMO_LOGIN: "true" } as never)).toThrow(/ALLOW_DEMO_LOGIN/);
    expect(() => assertProductionConfig({ ...base, ALLOW_DEMO_LOGIN: "0" } as never)).not.toThrow();
    expect(() => assertProductionConfig({ ...base, LEGACY_USER_WORKSPACES: "ALL" } as never)).toThrow(/LEGACY_USER_WORKSPACES/);
    expect(() => assertProductionConfig({ ...base, OAUTH_SERVER_URL: "https://oauth.example" } as never)).toThrow(/OAUTH_SERVER_URL/);
    // OIDC is the only way in: a demo flag cannot substitute for it
    const { OIDC_ISSUER: _drop, ...noIdp } = base;
    expect(() => assertProductionConfig({ ...noIdp, ALLOW_DEMO_LOGIN: "1" } as never)).toThrow(/OIDC_ISSUER/);
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

describe("workspace / department grants carried as Entra app roles (the claim Entra can actually emit)", () => {
  it("Workspace.<BM> and Department.<Gewerk> roles grant exactly those, with ASCII spellings resolving to canonical names", () => {
    expect(grantsFromRoles(["editor", "Workspace.Frankfurt", "workspace.giessen", "Workspace.Saarbruecken", "Department.EEA", "department.itk"]))
      .toEqual({ workspaces: ["Frankfurt", "Gießen", "Saarbrücken"], departments: ["EEA", "ITK"] });
    expect(grantsFromRoles(["Workspace.ALL"]).workspaces).toEqual(["ALL"]);
  });
  it("anything that is not exactly a known name grants nothing (typos mean less access, never more)", () => {
    expect(grantsFromRoles(["Workspace.", "Workspace.Atlantis", "Workspace.*", "Department.Foo", "Workspaces.Frankfurt", "Frankfurt", "EEA", "admin"]))
      .toEqual({ workspaces: [], departments: [] });
  });
  it("a token whose only grants are app roles resolves to the same principal as the array claims; both sources union", async () => {
    const viaRoles = await verifyBearer(await sign({ tid: "t", oid: "r-1", roles: ["Editor", "Workspace.Kassel", "Department.ITK"] }), cfg);
    const viaClaims = await verifyBearer(await sign({ tid: "t", oid: "r-1", roles: ["Editor"], workspaces: ["Kassel"], departments: ["ITK"] }), cfg);
    expect(viaRoles).toEqual(viaClaims);
    const both = await verifyBearer(await sign({ tid: "t", oid: "r-2", roles: ["Workspace.Mainz", "Department.EEA"], workspaces: ["Kassel"], departments: ["ITK"] }), cfg);
    expect(both.workspaces).toEqual(["Kassel", "Mainz"]);
    expect([...both.departments].sort()).toEqual(["EEA", "ITK"]);
    expect(both.role).toBe("viewer"); // grants never promote a role
  });
  it("Workspace.ALL is the explicit all-workspaces grant, and a grant-role never makes someone an admin", async () => {
    const id = await verifyBearer(await sign({ tid: "t", oid: "r-3", roles: ["Viewer", "Workspace.ALL"] }), cfg);
    expect(id.workspaces).toBe("ALL");
    expect(id.role).toBe("viewer");
    const noGrant = await verifyBearer(await sign({ tid: "t", oid: "r-4", roles: ["Workspace.Atlantis"] }), cfg);
    expect(noGrant.workspaces).toEqual([]); // default-deny survives an unknown name
  });
});
