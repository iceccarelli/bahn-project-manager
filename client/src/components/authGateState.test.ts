import { describe, expect, it } from "vitest";
import { gateView, type GateInput } from "./authGateState";

const base: GateInput = { loading: false, isAuthenticated: true, location: "/projects", sessionFailed: false, accessPending: false };
const v = (o: Partial<GateInput>) => gateView({ ...base, ...o });

describe("gateView", () => {
  it("renders the app only for a signed-in person with a grant", () => expect(v({})).toBe("children"));
  it("shows the skeleton while the session is being looked up, whatever else is true", () => expect(v({ loading: true, isAuthenticated: false, sessionFailed: true })).toBe("loading"));
  it("signed out: protected routes go to /login, the login page itself renders", () => {
    expect(v({ isAuthenticated: false })).toBe("redirect-login");
    expect(v({ isAuthenticated: false, location: "/login" })).toBe("children");
  });
  it("a failed session lookup is a recovery screen on EVERY route, never a redirect into another sign-in", () => {
    expect(v({ isAuthenticated: false, sessionFailed: true })).toBe("session-error");
    expect(v({ isAuthenticated: false, sessionFailed: true, location: "/login" })).toBe("session-error");
  });
  it("signed in without any grant: the explicit 'noch keine Freigabe' page, not an empty app", () => expect(v({ accessPending: true })).toBe("access-pending"));
  it("a signed-in person is never shown the recovery screen (a later refetch error keeps their data)", () => expect(v({ sessionFailed: true })).toBe("children"));
});
