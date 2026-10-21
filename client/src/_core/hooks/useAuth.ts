import { useCallback, useEffect, useState, useMemo } from "react";
import { OIDC, SERVER_MODE, serverApi } from "@/realtime/serverApi";
import { TOKEN_KEY, browserDeps, clearAuth, currentToken, signOutUrl } from "@/realtime/oidcClient";
import { browserStores, reconcilePrincipal, signOutCleanup } from "@/realtime/accountState";
import { describeDemoUser, describeSession, type IdentityView } from "@/_core/identityView";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export type DemoUser = {
  id: number;
  name: string;
  email: string;
  role: "admin" | "user";
  openId: string;
  loginMethod: string;
  createdAt: string;
  updatedAt: string;
  lastSignedIn: string;
};

const STORAGE_KEY = "bahn-demo-user";
const AUTH_EVENT = "bahn-auth-change";

function getStoredUser(): DemoUser | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

export function loginDemo(email: string, password: string): boolean {
  const demoUsers: Array<{ email: string; password: string; user: DemoUser }> = [
    {
      email: "admin@bahn.de",
      password: "admin",
      user: {
        id: 1,
        name: "Admin",
        email: "admin@bahn.de",
        role: "admin",
        openId: "demo-admin",
        loginMethod: "demo",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastSignedIn: new Date().toISOString(),
      },
    },
    {
      email: "pruefer@bahn.de",
      password: "user",
      user: {
        id: 2,
        name: "Prüfer",
        email: "pruefer@bahn.de",
        role: "user",
        openId: "demo-user",
        loginMethod: "demo",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastSignedIn: new Date().toISOString(),
      },
    },
  ];

  const match = demoUsers.find(u => u.email === email && u.password === password);
  if (match) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(match.user));
    window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: match.user }));
    return true;
  }
  return false;
}

export function logoutDemo() {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: null }));
}

/**
 * Server mode: identity is what the SERVER says (`auth.session`, resolved from
 * the bearer token or session cookie). Nothing is read from localStorage, so
 * a browser cannot assert a role by editing its own storage.
 */
/** Is there a credential this tab could present? (expiry-checked in OIDC builds; the raw dev/test token otherwise) */
function hasCredential(): boolean {
  try { return OIDC ? currentToken(browserDeps()) !== null : sessionStorage.getItem(TOKEN_KEY) !== null; } catch { return false; }
}

function useServerAuth() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["server", "session"],
    queryFn: async () => {
      const s = await serverApi.auth.session.query();
      // Before anything personal is read or rendered: a different person than the last one in this browser inherits nothing.
      if (s) reconcilePrincipal(s.id, browserStores());
      return s;
    },
    staleTime: 60_000,
    retry: false,
    // A failed lookup is not "signed out". While it is failing, keep asking: the recovery screen disappears by itself.
    refetchInterval: query => (query.state.status === "error" ? 10_000 : false),
  });
  // memoised: consumers use `user` as an effect dependency, a fresh object per render would loop them
  const user = useMemo<DemoUser | null>(
    () =>
      q.data
        ? {
            // `id` is a demo-only numeric id; the server principal id is `openId` (an opaque string, never a number)
            id: 0, name: q.data.name ?? q.data.email ?? "Angemeldet", email: q.data.email ?? "",
            role: q.data.role === "admin" ? "admin" : "user", openId: q.data.id, loginMethod: "server",
            createdAt: "", updatedAt: "", lastSignedIn: "",
          }
        : null,
    [q.data],
  );
  const logout = useCallback(() => {
    const d = browserDeps();
    // Drop every client-side credential first, whatever the network does next.
    try { clearAuth(d); } catch { /* ignore */ }
    signOutCleanup(browserStores()); // recent searches, typed-in recipients, Abnahme records: the next person starts clean
    const leave = async () => {
      qc.clear();
      const idp = OIDC ? await signOutUrl(OIDC, d, `${window.location.origin}/login`) : null;
      window.location.assign(idp ?? "/login");
    };
    void serverApi.auth.logout.mutate().catch(() => undefined).finally(leave);
  }, [qc]);
  const sessionError = q.isError && !q.data && hasCredential();
  const retrySession = useCallback(() => { void q.refetch(); }, [q]);
  return { user, loading: q.isLoading, isAuthenticated: !!user, logout, session: q.data ?? null, sessionError, retrySession };
}

function useLocalAuth() {
  const [user, setUser] = useState<DemoUser | null>(() => getStoredUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedUser = getStoredUser();
    setUser(storedUser);
    setLoading(false);

    const handleAuthChange = (e: any) => {
      const newUser = e.detail;
      setUser(prev => {
        if (JSON.stringify(prev) === JSON.stringify(newUser)) return prev;
        return newUser;
      });
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        const newUser = e.newValue ? JSON.parse(e.newValue) : null;
        setUser(prev => {
          if (JSON.stringify(prev) === JSON.stringify(newUser)) return prev;
          return newUser;
        });
      }
    };

    window.addEventListener(AUTH_EVENT, handleAuthChange);
    window.addEventListener("storage", handleStorage);
    
    return () => {
      window.removeEventListener(AUTH_EVENT, handleAuthChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const logout = useCallback(() => {
    logoutDemo();
  }, []);

  const isAuthenticated = useMemo(() => !!user, [user]);

  return {
    user,
    loading,
    isAuthenticated,
    logout,
  };
}

export const useAuth: typeof useLocalAuth = SERVER_MODE ? (useServerAuth as unknown as typeof useLocalAuth) : useLocalAuth;

/**
 * Signed in, but the token grants nothing to look at: not an admin and no workspace (a missing `workspaces` claim is "no access",
 * docs/auth.md). Without this the first real Microsoft sign-in would land on empty lists and look broken.
 * Demo (browser-local) users always have access to the synthetic data.
 */
export function useAccessPending(): { pending: boolean; who: string | null } {
  const auth = useAuth() as unknown as { session?: { role: string; workspaces: unknown; name: string | null; email: string | null } | null };
  const s = auth.session;
  if (!SERVER_MODE || !s) return { pending: false, who: null };
  const none = s.role !== "admin" && Array.isArray(s.workspaces) && s.workspaces.length === 0;
  return { pending: none, who: s.name ?? s.email ?? null };
}

/**
 * The session lookup itself failed (server or network down) while this tab holds a credential. That is NOT "signed out":
 * the gate offers a retry and a sign-out instead of bouncing the person through the IdP again for no reason.
 */
export function useSessionRecovery(): { failed: boolean; retry: () => void; logout: () => void } {
  const auth = useAuth() as unknown as { sessionError?: boolean; retrySession?: () => void; logout: () => void };
  return { failed: !!auth.sessionError, retry: auth.retrySession ?? (() => undefined), logout: auth.logout };
}

/** Who is signed in, as shown in the UI: the validated server session, or the labelled demo account. */
export function useIdentity(): IdentityView | null {
  const auth = useAuth() as unknown as { user: DemoUser | null; session?: Parameters<typeof describeSession>[0] | null };
  return useMemo(() => {
    if (SERVER_MODE) return auth.session ? describeSession(auth.session) : null;
    return auth.user ? describeDemoUser(auth.user) : null;
  }, [auth.session, auth.user]);
}
