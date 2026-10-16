/**
 * Pure helpers behind `scripts/gate/entra-acceptance.ts`, the real-tenant sign-in acceptance procedure.
 * Nothing here talks to a network or prints a token; the script decides what to run, this decides what it means.
 */
import { createHash } from "node:crypto";
import type { Role } from "../domain/permissions";
import type { VerifiedIdentity } from "./oidc";

export const PERSONAS = ["admin", "editor", "viewer", "nogrant"] as const;
export type Persona = (typeof PERSONAS)[number];

/** What the owner must have configured in Entra for each test user. `some` = an explicit list of workspaces, not ALL. */
/**
 * `departments` is the EXACT set the test user must resolve to (the app roles `Department.<Gewerk>` assigned in Entra):
 * the editor holds `Department.ITK` and nothing else; the admin, viewer and no-grant users hold no department role.
 * A missing grant and an unexpected one both fail.
 */
export const EXPECTED: Record<Persona, { role: Role; workspaces: "ALL" | "some" | "none"; departments: readonly string[] }> = {
  admin: { role: "admin", workspaces: "ALL", departments: [] },
  editor: { role: "editor", workspaces: "some", departments: ["ITK"] },
  viewer: { role: "viewer", workspaces: "some", departments: [] },
  nogrant: { role: "viewer", workspaces: "none", departments: [] },
};

export const tokenEnvName = (p: Persona) => `ENTRA_TOKEN_${p.toUpperCase()}`;

const MS_HOSTS = new Set(["login.microsoftonline.com", "sts.windows.net"]);
const tenantOfIssuer = (issuer: string): string | null => {
  try { const u = new URL(issuer); return MS_HOSTS.has(u.hostname) ? (u.pathname.split("/").filter(Boolean)[0] ?? null) : null; } catch { return null; }
};

/**
 * May this configuration produce the verdict `real-entra`? Only when the signing keys are Microsoft's for the SAME tenant the
 * issuers name: every issuer is a Microsoft issuer of one tenant, and the key source is either the default derived from the
 * issuer (no OIDC_JWKS_URI) or exactly that tenant's `login.microsoftonline.com/<tid>/discovery/v2.0/keys`. Any other
 * OIDC_JWKS_URI (a mock, a proxy, another tenant) is verified-against-something-else and can only be a self-test.
 */
export function trustsMicrosoftKeys(issuers: readonly string[], jwksUri: string | undefined): { ok: boolean; reason: string } {
  if (issuers.length === 0) return { ok: false, reason: "no issuer configured" };
  const tenants = new Set(issuers.map(tenantOfIssuer));
  if (tenants.has(null) || tenants.size !== 1) return { ok: false, reason: "issuers are not all Microsoft issuers of one tenant" };
  const tenant = [...tenants][0] as string;
  if (jwksUri === undefined || jwksUri.trim() === "") return { ok: true, reason: "default Microsoft key source derived from the issuer" };
  return jwksUri.trim() === `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`
    ? { ok: true, reason: "OIDC_JWKS_URI equals the tenant's Microsoft key endpoint" }
    : { ok: false, reason: "OIDC_JWKS_URI overrides the key source with something other than the tenant's Microsoft key endpoint; tokens were checked against those keys, not Microsoft's" };
}

export function idpKind(issuer: string): "microsoft-entra" | "other" {
  try {
    const h = new URL(issuer).hostname;
    return h === "login.microsoftonline.com" || h === "sts.windows.net" ? "microsoft-entra" : "other";
  } catch { return "other"; }
}

/** Unverified decode of a JWT payload — diagnostics only; authorization always comes from verifyBearer. */
export function decodePayload(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try { const v = JSON.parse(Buffer.from(part, "base64url").toString("utf8")); return v && typeof v === "object" ? v : null; } catch { return null; }
}

export interface ClaimShape {
  iss: string | null; aud: string | null; ver: string | null;
  hasTid: boolean; hasOid: boolean; idtyp: string | null;
  roles: string[]; grantRoles: string[];
  workspacesClaim: "absent" | "array" | "string" | "other";
  departmentsClaim: "absent" | "array" | "string" | "other";
  lifetimeSeconds: number | null;
}

const kindOf = (v: unknown): "absent" | "array" | "string" | "other" => v === undefined ? "absent" : Array.isArray(v) ? "array" : typeof v === "string" ? "string" : "other";

/** Structure of the token's claims. Values of identity claims (oid, name, e-mail) are deliberately not reported. */
export function claimShape(p: Record<string, unknown>): ClaimShape {
  const roles = Array.isArray(p.roles) ? p.roles.filter((r): r is string => typeof r === "string") : [];
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    iss: typeof p.iss === "string" ? p.iss : null,
    aud: typeof p.aud === "string" ? p.aud : Array.isArray(p.aud) ? p.aud.join(",") : null,
    ver: typeof p.ver === "string" ? p.ver : null,
    hasTid: typeof p.tid === "string", hasOid: typeof p.oid === "string",
    idtyp: typeof p.idtyp === "string" ? p.idtyp : null,
    roles, grantRoles: roles.filter(r => /^(workspace|department)\./i.test(r)),
    workspacesClaim: kindOf(p.workspaces), departmentsClaim: kindOf(p.departments),
    lifetimeSeconds: num(p.exp) !== null && num(p.iat) !== null ? (p.exp as number) - (p.iat as number) : null,
  };
}

/** Stable, non-reversible label for a subject so a report can say "same user" without carrying a tenant/object id. */
export const subjectLabel = (subject: string) => createHash("sha256").update(subject).digest("hex").slice(0, 8);

export interface Assessment { ok: boolean; problems: string[]; warnings: string[] }

/** Compare what the server derived from a verified token with what this test user is supposed to be. */
export function assess(persona: Persona, id: Pick<VerifiedIdentity, "role" | "workspaces" | "departments">, shape: ClaimShape): Assessment {
  const want = EXPECTED[persona], problems: string[] = [], warnings: string[] = [];
  if (id.role !== want.role) problems.push(`role is "${id.role}", expected "${want.role}" (assign the app role to this user in Enterprise applications → Users and groups)`);
  const ws = id.workspaces;
  if (want.workspaces === "ALL" && ws !== "ALL") problems.push(`workspaces are ${JSON.stringify(ws)}, expected the explicit all-workspaces grant (app role "Workspace.ALL" or claim ["ALL"])`);
  if (want.workspaces === "some" && (ws === "ALL" || ws.length === 0)) problems.push(`workspaces are ${JSON.stringify(ws)}, expected an explicit non-empty list (app roles "Workspace.<Name>")`);
  if (want.workspaces === "none" && !(Array.isArray(ws) && ws.length === 0)) problems.push(`workspaces are ${JSON.stringify(ws)}, expected none — this user is the "Angemeldet — noch keine Freigabe" case`);
  const missing = want.departments.filter(d => !id.departments.includes(d));
  const unexpected = id.departments.filter(d => !want.departments.includes(d));
  if (missing.length) problems.push(`missing department grant(s) ${JSON.stringify(missing)} (assign the app role "Department.<Gewerk>" to this user)`);
  if (unexpected.length) problems.push(`unexpected department grant(s) ${JSON.stringify([...unexpected].sort())}; this persona is meant to hold ${want.departments.length ? JSON.stringify(want.departments) : "none"}`);
  if (shape.workspacesClaim === "string" || shape.departmentsClaim === "string")
    warnings.push("the tenant emits workspaces/departments as a single string, which the server (default-deny) ignores — grant them as app roles (Workspace.<Name>, Department.<Gewerk>) instead");
  if (shape.idtyp === "app") warnings.push("this is an app-only token (idtyp=app), not a signed-in user");
  if (!shape.hasTid || !shape.hasOid) warnings.push("token has no tid/oid; the identity falls back to sub, which is not tenant-scoped");
  return { ok: problems.length === 0, problems, warnings };
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

/** What the deployed server's `auth.session` says must equal what local verification derived — order does not matter. */
export function compareWithServer(
  id: Pick<VerifiedIdentity, "role" | "workspaces" | "departments">,
  server: { status: number; role?: unknown; workspaces?: unknown; departments?: unknown },
): string[] {
  const problems: string[] = [];
  if (server.status !== 200) return [`the deployed server answered auth.session with HTTP ${server.status}`];
  if (server.role !== id.role) problems.push(`role: deployed server says ${JSON.stringify(server.role)}, local verification says "${id.role}"`);
  const listOrAll = (v: unknown): "ALL" | string[] | null => (v === "ALL" ? "ALL" : Array.isArray(v) && v.every(x => typeof x === "string") ? (v as string[]) : null);
  const w = listOrAll(server.workspaces);
  if (w === null || (w === "ALL") !== (id.workspaces === "ALL") || (w !== "ALL" && id.workspaces !== "ALL" && !sameSet(w, id.workspaces)))
    problems.push(`workspaces: deployed server says ${JSON.stringify(server.workspaces)}, local verification says ${JSON.stringify(id.workspaces)}`);
  const d = listOrAll(server.departments);
  if (d === null || d === "ALL" || !sameSet(d, id.departments)) problems.push(`departments: deployed server says ${JSON.stringify(server.departments)}, local verification says ${JSON.stringify(id.departments)}`);
  return problems;
}

export type Verdict = "real-entra" | "selftest-not-entra" | "fail" | "not-run";

/**
 * The one place the certification label is decided. `real-entra` needs: something ran, nothing failed, and the configuration
 * is Microsoft's end to end (issuers AND signing-key source, see trustsMicrosoftKeys). The issuer string alone is never enough.
 */
export function decideVerdict(i: { ran: number; failed: boolean; issuers: readonly string[]; jwksUri: string | undefined }): { verdict: Verdict; entra: boolean; keySource: string } {
  const trust = trustsMicrosoftKeys(i.issuers, i.jwksUri);
  const entra = i.issuers.length > 0 && i.issuers.every(x => idpKind(x) === "microsoft-entra") && trust.ok;
  const keySource = i.jwksUri?.trim() ? `OIDC_JWKS_URI override (${trust.ok ? "accepted" : "NOT Microsoft's"}): ${trust.reason}` : trust.reason;
  const verdict: Verdict = i.ran === 0 ? "not-run" : i.failed ? "fail" : entra ? "real-entra" : "selftest-not-entra";
  return { verdict, entra, keySource };
}
