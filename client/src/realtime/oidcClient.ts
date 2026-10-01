/**
 * Browser sign-in: OIDC Authorization Code + PKCE (S256) against any OIDC authority — including
 * Microsoft Entra ID (v2.0 endpoint, SPA app registration). No client secret, no implicit flow.
 *
 * Where tokens live (deliberately narrow):
 *   - the ACCESS token is held in memory and mirrored to sessionStorage (per tab, gone when the tab
 *     closes) so a reload does not bounce the user through the IdP. Never localStorage.
 *   - NO refresh token and NO id token is stored. When the access token expires the user is sent
 *     through the authorization endpoint again (the IdP session makes that a silent redirect).
 *   - the transient PKCE verifier/state live in sessionStorage only between redirect and callback.
 * The token is sent as `Authorization: Bearer` on tRPC, SSE and presence requests (serverApi.authHeaders).
 * The SERVER is the authority on identity and workspace scope — nothing here grants anything.
 */

export interface OidcSettings {
  authority: string;        // e.g. https://login.microsoftonline.com/<tenant>/v2.0
  clientId: string;
  scope: string;            // e.g. "openid profile api://<api-app-id>/access_as_user"
  redirectUri: string;      // must be registered as an SPA redirect URI
}

export interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export interface Deps { fetch: typeof fetch; store: Store; now: () => number; random: (n: number) => Uint8Array; sha256: (s: string) => Promise<ArrayBuffer> }

export const TOKEN_KEY = "bahn.access_token";
const EXP_KEY = "bahn.access_token_exp";
const FLOW_KEY = "bahn.oidc_flow";
/** refresh this long before expiry so a request never carries a token that dies in flight */
const SKEW_MS = 30_000;

const b64url = (b: ArrayBuffer | Uint8Array) => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = ""; for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const browserDeps = (): Deps => ({
  fetch: (...a) => fetch(...a),
  store: sessionStorage,
  now: () => Date.now(),
  random: n => crypto.getRandomValues(new Uint8Array(n)),
  sha256: s => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
});

export function settingsFromEnv(env: Record<string, string | undefined>, origin: string): OidcSettings | null {
  const authority = env.VITE_OIDC_AUTHORITY, clientId = env.VITE_OIDC_CLIENT_ID;
  if (!authority || !clientId) return null;
  return { authority: authority.replace(/\/$/, ""), clientId, scope: env.VITE_OIDC_SCOPE || "openid profile", redirectUri: env.VITE_OIDC_REDIRECT_URI || `${origin}/auth/callback` };
}

interface Discovery { authorization_endpoint: string; token_endpoint: string; end_session_endpoint?: string }
const discoveryCache = new Map<string, Promise<Discovery>>();
async function discover(s: OidcSettings, d: Deps): Promise<Discovery> {
  let p = discoveryCache.get(s.authority);
  if (!p) {
    p = d.fetch(`${s.authority}/.well-known/openid-configuration`).then(async r => {
      if (!r.ok) throw new Error(`OIDC discovery failed (${r.status})`);
      const j = await r.json() as Discovery;
      if (!j.authorization_endpoint || !j.token_endpoint) throw new Error("OIDC discovery document incomplete");
      return j;
    });
    discoveryCache.set(s.authority, p);
    p.catch(() => discoveryCache.delete(s.authority));
  }
  return p;
}

/** Start sign-in: returns the URL to navigate to (caller does the redirect). */
export async function beginSignIn(s: OidcSettings, d: Deps, returnTo = "/"): Promise<string> {
  const disc = await discover(s, d);
  const verifier = b64url(d.random(32)), state = b64url(d.random(16)), nonce = b64url(d.random(16));
  d.store.setItem(FLOW_KEY, JSON.stringify({ verifier, state, returnTo }));
  const u = new URL(disc.authorization_endpoint);
  u.search = new URLSearchParams({
    client_id: s.clientId, response_type: "code", redirect_uri: s.redirectUri, scope: s.scope,
    state, nonce, code_challenge: b64url(await d.sha256(verifier)), code_challenge_method: "S256", response_mode: "query",
  }).toString();
  return u.toString();
}

export class SignInError extends Error {}

/** Complete sign-in on the redirect URI. Returns where to go next. Throws SignInError on any mismatch. */
export async function completeSignIn(s: OidcSettings, d: Deps, search: string): Promise<string> {
  const q = new URLSearchParams(search);
  const raw = d.store.getItem(FLOW_KEY);
  d.store.removeItem(FLOW_KEY); // single use: a replayed callback finds nothing
  if (q.get("error")) throw new SignInError(`${q.get("error")}: ${q.get("error_description") ?? ""}`.trim());
  if (!raw) throw new SignInError("no sign-in in progress");
  const flow = JSON.parse(raw) as { verifier: string; state: string; returnTo: string };
  const code = q.get("code");
  if (!code || q.get("state") !== flow.state) throw new SignInError("state mismatch");
  const disc = await discover(s, d);
  const r = await d.fetch(disc.token_endpoint, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: s.clientId, code, redirect_uri: s.redirectUri, code_verifier: flow.verifier, scope: s.scope }).toString(),
  });
  if (!r.ok) throw new SignInError(`token endpoint refused the code (${r.status})`);
  const t = await r.json() as { access_token?: string; expires_in?: number; token_type?: string };
  if (!t.access_token || (t.token_type && t.token_type.toLowerCase() !== "bearer")) throw new SignInError("no bearer access token in response");
  d.store.setItem(TOKEN_KEY, t.access_token);
  d.store.setItem(EXP_KEY, String(d.now() + (t.expires_in ?? 3600) * 1000));
  return flow.returnTo.startsWith("/") && !flow.returnTo.startsWith("//") ? flow.returnTo : "/";
}

/** Current access token, or null when absent/expired (the caller then signs in again). */
export function currentToken(d: Deps): string | null {
  const t = d.store.getItem(TOKEN_KEY), exp = Number(d.store.getItem(EXP_KEY));
  if (!t || !Number.isFinite(exp) || d.now() >= exp - SKEW_MS) return null;
  return t;
}

export function clearAuth(d: Deps) { for (const k of [TOKEN_KEY, EXP_KEY, FLOW_KEY]) d.store.removeItem(k); }

/** Sign-out URL at the IdP (ends the IdP session too), or null when the authority has no end_session_endpoint. */
export async function signOutUrl(s: OidcSettings, d: Deps, postLogout: string): Promise<string | null> {
  try {
    const disc = await discover(s, d);
    if (!disc.end_session_endpoint) return null;
    const u = new URL(disc.end_session_endpoint);
    u.searchParams.set("post_logout_redirect_uri", postLogout);
    return u.toString();
  } catch { return null; }
}
