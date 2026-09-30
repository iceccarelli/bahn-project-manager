/** Notification wire contract (server and client). */
export const NOTIFICATION_KINDS = ["critical", "workflow", "assignment", "mention", "deadline", "system"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface NotificationDTO {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  read: boolean;
}

/** Severity order for the bell (highest first). */
export const KIND_RANK: Record<NotificationKind, number> = { critical: 6, deadline: 5, assignment: 4, mention: 3, workflow: 2, system: 1 };
export const KIND_LABEL: Record<NotificationKind, string> = {
  critical: "Kritisch", workflow: "Workflow", assignment: "Zuweisung", mention: "Erwähnung", deadline: "Termin", system: "System",
};
