import { useCallback, useEffect, useState } from "react";

export type DemoUser = {
  id: number;
  name: string;
  email: string;
  role: "admin" | "user";
  openId: string;
  loginMethod: string;
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date;
};

const STORAGE_KEY = "bahn-demo-user";

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
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
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
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
    },
  ];

  const match = demoUsers.find(u => u.email === email && u.password === password);
  if (match) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(match.user));
    // Dispatch storage event so other hooks pick it up
    window.dispatchEvent(new Event("auth-change"));
    return true;
  }
  return false;
}

export function logoutDemo() {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event("auth-change"));
}

export function useAuth(_options?: { redirectOnUnauthenticated?: boolean; redirectPath?: string }) {
  const [user, setUser] = useState<DemoUser | null>(() => getStoredUser());

  useEffect(() => {
    const handler = () => {
      setUser(getStoredUser());
    };
    window.addEventListener("auth-change", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("auth-change", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const logout = useCallback(() => {
    logoutDemo();
  }, []);

  return {
    user,
    loading: false,
    error: null,
    isAuthenticated: Boolean(user),
    refresh: () => setUser(getStoredUser()),
    logout,
  };
}
