/**
 * OIDC access-token verification (Microsoft Entra ID or any OIDC provider).
 * The server validates signature, issuer, audience and expiry on every token;
 * nothing the browser stores is trusted for identity or role.
 *
 * Configuration (all required to enable; otherwise the bearer path is off):
 *   OIDC_ISSUER     e.g. https://login.microsoftonline.com/<tenant>/v2.0
 *   OIDC_AUDIENCE   the API's application (client) id / App ID URI
 *   OIDC_JWKS_URI   optional; defaults to <tenant>/discovery/v2.0/keys for Entra
 *
 * Authorization data comes from token claims:
 *   roles        app roles: "admin" | "editor" | "viewer" (highest wins)
 *   workspaces   optional string[] restricting Bahnhofsmanagement access
 *   departments  optional string[] enabling department review actions
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Role } from "../domain/permissions";

export interface VerifiedIdentity {
  /** stable subject: `${tid}:${oid}` for Entra, `sub` otherwise */
  subject: string;
  name: string | null;
  email: string | null;
  role: Role;
  workspaces: string[];
  departments: string[];
}

export interface OidcConfig { issuer: string; audience: string; jwks: JWTVerifyGetKey }

export function oidcConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OidcConfig | null {
  const issuer = env.OIDC_ISSUER, audience = env.OIDC_AUDIENCE;
  if (!issuer || !audience) return null;
  const tenant = /login\.microsoftonline\.com\/([^/]+)/.exec(issuer)?.[1];
  const uri = env.OIDC_JWKS_URI ?? (tenant ? `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys` : `${issuer.replace(/\/$/, "")}/.well-known/jwks.json`);
  return { issuer, audience, jwks: createRemoteJWKSet(new URL(uri), { cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 }) };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export async function verifyBearer(token: string, cfg: OidcConfig): Promise<VerifiedIdentity> {
  const { payload } = await jwtVerify(token, cfg.jwks, {
    issuer: cfg.issuer,
    audience: cfg.audience,
    algorithms: ["RS256", "ES256", "PS256"],
    clockTolerance: 30,
  });
  const roles = strings(payload.roles).map(r => r.toLowerCase());
  const role: Role = roles.includes("admin") ? "admin" : roles.includes("editor") ? "editor" : "viewer"; // least privilege by default
  const tid = typeof payload.tid === "string" ? payload.tid : null;
  const oid = typeof payload.oid === "string" ? payload.oid : null;
  const subject = tid && oid ? `${tid}:${oid}` : String(payload.sub ?? "");
  if (!subject) throw new Error("token has no subject");
  return {
    subject,
    name: typeof payload.name === "string" ? payload.name : null,
    email: typeof payload.email === "string" ? payload.email : typeof payload.preferred_username === "string" ? payload.preferred_username : null,
    role,
    workspaces: strings(payload.workspaces),
    departments: strings(payload.departments),
  };
}
