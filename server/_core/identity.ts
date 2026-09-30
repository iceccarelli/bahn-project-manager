/**
 * The one place a request becomes a Principal.
 *
 *   Authorization: Bearer <OIDC access token>  → verified server-side (jose)
 *   session cookie                             → existing signed session (sdk)
 *
 * Results are cached briefly per credential so 10k concurrent users do not each
 * cost a token verification + a `lastSignedIn` UPDATE on every request.
 */
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { COOKIE_NAME } from "@shared/const";
import { parse as parseCookie } from "cookie";
import type { User } from "../../drizzle/schema";
import { getPool } from "../db";
import { m } from "../observability/metrics";
import { UserProvisioner } from "../infra/userProvisioner";
import { roleFromLegacy, type Principal } from "../domain/permissions";
import { oidcConfigFromEnv, verifyBearer, type OidcConfig } from "./oidc";
import { sdk } from "./sdk";

/** `user` is the legacy users row (cookie sessions only). OIDC identities have none: authorization uses `principal`. */
export interface Identity { user: User | null; principal: Principal }

let _provisioner: UserProvisioner | null = null;
function provisioner(): UserProvisioner {
  return (_provisioner ??= new UserProvisioner(async users => {
    const pool = getPool();
    if (!pool) return;
    await pool.query(
      `INSERT INTO users (openId, name, email, loginMethod, role, lastSignedIn) VALUES ${users.map(() => "(?, ?, ?, 'oidc', ?, NOW())").join(",")}
       ON DUPLICATE KEY UPDATE name = VALUES(name), email = VALUES(email), role = VALUES(role), lastSignedIn = NOW()`,
      users.flatMap(u => [u.openId, u.name, u.email, u.role]),
    );
  }));
}
/** for tests / shutdown */
export const flushProvisioner = () => _provisioner?.flush() ?? Promise.resolve();

const TTL_MS = 30_000;
const MAX_ENTRIES = 20_000;
const cache = new Map<string, { at: number; value: Identity }>();
let oidc: OidcConfig | null | undefined;

export function setOidcConfigForTests(cfg: OidcConfig | null) { oidc = cfg; cache.clear(); }
const getOidc = () => (oidc === undefined ? (oidc = oidcConfigFromEnv()) : oidc);

function remember(k: string, value: Identity) {
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(k, { at: Date.now(), value });
}

export function principalFromUser(user: User, extra?: Partial<Pick<Principal, "workspaces" | "departments" | "role">>): Principal {
  return {
    id: String(user.id),
    name: user.name ?? null,
    email: user.email ?? null,
    role: extra?.role ?? roleFromLegacy(user.role),
    // Default-deny: a user with no explicit workspace grant sees no workspace.
    // Admins are unrestricted by role. Demo logins (development convenience) and
    // deployments that explicitly set LEGACY_USER_WORKSPACES=ALL keep the old open behaviour.
    workspaces:
      extra?.workspaces ??
      (user.role === "admin" || user.loginMethod === "demo" || process.env.LEGACY_USER_WORKSPACES === "ALL" ? "ALL" : []),
    departments: extra?.departments ?? [],
  };
}

const inflight = new Map<string, Promise<Identity | null>>();

/** Concurrent cache misses for one credential share a single verification + DB round trip. */
function singleFlight(key: string, load: () => Promise<Identity | null>): Promise<Identity | null> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = load().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export async function resolveIdentity(req: Pick<IncomingMessage, "headers">): Promise<Identity | null> {
  const t0 = performance.now();
  try { return await resolveIdentityInner(req); } finally { m.identityMs.observe(performance.now() - t0); }
}

async function resolveIdentityInner(req: Pick<IncomingMessage, "headers">): Promise<Identity | null> {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const cfg = getOidc();
    if (!cfg) return null; // bearer auth is not enabled on this deployment
    const token = auth.slice(7).trim();
    const ck = "b:" + createHash("sha256").update(token).digest("hex");
    const hit = cache.get(ck);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    return singleFlight(ck, async () => {
      try {
        // Pure CPU + cached JWKS: no database on the authentication path.
        const t0 = performance.now();
        const id = await verifyBearer(token, cfg);
        m.authVerifyMs.observe(performance.now() - t0);
        const openId = `oidc:${id.subject}`;
        const principal: Principal = {
          // stable, fits the 64-char actor columns, never a raw tenant/object id
          id: `o${createHash("sha256").update(openId).digest("hex").slice(0, 31)}`,
          name: id.name, email: id.email, role: id.role, workspaces: id.workspaces, departments: id.departments,
        };
        provisioner().enqueue({ openId: openId.slice(0, 64), name: id.name, email: id.email, role: id.role === "admin" ? "admin" : "user" });
        const value = { user: null, principal };
        remember(ck, value);
        return value;
      } catch {
        return null;
      }
    });
  }

  const cookie = req.headers.cookie ? parseCookie(req.headers.cookie)[COOKIE_NAME] : undefined;
  if (!cookie) return null;
  const ck = "c:" + createHash("sha256").update(cookie).digest("hex");
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  return singleFlight(ck, async () => {
    try {
      const user = await sdk.authenticateRequest(req as never);
      const value = { user, principal: principalFromUser(user) };
      remember(ck, value);
      return value;
    } catch {
      return null;
    }
  });
}
