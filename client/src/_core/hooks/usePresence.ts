import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useAuth } from "./useAuth";

export interface PresenceUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  status: "online" | "away" | "offline";
  lastSeen: string;
}

export interface PresenceState {
  users: PresenceUser[];
  currentUser: PresenceUser | null;
  onlineCount: number;
  isLoading: boolean;
}

const PRESENCE_STORAGE_KEY = "bahn_presence";
const HEARTBEAT_INTERVAL = 30000;
const TIMEOUT = 120000;
const SYNC_INTERVAL = 5000;

function getStoredPresence(): Record<string, PresenceUser> {
  try {
    const stored = localStorage.getItem(PRESENCE_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function savePresence(presence: Record<string, PresenceUser>) {
  try {
    localStorage.setItem(PRESENCE_STORAGE_KEY, JSON.stringify(presence));
  } catch (err) {
    console.error("Failed to save presence:", err);
  }
}

export function usePresence(): PresenceState {
  const { user: authUser, isAuthenticated } = useAuth();
  const [presence, setPresence] = useState<Record<string, PresenceUser>>(() => getStoredPresence());
  const [isLoading, setIsLoading] = useState(false);
  
  const updateMyPresence = useCallback(() => {
    if (!isAuthenticated || !authUser) return;

    const current = getStoredPresence();
    const now = new Date().toISOString();
    
    current[authUser.email] = {
      id: authUser.email,
      name: authUser.name,
      email: authUser.email,
      role: authUser.role,
      status: "online",
      lastSeen: now,
    };

    savePresence(current);
    setPresence(current);
  }, [isAuthenticated, authUser]);

  const cleanupAndSync = useCallback(() => {
    const current = getStoredPresence();
    const now = Date.now();
    let changed = false;

    Object.keys(current).forEach(id => {
      const lastSeen = new Date(current[id].lastSeen).getTime();
      if (now - lastSeen > TIMEOUT) {
        delete current[id];
        changed = true;
      }
    });

    if (changed) {
      savePresence(current);
    }
    
    setPresence(prev => {
      if (JSON.stringify(prev) === JSON.stringify(current)) return prev;
      return current;
    });
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    
    updateMyPresence();
    const heartbeat = setInterval(updateMyPresence, HEARTBEAT_INTERVAL);
    const sync = setInterval(cleanupAndSync, SYNC_INTERVAL);

    const handleStorage = (e: StorageEvent) => {
      if (e.key === PRESENCE_STORAGE_KEY && e.newValue) {
        const updated = JSON.parse(e.newValue);
        setPresence(prev => {
          if (JSON.stringify(prev) === JSON.stringify(updated)) return prev;
          return updated;
        });
      }
    };

    window.addEventListener("storage", handleStorage);

    return () => {
      clearInterval(heartbeat);
      clearInterval(sync);
      window.removeEventListener("storage", handleStorage);
    };
  }, [isAuthenticated, updateMyPresence, cleanupAndSync]);

  const users = useMemo(() => Object.values(presence), [presence]);
  const currentUser = useMemo(() => authUser ? presence[authUser.email] || null : null, [authUser, presence]);
  const onlineCount = useMemo(() => users.filter(u => u.status === "online").length, [users]);

  return {
    users,
    currentUser,
    onlineCount,
    isLoading,
  };
}

export function useColleaguesOnline(): number {
  const { currentUser, users } = usePresence();
  if (!currentUser) return 0;
  return users.filter(u => u.status === "online" && u.id !== currentUser.id).length;
}

export function useOnlineColleagues(): PresenceUser[] {
  const { currentUser, users } = usePresence();
  if (!currentUser) return [];
  return users.filter(u => u.status === "online" && u.id !== currentUser.id);
}
