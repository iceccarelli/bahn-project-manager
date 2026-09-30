/**
 * Typed client for the server-authoritative data plane.
 * Active only in server mode (VITE_SERVER_MODE=1); the static Vercel
 * deployment keeps using the local data path until the API is deployed.
 */
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import { useQuery } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../../server/routers";
import type { ConflictInfo } from "@shared/project-contract";

export const SERVER_MODE = import.meta.env.VITE_SERVER_MODE === "1";

/**
 * Default token source until MSAL is integrated: a token placed in
 * sessionStorage (per-tab, cleared on close) by the sign-in flow. Registered
 * providers (setAccessTokenProvider) take precedence.
 */
export const TOKEN_STORAGE_KEY = "bahn.access_token";
const storageProvider = async (): Promise<string | null> => {
  try { return sessionStorage.getItem(TOKEN_STORAGE_KEY); } catch { return null; }
};
let tokenProvider: (() => Promise<string | null>) | null = storageProvider;
/** MSAL (or any OIDC library) registers how to obtain the current access token. */
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
