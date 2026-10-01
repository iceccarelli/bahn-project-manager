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
import { UserProvisioner, type ProvisionedUser } from "../infra/userProvisioner";
import type { Pool } from "mysql2/promise";
import { roleFromLegacy, type Principal } from "../domain/permissions";
import { oidcConfigFromEnv, verifyBearer, type OidcConfig } from "./oidc";
import { sdk } from "./sdk";

/** `user` is the legacy users row (cookie sessions only). OIDC identities have none: authorization uses `principal`. */
export interface Identity { user: User | null; principal: Principal }

/**
 * Mirror a batch of verified identities into `users` and, in the SAME transaction, append an audit row for every
 * authorization grant (role/workspaces/departments from the token) that is new or changed. Exported for tests.
 */
export async function provisionBatch(pool: Pool, users: ProvisionedUser[]): Promise<void> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [prev] = (await conn.query("SELECT openId, grantSnapshot FROM users WHERE openId IN (?)", [users.map(u => u.openId)])) as unknown as [Array<{ openId: string; grantSnapshot: string | null }>];
      const before = new Map(prev.map(r => [r.openId, r.grantSnapshot]));
      await conn.query(
        `INSERT INTO users (openId, name, email, loginMethod, role, grantSnapshot, lastSignedIn) VALUES ${users.map(() => "(?, ?, ?, 'oidc', ?, ?, NOW())").join(",")}
         ON DUPLICATE KEY UPDATE name = VALUES(name), email = VALUES(email), role = VALUES(role), grantSnapshot = VALUES(grantSnapshot), lastSignedIn = NOW()`,
        users.flatMap(u => [u.openId, u.name, u.email, u.role, u.grant]),
      );
      const changed = users.filter(u => (before.get(u.openId) ?? null) !== u.grant);
      if (changed.length) {
        const [ids] = (await conn.query("SELECT id, openId FROM users WHERE openId IN (?)", [changed.map(u => u.openId)])) as unknown as [Array<{ id: number; openId: string }>];
        const idOf = new Map(ids.map(r => [r.openId, r.id]));
        const rows = changed.map(u => [null, "system (OIDC)", "user", idOf.get(u.openId) ?? 0, before.has(u.openId) && before.get(u.openId) !== null ? "update" : "create", "grant", before.get(u.openId) ?? null, u.grant, null, null, "provisioner", null, (u.email || u.name || u.openId).slice(0, 255)]);
        await conn.query("INSERT INTO audit_log (userId, userName, entityType, entityId, action, field, oldValue, newValue, eventId, aggregateVersion, traceId, workspace, entityLabel) VALUES ?", [rows]);
      }
      await conn.commit();
    } catch (e) { await conn.rollback().catch(() => {}); throw e; }
    finally { conn.release(); }
}

let _provisioner: UserProvisioner | null = null;
function provisioner(): UserProvisioner {
  return (_provisioner ??= new UserProvisioner(async users => {
    const pool = getPool();
    if (!pool) return;
    await provisionBatch(pool, users);
  }));
}
/** for tests / shutdown */
export const flushProvisioner = () => _provisioner?.flush() ?? Promise.resolve();

const IS_PRODUCTION = process.env.NODE_ENV === "production";
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
      (user.role === "admin" || (!IS_PRODUCTION && (user.loginMethod === "demo" || process.env.LEGACY_USER_WORKSPACES === "ALL")) ? "ALL" : []),
    departments: extra?.departments ?? [],
  };
}

/** Canonical JSON of what the verified token grants (order-independent), the unit of authorization-change auditing. */
export function grantJson(p: Pick<Principal, "role" | "workspaces" | "departments">): string {
  const ws = p.workspaces === "ALL" ? "ALL" : [...p.workspaces].sort();
  return JSON.stringify({ role: p.role, workspaces: ws, departments: [...p.departments].sort() });
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
        provisioner().enqueue({ openId: openId.slice(0, 64), name: id.name, email: id.email, role: id.role === "admin" ? "admin" : "user", grant: grantJson(principal) });
        const value = { user: null, principal };
        remember(ck, value);
        return value;
      } catch {
        return null;
      }
    });
  }

  // Cookie sessions exist only for the development demo login. Production authenticates bearer tokens only.
  if (IS_PRODUCTION) return null;
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
