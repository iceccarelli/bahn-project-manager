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
export const EXPECTED: Record<Persona, { role: Role; workspaces: "ALL" | "some" | "none" }> = {
  admin: { role: "admin", workspaces: "ALL" },
  editor: { role: "editor", workspaces: "some" },
  viewer: { role: "viewer", workspaces: "some" },
  nogrant: { role: "viewer", workspaces: "none" },
};

export const tokenEnvName = (p: Persona) => `ENTRA_TOKEN_${p.toUpperCase()}`;

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
export function assess(persona: Persona, id: Pick<VerifiedIdentity, "role" | "workspaces">, shape: ClaimShape): Assessment {
  const want = EXPECTED[persona], problems: string[] = [], warnings: string[] = [];
  if (id.role !== want.role) problems.push(`role is "${id.role}", expected "${want.role}" (assign the app role to this user in Enterprise applications → Users and groups)`);
  const ws = id.workspaces;
  if (want.workspaces === "ALL" && ws !== "ALL") problems.push(`workspaces are ${JSON.stringify(ws)}, expected the explicit all-workspaces grant (app role "Workspace.ALL" or claim ["ALL"])`);
  if (want.workspaces === "some" && (ws === "ALL" || ws.length === 0)) problems.push(`workspaces are ${JSON.stringify(ws)}, expected an explicit non-empty list (app roles "Workspace.<Name>")`);
  if (want.workspaces === "none" && !(Array.isArray(ws) && ws.length === 0)) problems.push(`workspaces are ${JSON.stringify(ws)}, expected none — this user is the "Angemeldet — noch keine Freigabe" case`);
  if (shape.workspacesClaim === "string" || shape.departmentsClaim === "string")
    warnings.push("the tenant emits workspaces/departments as a single string, which the server (default-deny) ignores — grant them as app roles (Workspace.<Name>, Department.<Gewerk>) instead");
  if (shape.idtyp === "app") warnings.push("this is an app-only token (idtyp=app), not a signed-in user");
  if (!shape.hasTid || !shape.hasOid) warnings.push("token has no tid/oid; the identity falls back to sub, which is not tenant-scoped");
  return { ok: problems.length === 0, problems, warnings };
}
