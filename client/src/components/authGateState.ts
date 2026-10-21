/** What the application shell shows, given what is known about the session. Pure, so every state is testable. */
export type GateView = "loading" | "children" | "redirect-login" | "session-error" | "access-pending";

export interface GateInput {
  loading: boolean;
  isAuthenticated: boolean;
  location: string;
  /** the session lookup failed (server/network) while this tab holds a credential — NOT the same as signed out */
  sessionFailed: boolean;
  /** signed in, but the token grants nothing (docs/auth.md: default-deny) */
  accessPending: boolean;
}

export function gateView(i: GateInput): GateView {
  if (i.loading) return "loading";
  if (!i.isAuthenticated && i.sessionFailed) return "session-error";
  if (!i.isAuthenticated) return i.location === "/login" ? "children" : "redirect-login";
  if (i.accessPending) return "access-pending";
  return "children";
}
