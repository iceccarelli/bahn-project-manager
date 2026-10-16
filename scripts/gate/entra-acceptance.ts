#!/usr/bin/env -S pnpm exec tsx
/**
 * Real-tenant Microsoft Entra sign-in acceptance. NOT part of CI (CI has no tenant); run by an owner who has one.
 *
 * Takes already-issued ACCESS tokens of up to four test users (see docs/entra-acceptance.md for how to obtain them
 * without printing them) and checks, with the server's own verification code against the tenant's real JWKS:
 *   1. every token verifies (signature, issuer, audience, expiry) under the OIDC_ISSUER / OIDC_AUDIENCE that production will use;
 *   2. the role / workspaces / departments the server derives are what that persona is meant to have;
 *   3. (with ENTRA_ACCEPTANCE_URL) the deployed server derives the same principal via auth.session, rejects a
 *      tampered token and anonymous access.
 *
 *   OIDC_ISSUER=… OIDC_AUDIENCE=… ENTRA_TOKEN_ADMIN=… ENTRA_TOKEN_EDITOR=… ENTRA_TOKEN_VIEWER=… ENTRA_TOKEN_NOGRANT=… \
 *   [ENTRA_ACCEPTANCE_URL=https://host] pnpm exec tsx scripts/gate/entra-acceptance.ts > artifacts/entra-acceptance.json
 *
 * Exit 0 only when at least one persona ran, every persona that ran passed, and the issuer is Microsoft's.
 * Exit 2 = nothing could be run (no tokens). A token, an object id, a name or an e-mail is never printed.
 * Against a non-Microsoft issuer (the local mock IdP) the verdict can never be "real-entra": it is "selftest-not-entra"
 * and only with ENTRA_ACCEPTANCE_ALLOW_NON_ENTRA=1.
 */
import { assess, claimShape, decodePayload, idpKind, PERSONAS, subjectLabel, tokenEnvName, type Persona } from "../../server/_core/entraAcceptance";
import { oidcConfigFromEnv, verifyBearer } from "../../server/_core/oidc";

interface Row { persona: Persona; status: "pass" | "fail" | "not-run"; problems: string[]; warnings: string[]; shape?: ReturnType<typeof claimShape>; subject?: string; server?: unknown }

const cfg = oidcConfigFromEnv();
const url = process.env.ENTRA_ACCEPTANCE_URL?.replace(/\/$/, "");
const allowNonEntra = process.env.ENTRA_ACCEPTANCE_ALLOW_NON_ENTRA === "1";
const issuers = cfg ? ([] as string[]).concat(cfg.issuer) : [];
const entra = issuers.length > 0 && issuers.every(i => idpKind(i) === "microsoft-entra");

async function session(token?: string): Promise<{ status: number; data: any }> {
  const r = await fetch(`${url}/api/trpc/auth.session?input=${encodeURIComponent(JSON.stringify({ json: undefined }))}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: (j as any)?.result?.data?.json ?? null };
}

const rows: Row[] = [];
const extra: Array<{ name: string; status: "pass" | "fail"; detail?: string }> = [];

if (!cfg) {
  console.error("OIDC_ISSUER and OIDC_AUDIENCE must be set to the values the production server uses.");
  process.exit(2);
}

for (const persona of PERSONAS) {
  const token = process.env[tokenEnvName(persona)]?.trim();
  if (!token) { rows.push({ persona, status: "not-run", problems: [`${tokenEnvName(persona)} not set`], warnings: [] }); continue; }
  const payload = decodePayload(token);
  const shape = payload ? claimShape(payload) : undefined;
  try {
    const id = await verifyBearer(token, cfg);
    const a = assess(persona, id, shape ?? claimShape({}));
    const row: Row = { persona, status: a.ok ? "pass" : "fail", problems: a.problems, warnings: a.warnings, ...(shape ? { shape } : {}), subject: subjectLabel(id.subject) };
    if (url) {
      const s = await session(token);
      row.server = { status: s.status, role: s.data?.role ?? null, workspaces: s.data?.workspaces ?? null, departments: s.data?.departments ?? null };
      const sameWs = JSON.stringify(s.data?.workspaces) === JSON.stringify(id.workspaces);
      if (s.status !== 200 || s.data?.role !== id.role || !sameWs) { row.status = "fail"; row.problems.push("the deployed server derived a different principal than local verification (different OIDC_ISSUER/OIDC_AUDIENCE/claims handling?)"); }
    }
    rows.push(row);
  } catch (e) {
    rows.push({ persona, status: "fail", problems: [`token rejected by verification: ${(e as Error).message} — check OIDC_ISSUER / OIDC_AUDIENCE against this token's iss / aud (reported below)`], warnings: [], ...(shape ? { shape } : {}) });
  }
}

if (url) {
  const first = PERSONAS.map(p => process.env[tokenEnvName(p)]?.trim()).find(Boolean);
  const anon = await session();
  extra.push({ name: "anonymous request has no identity", status: anon.data === null ? "pass" : "fail" });
  if (first) {
    const flipped = first.slice(0, -4) + (first.endsWith("AAAA") ? "BBBB" : "AAAA");
    const bad = await session(flipped);
    extra.push({ name: "tampered token is not accepted", status: bad.data === null ? "pass" : "fail" });
  }
}

const ran = rows.filter(r => r.status !== "not-run");
const failed = ran.some(r => r.status === "fail") || extra.some(x => x.status === "fail");
const verdict = ran.length === 0 ? "not-run" : failed ? "fail" : entra ? "real-entra" : "selftest-not-entra";
const report = {
  verdict, issuers, audience: ([] as string[]).concat(cfg.audience), idp: entra ? "microsoft-entra" : "NOT-MICROSOFT",
  target: url ?? "local verification only (no ENTRA_ACCEPTANCE_URL)", personas: rows, checks: extra, at: new Date().toISOString(),
  note: verdict === "real-entra" ? "Covers sign-in claims and authorization mapping for the personas that ran; browser redirect/CSP/logout steps are in docs/entra-acceptance.md." : undefined,
};
console.log(JSON.stringify(report, null, 2));
process.exit(ran.length === 0 ? 2 : failed ? 1 : !entra && !allowNonEntra ? 1 : 0);
