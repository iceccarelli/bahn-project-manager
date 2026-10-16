/** Notification wire contract (server and client). */
export const NOTIFICATION_KINDS = ["critical", "workflow", "assignment", "mention", "deadline", "system"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface NotificationDTO {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  /** the Gewerk a department notification concerns (EEA, ITK, …); null for watcher notifications */
  department?: string | null;
  createdAt: string;
  read: boolean;
}

/** One line of the subscription settings: a department the user may follow, and whether they currently do. */
export interface DepartmentSubscriptionDTO {
  department: string;
  /** may receive this department's notifications under the CURRENT grant (admin: always; editor: department in grant) */
  eligible: boolean;
  /** the effective state (explicit row, or the default policy) */
  subscribed: boolean;
  /** null = the default policy applies, no explicit decision stored */
  explicit: { enabled: boolean; source: "user" | "admin"; updatedAt: string } | null;
}

/** Severity order for the bell (highest first). */
export const KIND_RANK: Record<NotificationKind, number> = { critical: 6, deadline: 5, assignment: 4, mention: 3, workflow: 2, system: 1 };
export const KIND_LABEL: Record<NotificationKind, string> = {
  critical: "Kritisch", workflow: "Workflow", assignment: "Zuweisung", mention: "Erwähnung", deadline: "Termin", system: "System",
};
