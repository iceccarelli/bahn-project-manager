import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { beginSignIn, clearAuth, completeSignIn, currentToken, settingsFromEnv, SignInError, TOKEN_KEY, type Deps } from "./oidcClient";

const S = settingsFromEnv({ VITE_OIDC_AUTHORITY: "https://idp.test/tenant/v2.0/", VITE_OIDC_CLIENT_ID: "cid", VITE_OIDC_SCOPE: "openid api://x/access" }, "https://app.test")!;
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };
let n = 0;
function deps(over: Partial<Deps> = {}, calls: { url: string; body?: string }[] = []): Deps & { store: ReturnType<typeof mem>; t: { now: number } } {
  const t = { now: 1_000_000 };
  const store = mem();
  return {
    store, t,
    now: () => t.now,
    random: len => Uint8Array.from({ length: len }, () => ++n % 256),
    sha256: async s => createHash("sha256").update(s).digest().buffer as ArrayBuffer,
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string });
      if (url.endsWith("openid-configuration")) return new Response(JSON.stringify({ authorization_endpoint: "https://idp.test/authorize", token_endpoint: "https://idp.test/token", end_session_endpoint: "https://idp.test/logout" }));
      return new Response(JSON.stringify({ access_token: "AT", token_type: "Bearer", expires_in: 600 }));
    }) as typeof fetch,
    ...over,
  };
}

describe("OIDC code + PKCE", () => {
  it("is unconfigured without authority and client id", () => {
    expect(settingsFromEnv({}, "https://a")).toBeNull();
    expect(S.redirectUri).toBe("https://app.test/auth/callback");
  });

  it("builds an S256 authorization request and keeps the verifier out of the URL", async () => {
    const d = deps();
    const u = new URL(await beginSignIn(S, d, "/projects"));
    const flow = JSON.parse(d.store.getItem("bahn.oidc_flow")!);
    expect(u.origin + u.pathname).toBe("https://idp.test/authorize");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toBe(createHash("sha256").update(flow.verifier).digest("base64url"));
    expect(u.toString()).not.toContain(flow.verifier);
    expect(u.searchParams.get("state")).toBe(flow.state);
  });

  it("exchanges the code with the verifier and stores the token in the session store only", async () => {
    const calls: { url: string; body?: string }[] = [];
    const d = deps({}, calls);
    const u = new URL(await beginSignIn(S, d, "/projects"));
    const to = await completeSignIn(S, d, `?code=abc&state=${u.searchParams.get("state")}`);
    expect(to).toBe("/projects");
    const post = new URLSearchParams(calls.find(c => c.url === "https://idp.test/token")!.body);
    expect(post.get("code_verifier")).toBeTruthy();
    expect(post.get("client_secret")).toBeNull();
    expect(currentToken(d)).toBe("AT");
    expect(d.store.getItem("bahn.oidc_flow")).toBeNull();
  });

  it("rejects a state mismatch, a replayed callback, and an IdP error — and stores nothing", async () => {
    const d = deps();
    await beginSignIn(S, d);
    await expect(completeSignIn(S, d, "?code=abc&state=forged")).rejects.toBeInstanceOf(SignInError);
    await expect(completeSignIn(S, d, "?code=abc&state=forged")).rejects.toThrow("no sign-in in progress");
    await beginSignIn(S, d);
    await expect(completeSignIn(S, d, "?error=access_denied&error_description=nope")).rejects.toThrow("access_denied");
    expect(currentToken(d)).toBeNull();
  });

  it("never follows an open redirect out of the app", async () => {
    const d = deps();
    const u = new URL(await beginSignIn(S, d, "//evil.test/x"));
    expect(await completeSignIn(S, d, `?code=c&state=${u.searchParams.get("state")}`)).toBe("/");
  });

  it("does not hand out an expired (or nearly expired) token, and logout clears everything", async () => {
    const d = deps();
    const u = new URL(await beginSignIn(S, d));
    await completeSignIn(S, d, `?code=c&state=${u.searchParams.get("state")}`);
    expect(currentToken(d)).toBe("AT");
    d.t.now += 600_000 - 29_000; // inside the 30 s skew
    expect(currentToken(d)).toBeNull();
    d.t.now = 1_000_000;
    clearAuth(d);
    expect(currentToken(d)).toBeNull();
    expect(d.store.m.size).toBe(0);
    expect(d.store.getItem(TOKEN_KEY)).toBeNull();
  });

  it("refuses a token response that is not a bearer access token", async () => {
    const d = deps({ fetch: (async (url: string) => url.endsWith("configuration")
      ? new Response(JSON.stringify({ authorization_endpoint: "https://idp.test/authorize", token_endpoint: "https://idp.test/token" }))
      : new Response(JSON.stringify({ id_token: "only" }))) as typeof fetch });
    const u = new URL(await beginSignIn({ ...S, authority: "https://other.test" }, d));
    await expect(completeSignIn({ ...S, authority: "https://other.test" }, d, `?code=c&state=${u.searchParams.get("state")}`)).rejects.toThrow("no bearer");
  });
});
