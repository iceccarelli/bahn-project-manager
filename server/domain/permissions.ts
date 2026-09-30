/**
 * Authorization — explicit, pure, and the only place role logic lives.
 *
 * A Principal is built on the server from a verified identity (session cookie
 * or OIDC bearer token). Nothing here reads browser state.
 *
 * Model:
 *   admin   — everything
 *   editor  — view/edit projects in their workspaces, approve reviews in their
 *             departments, export, view audit
 *   viewer  — read-only within their workspaces
 *
 * Workspace access is EXPLICIT and default-deny:
 *   workspaces === "ALL"        an explicit all-workspaces grant
 *   workspaces === ["Kassel"]   exactly those workspaces
 *   workspaces === []           NO workspace access (a missing claim lands here)
 * Only admins see every workspace without a grant. Nothing ever widens access
 * because a claim was absent.
 */
import { slugify } from "@shared/domain-events";

export type Role = "admin" | "editor" | "viewer";

export interface Principal {
  /** stable internal id (users.id) as string */
  id: string;
  name: string | null;
  email: string | null;
  role: Role;
  workspaces: WorkspaceAccess;
  departments: readonly string[];
}

export type WorkspaceAccess = "ALL" | readonly string[];

/** The workspace names a principal is restricted to; null = unrestricted (admin or explicit ALL). */
export function workspaceRestriction(p: Pick<Principal, "role" | "workspaces">): readonly string[] | null {
  if (p.role === "admin" || p.workspaces === "ALL") return null;
  return p.workspaces;
}

export interface ProjectContext {
  bahnhofsmanagement: string | null;
}

const inWorkspaces = (p: Principal, ws: string | null): boolean => {
  const allowed = workspaceRestriction(p);
  return allowed === null || (ws !== null && allowed.some(w => slugify(w) === slugify(ws)));
};

export const isAdmin = (p: Principal) => p.role === "admin";
const canWriteRole = (p: Principal) => p.role === "admin" || p.role === "editor";

export function canViewProject(p: Principal, project: ProjectContext): boolean {
  return isAdmin(p) || inWorkspaces(p, project.bahnhofsmanagement);
}

export function canEditProject(p: Principal, project: ProjectContext): boolean {
  return canWriteRole(p) && canViewProject(p, project);
}

export function canCreateProject(p: Principal, target: ProjectContext): boolean {
  return canEditProject(p, target);
}

export function canEditDepartment(p: Principal, department: string): boolean {
  return (
    isAdmin(p) ||
    (p.role === "editor" && p.departments.some(d => d.toUpperCase() === department.toUpperCase()))
  );
}

export function canApproveReview(p: Principal, project: ProjectContext, department: string): boolean {
  return canViewProject(p, project) && canEditDepartment(p, department);
}

export function canDeleteProject(p: Principal, _project: ProjectContext): boolean {
  return isAdmin(p);
}

export function canViewAudit(p: Principal): boolean {
  return canWriteRole(p);
}

export function canExport(p: Principal): boolean {
  return canWriteRole(p);
}

export function canManageUsers(p: Principal): boolean {
  return isAdmin(p);
}

/**
 * May this principal subscribe to `scopeKey`? Enforced by the realtime gateway
 * for every requested channel; a principal never receives events for a scope
 * this returns false for.
 */
export function canSubscribe(p: Principal, scopeKey: string): boolean {
  const idx = scopeKey.indexOf(":");
  const kind = scopeKey.slice(0, idx);
  const id = scopeKey.slice(idx + 1);
  switch (kind) {
    case "user":
    case "notifications":
      return id === p.id || isAdmin(p);
    case "workspace": {
      const allowed = workspaceRestriction(p);
      return allowed === null || allowed.some(w => slugify(w) === id);
    }
    case "department":
      return isAdmin(p) || p.departments.some(d => d.toUpperCase() === id.toUpperCase());
    case "project":
      // Project channels are checked against the project's workspace by the
      // gateway (it loads the row); here only the coarse check is possible.
      return true;
    default:
      return false;
  }
}

/**
 * Map the legacy users.role enum onto the RBAC roles. Only the two values the
 * legacy schema can hold are recognised; anything else (null, undefined, a
 * future value) is the LEAST privileged role, never an implicit editor.
 */
export function roleFromLegacy(legacy: string | null | undefined): Role {
  if (legacy === "admin") return "admin";
  if (legacy === "user") return "editor";
  return "viewer";
}
