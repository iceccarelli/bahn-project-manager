import { useCallback, useEffect, useState, useMemo } from "react";
import { SERVER_MODE, serverApi } from "@/realtime/serverApi";
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
function useServerAuth() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["server", "session"],
    queryFn: () => serverApi.auth.session.query(),
    staleTime: 60_000,
    retry: false,
  });
  // memoised: consumers use `user` as an effect dependency, a fresh object per render would loop them
  const user = useMemo<DemoUser | null>(
    () =>
      q.data
        ? {
            id: Number(q.data.id), name: q.data.name ?? q.data.email ?? "Benutzer", email: q.data.email ?? "",
            role: q.data.role === "admin" ? "admin" : "user", openId: q.data.id, loginMethod: "server",
            createdAt: "", updatedAt: "", lastSignedIn: "",
          }
        : null,
    [q.data],
  );
  const logout = useCallback(() => {
    try { sessionStorage.removeItem("bahn.access_token"); } catch { /* ignore */ }
    void serverApi.auth.logout.mutate().finally(() => { qc.clear(); window.location.assign("/login"); });
  }, [qc]);
  return { user, loading: q.isLoading, isAuthenticated: !!user, logout, session: q.data ?? null };
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
