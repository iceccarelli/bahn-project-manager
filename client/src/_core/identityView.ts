/**
 * How the signed-in person is shown in the application — from the validated session only.
 *
 * Source of truth is `auth.session` (server-verified token claims): display name, e-mail, application role, workspaces,
 * department grants. Nothing here is inferred from the name, the e-mail domain or a job title, and nothing is invented:
 * a missing name falls back to the e-mail, a missing e-mail to a neutral "Angemeldet". Department grants are shown as
 * grants ("Gewerke-Freigabe"), never as a function title — an employment title would need its own trusted source.
 * The browser-local demo shows its demo account, labelled as such.
 */
export type RoleKey = "admin" | "editor" | "viewer" | "demo";

export interface SessionLike {
  name?: string | null;
  email?: string | null;
  role?: string | null;
  workspaces?: unknown;
  departments?: unknown;
}

export interface DemoUserLike { name?: string | null; email?: string | null }

export interface IdentityView {
  displayName: string;
  email: string | null;
  initials: string;
  roleKey: RoleKey;
  roleLabel: string;
  /** "ALL" or the explicit list; [] means none (default-deny) */
  workspaces: "ALL" | string[];
  workspaceSummary: string;
  departments: string[];
  hasAnyGrant: boolean;
  source: "microsoft" | "demo";
}

const ROLE_LABEL: Record<Exclude<RoleKey, "demo">, string> = { admin: "Administrator", editor: "Bearbeiter", viewer: "Lesezugriff" };
const clean = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map(x => x.trim()) : []);

export function initialsOf(name: string | null, email: string | null): string {
  const first = (w: string) => Array.from(w)[0] ?? "";
  const words = (name ?? "").split(/\s+/).filter(Boolean);
  const head = words[0];
  const tail = words[words.length - 1];
  if (head && tail && words.length >= 2) return (first(head) + first(tail)).toLocaleUpperCase("de-DE");
  if (head) return first(head).toLocaleUpperCase("de-DE");
  const local = (email ?? "").split("@")[0] ?? "";
  return first(local).toLocaleUpperCase("de-DE") || "?";
}

export function workspaceSummary(ws: "ALL" | string[]): string {
  if (ws === "ALL") return "Alle Bahnhofsmanagements";
  if (ws.length === 0) return "Kein Bahnhofsmanagement freigegeben";
  return ws.length <= 3 ? ws.join(", ") : `${ws.length} Bahnhofsmanagements`;
}

export function describeSession(s: SessionLike): IdentityView {
  const name = clean(s.name);
  const email = clean(s.email);
  // role: only the three application roles exist; anything else is the least-privileged one (as on the server)
  const roleKey: RoleKey = s.role === "admin" ? "admin" : s.role === "editor" ? "editor" : "viewer";
  const workspaces: "ALL" | string[] = s.workspaces === "ALL" ? "ALL" : strings(s.workspaces);
  const departments = strings(s.departments);
  return {
    displayName: name ?? email ?? "Angemeldet", email: name ? email : null,
    initials: initialsOf(name, email), roleKey, roleLabel: ROLE_LABEL[roleKey as Exclude<RoleKey, "demo">],
    workspaces, workspaceSummary: workspaceSummary(workspaces), departments,
    hasAnyGrant: roleKey === "admin" || workspaces === "ALL" || workspaces.length > 0 || departments.length > 0,
    source: "microsoft",
  };
}

export function describeDemoUser(u: DemoUserLike): IdentityView {
  const name = clean(u.name);
  const email = clean(u.email);
  return {
    displayName: name ?? email ?? "Demo-Konto", email: name ? email : null, initials: initialsOf(name, email),
    roleKey: "demo", roleLabel: "Demo-Konto", workspaces: "ALL", workspaceSummary: "Synthetische Demo-Daten (nur in diesem Browser)",
    departments: [], hasAnyGrant: true, source: "demo",
  };
}
