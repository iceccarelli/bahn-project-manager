/**
 * Typed client for the server-authoritative data plane.
 * Active only in server mode (VITE_SERVER_MODE=1); the static Vercel
 * deployment keeps using the local data path until the API is deployed.
 */
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { scope as scopeKey } from "@shared/domain-events";
import superjson from "superjson";
import type { AppRouter } from "../../../server/routers";
import type { ConflictInfo } from "@shared/project-contract";
import { TOKEN_KEY, browserDeps, currentToken, settingsFromEnv } from "./oidcClient";

export const SERVER_MODE = import.meta.env.VITE_SERVER_MODE === "1";

/**
 * Token source. With VITE_OIDC_AUTHORITY/CLIENT_ID set (real sign-in) the token comes from the OIDC
 * client (memory + sessionStorage, expiry-checked, never localStorage). Without OIDC configuration
 * (local dev / tests with an injected token) a raw sessionStorage token is honoured. Either way the
 * server re-validates signature, issuer, audience and expiry on every request.
 */
export const TOKEN_STORAGE_KEY = TOKEN_KEY;
export const OIDC = settingsFromEnv(import.meta.env as Record<string, string | undefined>, typeof location === "undefined" ? "" : location.origin);
const storageProvider = async (): Promise<string | null> => {
  try { return OIDC ? currentToken(browserDeps()) : sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
};
let tokenProvider: (() => Promise<string | null>) | null = storageProvider;
/** Another OIDC library may register how to obtain the current access token. */
export const setAccessTokenProvider = (p: (() => Promise<string | null>) | null) => { tokenProvider = p ?? storageProvider; };

export const authHeaders = async (): Promise<Record<string, string>> => {
  const t = await tokenProvider?.();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

const newTraceId = () => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
};

export const serverApi = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      maxURLLength: 4000,
      headers: async () => ({ ...(await authHeaders()), "x-trace-id": newTraceId() }),
      fetch: (url, init) => fetch(url, { ...init, credentials: "include" }),
    }),
  ],
});

/** First explicitly granted workspace of the signed-in principal (null for "ALL"/none), for workspace presence. */
export function useHomeWorkspace(): string | null {
  const q = useQuery({ queryKey: ["server", "session"], queryFn: () => serverApi.auth.session.query(), staleTime: 60_000, enabled: SERVER_MODE });
  const ws = q.data?.workspaces;
  return Array.isArray(ws) && ws.length ? (ws[0] as string) : null;
}

/**
 * The membership channels (`collection:*`) a list view needs. NOT every workspace channel: those carry every
 * field edit of every project. A collection channel carries only create/delete/move events; edits to rows the
 * client holds arrive on their own `project:<id>` channel.
 *   unrestricted principal, no region filter → collection:all
 *   region filter                              → collection:<region>
 *   restricted principal                       → collection:<each authorized workspace> (or the filtered one)
 */
export function collectionScopesFor(workspaces: unknown, region?: string | null): string[] {
  if (region) return [scopeKey.collection(region)];
  if (workspaces === "ALL") return [scopeKey.collection("all")];
  return Array.isArray(workspaces) ? (workspaces as string[]).map(w => scopeKey.collection(w)) : [];
}
export function useCollectionScopes(region?: string | null): string[] {
  const q = useQuery({ queryKey: ["server", "session"], queryFn: () => serverApi.auth.session.query(), staleTime: 60_000, enabled: SERVER_MODE });
  return useMemo(() => collectionScopesFor(q.data?.workspaces, region), [q.data?.workspaces, region]);
}

export function extractConflict(err: unknown): ConflictInfo | null {
  if (err instanceof TRPCClientError) {
    const c = (err.data as { conflict?: ConflictInfo } | undefined)?.conflict;
    if (c?.code === "VERSION_CONFLICT") return c;
  }
  return null;
}

/** transport-level failures are retryable with the SAME idempotency key; 4xx are not */
export function isRetryable(err: unknown): boolean {
  if (err instanceof TRPCClientError) {
    const status = (err.data as { httpStatus?: number } | undefined)?.httpStatus;
    return status === undefined || status >= 500 || status === 429;
  }
  return true;
}
