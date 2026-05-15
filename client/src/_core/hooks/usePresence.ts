/**
 * Presence System Hook
 * 
 * Tracks online users, presence status, and broadcasts user activity
 * Uses localStorage for cross-tab sync and polling for real-time updates
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "./useAuth";

// ============================================================================
// TYPES
// ============================================================================

export interface PresenceUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  status: "online" | "away" | "offline";
  lastSeen: string;
  avatar?: string;
}

export interface PresenceState {
  users: PresenceUser[];
  currentUser: PresenceUser | null;
  onlineCount: number;
  isLoading: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const PRESENCE_STORAGE_KEY = "bahn_presence";
const PRESENCE_HEARTBEAT_INTERVAL = 30 * 1000; // 30 seconds
const PRESENCE_TIMEOUT = 2 * 60 * 1000; // 2 minutes
const POLLING_INTERVAL = 5 * 1000; // 5 seconds

// ============================================================================
// PRESENCE MANAGEMENT
// ============================================================================

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

function updateUserPresence(userId: string, user: PresenceUser) {
  const presence = getStoredPresence();
  presence[userId] = {
    ...user,
    lastSeen: new Date().toISOString(),
  };
  savePresence(presence);

  // Broadcast to other tabs
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: PRESENCE_STORAGE_KEY,
      newValue: JSON.stringify(presence),
    })
  );
}

function removeUserPresence(userId: string) {
  const presence = getStoredPresence();
  delete presence[userId];
  savePresence(presence);

  // Broadcast to other tabs
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: PRESENCE_STORAGE_KEY,
      newValue: JSON.stringify(presence),
    })
  );
}

function cleanupStalePresence() {
  const presence = getStoredPresence();
  const now = new Date().getTime();
  let hasChanges = false;

  Object.entries(presence).forEach(([userId, user]) => {
    const lastSeenTime = new Date(user.lastSeen).getTime();
    if (now - lastSeenTime > PRESENCE_TIMEOUT) {
      delete presence[userId];
      hasChanges = true;
    }
  });

  if (hasChanges) {
    savePresence(presence);
  }

  return presence;
}

// ============================================================================
// MAIN HOOK
// ============================================================================

export function usePresence(): PresenceState {
  const { user: authUser, isAuthenticated } = useAuth();
  const [presence, setPresence] = useState<Record<string, PresenceUser>>(() =>
    getStoredPresence()
  );
  const [isLoading, setIsLoading] = useState(false);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout>();
  const pollingIntervalRef = useRef<NodeJS.Timeout>();

  // ========== HEARTBEAT: Update current user presence ==========
  useEffect(() => {
    if (!isAuthenticated || !authUser) {
      return;
    }

    // Initial presence update
    const currentUser: PresenceUser = {
      id: authUser.email,
      name: authUser.name,
      email: authUser.email,
      role: authUser.role,
      status: "online",
      lastSeen: new Date().toISOString(),
    };

    updateUserPresence(authUser.email, currentUser);

    // Heartbeat: Update presence every 30 seconds
    heartbeatIntervalRef.current = setInterval(() => {
      updateUserPresence(authUser.email, currentUser);
    }, PRESENCE_HEARTBEAT_INTERVAL);

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
    };
  }, [isAuthenticated, authUser]);

  // ========== POLLING: Check for stale users and sync across tabs ==========
  useEffect(() => {
    pollingIntervalRef.current = setInterval(() => {
      const cleaned = cleanupStalePresence();
      setPresence(cleaned);
    }, POLLING_INTERVAL);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  // ========== STORAGE EVENT LISTENER: Sync across tabs ==========
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === PRESENCE_STORAGE_KEY && event.newValue) {
        try {
          const updated = JSON.parse(event.newValue);
          setPresence(updated);
        } catch (err) {
          console.error("Failed to parse presence update:", err);
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // ========== CLEANUP ON UNMOUNT ==========
  useEffect(() => {
    return () => {
      if (isAuthenticated && authUser) {
        removeUserPresence(authUser.email);
      }
    };
  }, [isAuthenticated, authUser]);

  // ========== COMPUTE DERIVED STATE ==========
  const currentUser = authUser
    ? presence[authUser.email] || {
        id: authUser.email,
        name: authUser.name,
        email: authUser.email,
        role: authUser.role,
        status: "online",
        lastSeen: new Date().toISOString(),
      }
    : null;

  const onlineUsers = Object.values(presence).filter((u) => u.status === "online");

  return {
    users: Object.values(presence),
    currentUser,
    onlineCount: onlineUsers.length,
    isLoading,
  };
}

// ============================================================================
// HELPER HOOKS
// ============================================================================

/**
 * Get count of online colleagues (excluding current user)
 */
export function useColleaguesOnline(): number {
  const { currentUser, users } = usePresence();
  if (!currentUser) return 0;
  return users.filter(
    (u) => u.status === "online" && u.id !== currentUser.id
  ).length;
}

/**
 * Get list of online colleagues (excluding current user)
 */
export function useOnlineColleagues(): PresenceUser[] {
  const { currentUser, users } = usePresence();
  if (!currentUser) return [];
  return users.filter(
    (u) => u.status === "online" && u.id !== currentUser.id
  );
}

/**
 * Get user presence by email
 */
export function useUserPresence(email: string): PresenceUser | null {
  const { users } = usePresence();
  return users.find((u) => u.email === email) || null;
}
