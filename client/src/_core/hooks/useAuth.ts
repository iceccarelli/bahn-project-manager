import { useCallback, useEffect, useState, useMemo } from "react";

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

export function useAuth() {
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
