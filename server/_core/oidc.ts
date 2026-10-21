/**
 * OIDC access-token verification (Microsoft Entra ID or any OIDC provider).
 * The server validates signature, issuer, audience and expiry on every token;
 * nothing the browser stores is trusted for identity or role.
 *
 * Configuration (all required to enable; otherwise the bearer path is off):
 *   OIDC_ISSUER     e.g. https://login.microsoftonline.com/<tenant>/v2.0 — the FIRST entry is the discovery issuer
 *   OIDC_AUDIENCE   the API's application (client) id / App ID URI
 *
 * Both accept a comma/space separated list. Microsoft Entra issues v1 tokens (iss https://sts.windows.net/<tid>/,
 * aud api://<id>) unless the API app registration sets accessTokenAcceptedVersion=2 (iss …/v2.0, aud <client-id>);
 * listing both spellings makes the first real sign-in work either way. Nothing else is relaxed: signature,
 * algorithm, expiry and "one of exactly these" issuers/audiences are still enforced.
 *   OIDC_JWKS_URI   optional; defaults to <tenant>/discovery/v2.0/keys for Entra
 *
 * Authorization data comes from token claims:
 *   roles        app roles: "admin" | "editor" | "viewer" (highest wins)
 *   workspaces   string[] of Bahnhofsmanagement names, or containing "ALL" for an explicit
 *                all-workspaces grant. Missing/empty = NO workspace access (default-deny).
 *   departments  optional string[] enabling department review actions
 *
 * Entra cannot natively emit those two arrays (a claims-mapping policy emits one string per claim, and only
 * app roles and groups are multi-valued), so the same grants may ALSO be assigned as app roles, which land in
 * the multi-valued `roles` claim: `Workspace.Frankfurt`, `Workspace.ALL`, `Department.EEA` (see grantsFromRoles).
 * Both sources are unioned; either one alone is enough. Nothing is inferred from anything else.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { toCanonicalBm } from "@shared/bahnhofsmanagement";
import { DEPARTMENTS } from "@shared/validation";
import type { Role, WorkspaceAccess } from "../domain/permissions";

export interface VerifiedIdentity {
  /** stable subject: `${tid}:${oid}` for Entra, `sub` otherwise */
  subject: string;
  name: string | null;
  email: string | null;
  role: Role;
  workspaces: WorkspaceAccess;
  departments: string[];
}

export interface OidcConfig { issuer: string | string[]; audience: string | string[]; jwks: JWTVerifyGetKey }

/** "a, b" → ["a","b"]; a single value stays a plain string (what jose and the tests have always seen). */
export function listOf(v: string): string | string[] {
  const parts = v.split(/[,\s]+/).map(x => x.trim()).filter(Boolean);
  return parts.length === 1 ? (parts[0] as string) : parts;
}

export function oidcConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OidcConfig | null {
  const issuer = env.OIDC_ISSUER, audience = env.OIDC_AUDIENCE;
  if (!issuer || !audience) return null;
  const issuers = listOf(issuer);
  const first = Array.isArray(issuers) ? (issuers[0] as string) : issuers;
  const tenant = /login\.microsoftonline\.com\/([^/]+)/.exec(first)?.[1] ?? /sts\.windows\.net\/([^/]+)/.exec(first)?.[1];
  const uri = env.OIDC_JWKS_URI ?? (tenant ? `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys` : `${first.replace(/\/$/, "")}/.well-known/jwks.json`);
  return { issuer: issuers, audience: listOf(audience), jwks: createRemoteJWKSet(new URL(uri), { cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 }) };
}

/** Explicit grant only: the literal "ALL" (any case) or a list of names. Anything else is no access. */
export function workspacesFromClaim(v: unknown): WorkspaceAccess {
  const list = strings(v).map(s => s.trim()).filter(Boolean);
  return list.some(s => s.toUpperCase() === "ALL") ? "ALL" : list;
}

/**
 * Workspace / department grants carried as app roles. App-role values may not contain spaces and are best kept ASCII,
 * which fits the Bahnhofsmanagement vocabulary (`Workspace.Giessen`, `Workspace.Saarbruecken` resolve to the canonical
 * names). Anything that is not exactly `Workspace.<known BM | ALL>` / `Department.<known Gewerk>` grants nothing:
 * unknown names are dropped, never passed through, so a typo in Entra means less access, not more.
 */
export function grantsFromRoles(roles: readonly string[]): { workspaces: string[]; departments: string[] } {
  const workspaces = new Set<string>(), departments = new Set<string>();
  for (const r of roles) {
    const m = /^(workspace|department)\.(.+)$/i.exec(r.trim());
    if (!m) continue;
    const name = (m[2] as string).trim();
    if (m[1]!.toLowerCase() === "workspace") {
      if (name.toUpperCase() === "ALL") workspaces.add("ALL");
      else { const bm = toCanonicalBm(name); if (bm) workspaces.add(bm); }
    } else {
      const d = DEPARTMENTS.find(x => x.toLowerCase() === name.toLowerCase());
      if (d) departments.add(d);
    }
  }
  return { workspaces: [...workspaces], departments: [...departments] };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

const MICROSOFT_ISSUER_HOSTS = new Set(["login.microsoftonline.com", "sts.windows.net"]);

/** The tenant id a Microsoft issuer URL names (`…/<tid>/v2.0`, `sts.windows.net/<tid>/`), or null for any other issuer. */
export function microsoftTenantOfIssuer(issuer: string): string | null {
  try {
    const u = new URL(issuer);
    return MICROSOFT_ISSUER_HOSTS.has(u.hostname) ? (u.pathname.split("/").filter(Boolean)[0] ?? null) : null;
  } catch { return null; }
}

export async function verifyBearer(token: string, cfg: OidcConfig): Promise<VerifiedIdentity> {
  const { payload } = await jwtVerify(token, cfg.jwks, {
    issuer: cfg.issuer,
    audience: cfg.audience,
    algorithms: ["RS256", "ES256", "PS256"],
    clockTolerance: 30,
    requiredClaims: ["exp"], // jose checks exp only when present: without this a token with no expiry would be valid forever
  });
  const rawRoles = strings(payload.roles);
  const roles = rawRoles.map(r => r.toLowerCase());
  const fromRoles = grantsFromRoles(rawRoles);
  const role: Role = roles.includes("admin") ? "admin" : roles.includes("editor") ? "editor" : "viewer"; // unknown/missing roles = least privilege
  const tid = typeof payload.tid === "string" ? payload.tid : null;
  const oid = typeof payload.oid === "string" ? payload.oid : null;
  // Microsoft Entra: the identity IS tenant + object id. A Microsoft token without both, or whose tid is not the tenant of the
  // issuer that signed it, is refused — never degraded to the app-pairwise `sub`, which would be a second, unrelated identity space.
  const msTenant = typeof payload.iss === "string" ? microsoftTenantOfIssuer(payload.iss) : null;
  if (msTenant !== null && (!tid || !oid || tid.toLowerCase() !== msTenant.toLowerCase())) throw new Error("Microsoft token without a matching tenant/object identity");
  // Entra GUIDs are lowercase; normalising makes "one person, one subject" independent of how a token spells them
  const subject = tid && oid ? (msTenant !== null ? `${tid.toLowerCase()}:${oid.toLowerCase()}` : `${tid}:${oid}`) : String(payload.sub ?? "");
  if (!subject) throw new Error("token has no subject");
  return {
    subject,
    name: typeof payload.name === "string" ? payload.name : null,
    email: typeof payload.email === "string" ? payload.email : typeof payload.preferred_username === "string" ? payload.preferred_username : null,
    role,
    workspaces: workspacesFromClaim([...strings(payload.workspaces), ...fromRoles.workspaces]),
    departments: [...new Set([...strings(payload.departments), ...fromRoles.departments])],
  };
}
