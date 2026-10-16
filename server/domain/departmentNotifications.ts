/**
 * Department (Gewerk) notifications for a submitted Projektanmeldung — the pure part.
 *
 * WHAT notifies: the `checklist.submitted` transition, and only the departments whose generated review says there is work
 * (`status = "offen"`, decided by the workbook's trigger rule in shared/checklist.ts). "nicht erforderlich" is no event.
 * A draft save is never an event; an idempotent retry replays the stored answer and runs no policy.
 *
 * WHO receives: for each such department, every user who
 *   1. is eligible — may see the project's workspace under their CURRENT grant and holds the department in it
 *      (editors with the department claim; administrators are eligible for every department), and
 *   2. is subscribed — an explicit `department_subscriptions` row decides; without a row the DEFAULT applies:
 *      editors are subscribed to exactly the departments of their grant, administrators to none (they opt in).
 *   minus the actor. A subscription never widens access: an explicit "on" for a department the grant no longer carries
 *   delivers nothing until the grant returns.
 *
 * Idempotent by construction: the dedup key `checklist.submitted:<checklistId>:<department>` is unique per recipient
 * (notifications_user_dedup_uq), so the same logical fact — however many events or retries carry it — is stored once.
 */
import type { NotificationKind } from "@shared/notification-contract";
import { canViewProject, type Principal } from "./permissions";

export type SubscriptionSource = "user" | "admin";

export interface SubscriptionRow { userId: string; department: string; enabled: boolean; source: SubscriptionSource }

/** A user as the recipient query returns them: their current grant, re-read at delivery time. */
export interface GrantHolder { principalId: string; grant: Pick<Principal, "role" | "workspaces" | "departments"> }

const sameDept = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

/** Eligibility is permission, not preference: admin → any department; editor → the departments of the grant. Viewers never. */
export function eligibleForDepartment(grant: Pick<Principal, "role" | "departments">, department: string): boolean {
  if (grant.role === "admin") return true;
  if (grant.role !== "editor") return false;
  return grant.departments.some((d) => sameDept(d, department));
}

/** The default when no row exists: editors follow the departments of their grant, administrators opt in. */
export function defaultSubscribed(grant: Pick<Principal, "role" | "departments">, department: string): boolean {
  return grant.role === "editor" && grant.departments.some((d) => sameDept(d, department));
}

export function isSubscribed(grant: Pick<Principal, "role" | "departments">, department: string, row: Pick<SubscriptionRow, "enabled"> | null | undefined): boolean {
  if (row) return row.enabled;
  return defaultSubscribed(grant, department);
}

export interface SubmittedWork { checklistId: number; projectId: number; workspace: string | null; departments: readonly string[] }

/** The departments a submission creates review work for: the generated reviews whose status is "offen". */
export const departmentsWithWork = (reviews: ReadonlyArray<{ department: string; status: string | null }>): string[] =>
  reviews.filter((r) => r.status === "offen").map((r) => r.department);

export interface PlannedDepartmentNotification {
  userId: string;
  department: string;
  dedupKey: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string;
  workspace: string | null;
}

export function dedupKeyFor(checklistId: number, department: string): string {
  return `checklist.submitted:${checklistId}:${department}`;
}

/**
 * Recipients × departments → one planned notification each. `holders` are the candidate users (anyone the store found with a
 * subscription row or a grant naming one of the departments); `rows` their explicit subscription rows. Pure.
 */
export function planDepartmentNotifications(
  work: SubmittedWork,
  holders: readonly GrantHolder[],
  rows: readonly SubscriptionRow[],
  actorId: string,
  label: { station: string | null; projektnummer: string | null; actorName: string | null },
): PlannedDepartmentNotification[] {
  const rowOf = new Map(rows.map((r) => [`${r.userId}|${r.department.toUpperCase()}`, r]));
  const out: PlannedDepartmentNotification[] = [];
  const name = label.station || label.projektnummer || `Projekt ${work.projectId}`;
  for (const department of work.departments) {
    for (const h of holders) {
      if (h.principalId === actorId) continue;
      if (!eligibleForDepartment(h.grant, department)) continue;
      if (!canViewProject({ ...h.grant, id: h.principalId, name: null, email: null }, { bahnhofsmanagement: work.workspace })) continue;
      if (!isSubscribed(h.grant, department, rowOf.get(`${h.principalId}|${department.toUpperCase()}`))) continue;
      out.push({
        userId: h.principalId, department, dedupKey: dedupKeyFor(work.checklistId, department), kind: "assignment",
        title: `${department}: neue Projektanmeldung — ${name}`.slice(0, 256),
        body: `${label.actorName ?? "Jemand"} hat ${name}${work.workspace ? ` (${work.workspace})` : ""} angemeldet. Für ${department} ist eine Prüfung offen.`.slice(0, 1024),
        link: `/projects?projekt=${work.projectId}`, workspace: work.workspace,
      });
    }
  }
  return out;
}

/** Parse the grant snapshot the provisioner stores (`grantJson` in server/_core/identity.ts); anything unreadable is no grant. */
export function grantFromSnapshot(snapshot: string | null): Pick<Principal, "role" | "workspaces" | "departments"> | null {
  if (!snapshot) return null;
  try {
    const j = JSON.parse(snapshot) as { role?: unknown; workspaces?: unknown; departments?: unknown };
    const role = j.role === "admin" || j.role === "editor" || j.role === "viewer" ? j.role : "viewer";
    const workspaces = j.workspaces === "ALL" ? ("ALL" as const) : Array.isArray(j.workspaces) ? j.workspaces.filter((w): w is string => typeof w === "string") : [];
    const departments = Array.isArray(j.departments) ? j.departments.filter((d): d is string => typeof d === "string") : [];
    return { role, workspaces, departments };
  } catch { return null; }
}
