/**
 * Notifications System Hook
 * 
 * Manages in-app notifications for data changes, user actions, and system events
 * Uses toast notifications via Sonner
 */

import { useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./useAuth";

// ============================================================================
// TYPES
// ============================================================================

export interface Notification {
  id: string;
  type: "success" | "error" | "info" | "warning";
  title: string;
  message: string;
  timestamp: string;
  userId?: string;
  projectId?: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const NOTIFICATIONS_STORAGE_KEY = "bahn_notifications";
const CHANGES_STORAGE_KEY = "bahn_changes";

// ============================================================================
// NOTIFICATION MANAGEMENT
// ============================================================================

function getStoredNotifications(): Notification[] {
  try {
    const stored = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveNotification(notification: Notification) {
  try {
    const notifications = getStoredNotifications();
    notifications.push(notification);
    // Keep only last 100 notifications
    const recent = notifications.slice(-100);
    localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(recent));
  } catch (err) {
    console.error("Failed to save notification:", err);
  }
}

function broadcastNotification(notification: Notification) {
  saveNotification(notification);

  // Broadcast to other tabs
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: NOTIFICATIONS_STORAGE_KEY,
      newValue: JSON.stringify([notification]),
    })
  );
}

// ============================================================================
// CHANGE TRACKING
// ============================================================================

interface ChangeEvent {
  id: string;
  type: "CREATE" | "UPDATE" | "DELETE";
  entity: "project" | "review" | "audit";
  entityId: number;
  userId: string;
  timestamp: string;
  changes?: Record<string, { old: any; new: any }>;
}

function getStoredChanges(): ChangeEvent[] {
  try {
    const stored = localStorage.getItem(CHANGES_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function recordChange(change: ChangeEvent) {
  try {
    const changes = getStoredChanges();
    changes.push(change);
    // Keep only last 500 changes
    const recent = changes.slice(-500);
    localStorage.setItem(CHANGES_STORAGE_KEY, JSON.stringify(recent));
  } catch (err) {
    console.error("Failed to record change:", err);
  }
}

// ============================================================================
// MAIN HOOK
// ============================================================================

export function useNotifications() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const lastProcessedChangeRef = useRef<string>("");

  // ========== LISTEN FOR STORAGE CHANGES ==========
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === NOTIFICATIONS_STORAGE_KEY && event.newValue) {
        try {
          const notifications = JSON.parse(event.newValue);
          if (Array.isArray(notifications)) {
            notifications.forEach((notification: Notification) => {
              // Skip if from current user
              if (notification.userId && notification.userId === user?.email) {
                return;
              }

              // Show toast notification
              const toastFn = {
                success: toast.success,
                error: toast.error,
                info: toast.info,
                warning: toast.warning,
              }[notification.type];

              if (toastFn) {
                toastFn(notification.title, {
                  description: notification.message,
                  duration: 5000,
                });
              }

              // Invalidate relevant queries
              if (notification.projectId) {
                queryClient.invalidateQueries({
                  queryKey: ["projects"],
                });
                queryClient.invalidateQueries({
                  queryKey: ["stats"],
                });
              }
            });
          }
        } catch (err) {
          console.error("Failed to process notification:", err);
        }
      }

      // ========== LISTEN FOR CHANGES ==========
      if (event.key === CHANGES_STORAGE_KEY && event.newValue) {
        try {
          const changes = JSON.parse(event.newValue);
          if (Array.isArray(changes)) {
            changes.forEach((change: ChangeEvent) => {
              // Skip if from current user
              if (change.userId === user?.email) {
                return;
              }

              // Skip if already processed
              if (change.id === lastProcessedChangeRef.current) {
                return;
              }

              lastProcessedChangeRef.current = change.id;

              // Invalidate queries
              queryClient.invalidateQueries({
                queryKey: ["projects"],
              });
              queryClient.invalidateQueries({
                queryKey: ["stats"],
              });
              queryClient.invalidateQueries({
                queryKey: ["audit"],
              });
            });
          }
        } catch (err) {
          console.error("Failed to process changes:", err);
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [user, queryClient]);

  // ========== NOTIFICATION CREATORS ==========

  const notifyProjectCreated = useCallback(
    (projectId: number, projectName: string, creator: string) => {
      const notification: Notification = {
        id: `create_${projectId}_${Date.now()}`,
        type: "success",
        title: "Neues Projekt erstellt",
        message: `${creator} hat "${projectName}" erstellt`,
        timestamp: new Date().toISOString(),
        userId: creator,
        projectId,
      };

      broadcastNotification(notification);

      const change: ChangeEvent = {
        id: notification.id,
        type: "CREATE",
        entity: "project",
        entityId: projectId,
        userId: creator,
        timestamp: new Date().toISOString(),
      };

      recordChange(change);
    },
    []
  );

  const notifyProjectUpdated = useCallback(
    (
      projectId: number,
      projectName: string,
      updater: string,
      changes: Record<string, { old: any; new: any }>
    ) => {
      const changedFields = Object.keys(changes).join(", ");

      const notification: Notification = {
        id: `update_${projectId}_${Date.now()}`,
        type: "info",
        title: "Projekt aktualisiert",
        message: `${updater} hat "${projectName}" aktualisiert (${changedFields})`,
        timestamp: new Date().toISOString(),
        userId: updater,
        projectId,
      };

      broadcastNotification(notification);

      const change: ChangeEvent = {
        id: notification.id,
        type: "UPDATE",
        entity: "project",
        entityId: projectId,
        userId: updater,
        timestamp: new Date().toISOString(),
        changes,
      };

      recordChange(change);
    },
    []
  );

  const notifyReviewUpdated = useCallback(
    (
      projectId: number,
      projectName: string,
      department: string,
      updater: string
    ) => {
      const notification: Notification = {
        id: `review_${projectId}_${department}_${Date.now()}`,
        type: "info",
        title: "Prüfung aktualisiert",
        message: `${updater} hat die ${department}-Prüfung von "${projectName}" aktualisiert`,
        timestamp: new Date().toISOString(),
        userId: updater,
        projectId,
      };

      broadcastNotification(notification);

      const change: ChangeEvent = {
        id: notification.id,
        type: "UPDATE",
        entity: "review",
        entityId: projectId,
        userId: updater,
        timestamp: new Date().toISOString(),
      };

      recordChange(change);
    },
    []
  );

  const notifyProjectDeleted = useCallback(
    (projectId: number, projectName: string, deleter: string) => {
      const notification: Notification = {
        id: `delete_${projectId}_${Date.now()}`,
        type: "warning",
        title: "Projekt gelöscht",
        message: `${deleter} hat "${projectName}" gelöscht`,
        timestamp: new Date().toISOString(),
        userId: deleter,
        projectId,
      };

      broadcastNotification(notification);

      const change: ChangeEvent = {
        id: notification.id,
        type: "DELETE",
        entity: "project",
        entityId: projectId,
        userId: deleter,
        timestamp: new Date().toISOString(),
      };

      recordChange(change);
    },
    []
  );

  const notifyError = useCallback((title: string, message: string) => {
    const notification: Notification = {
      id: `error_${Date.now()}`,
      type: "error",
      title,
      message,
      timestamp: new Date().toISOString(),
    };

    toast.error(title, {
      description: message,
      duration: 5000,
    });

    saveNotification(notification);
  }, []);

  const notifySuccess = useCallback((title: string, message: string) => {
    const notification: Notification = {
      id: `success_${Date.now()}`,
      type: "success",
      title,
      message,
      timestamp: new Date().toISOString(),
    };

    toast.success(title, {
      description: message,
      duration: 3000,
    });

    saveNotification(notification);
  }, []);

  return {
    notifyProjectCreated,
    notifyProjectUpdated,
    notifyReviewUpdated,
    notifyProjectDeleted,
    notifyError,
    notifySuccess,
  };
}

// ============================================================================
// HELPER HOOKS
// ============================================================================

/**
 * Get recent notifications
 */
export function useRecentNotifications(limit: number = 10): Notification[] {
  const notifications = getStoredNotifications();
  return notifications.slice(-limit).reverse();
}

/**
 * Get recent changes
 */
export function useRecentChanges(limit: number = 20): ChangeEvent[] {
  const changes = getStoredChanges();
  return changes.slice(-limit).reverse();
}
