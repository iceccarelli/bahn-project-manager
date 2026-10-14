/**
 * Who may see and import ITK Prüfberichte — ONE rule, used by the server (server/domain/permissions.ts, which
 * decides) and by the client (which only hides a tab it would be refused anyway). Prüfberichte have no
 * Bahnhofsmanagement, so there is no workspace to scope them by: default-deny for workspace-limited principals.
 */
export interface Grant {
  role: string;
  workspaces: "ALL" | readonly string[];
}

/** Admin, or an explicit all-workspaces grant. A missing or empty claim never widens access. */
export const mayViewPruefberichte = (g: Grant): boolean => g.role === "admin" || g.workspaces === "ALL";

/** Importing replaces records by key: admin only. An ALL grant on an editor is not enough. */
export const mayImportPruefberichte = (g: Pick<Grant, "role">): boolean => g.role === "admin";

/** Linking a report to a project changes what the project detail and the Abnahme show: editors with an all-workspaces grant, and admins. */
export const mayLinkPruefberichte = (g: Grant): boolean => mayViewPruefberichte(g) && (g.role === "admin" || g.role === "editor");
