import { describe, expect, it } from "vitest";
import {
  canApproveReview, canCreateProject, canDeleteProject, canEditDepartment, canEditProject, canExport, canManageUsers,
  canSubscribe, canViewAudit, canViewProject, roleFromLegacy,
} from "./permissions";
import { admin, markus, viewer, mitteOnly } from "./testFixtures";
import { workspaceRestriction, type Principal } from "./permissions";
import { workspacesFromClaim } from "../_core/oidc";
import { principalFromUser } from "../_core/identity";

const ffm = { bahnhofsmanagement: "Frankfurt" }, kas = { bahnhofsmanagement: "Kassel" }, none = { bahnhofsmanagement: null };

describe("permissions", () => {
  it("viewer reads but never writes", () => {
    expect(canViewProject(viewer, ffm)).toBe(true);
    expect(canEditProject(viewer, ffm)).toBe(false);
    expect(canViewAudit(viewer)).toBe(false);
    expect(canExport(viewer)).toBe(false);
  });
  it("workspace restriction applies to view AND edit; projects without a workspace are invisible to restricted users", () => {
    expect(canViewProject(mitteOnly, ffm)).toBe(true);
    expect(canViewProject(mitteOnly, kas)).toBe(false);
    expect(canEditProject(mitteOnly, kas)).toBe(false);
    expect(canViewProject(mitteOnly, none)).toBe(false);
    expect(canViewProject({ ...mitteOnly, workspaces: ["Gießen"] }, { bahnhofsmanagement: "gießen" })).toBe(true);
  });
  it("only admins delete and manage users", () => {
    expect(canDeleteProject(markus, ffm)).toBe(false);
    expect(canDeleteProject(admin, ffm)).toBe(true);
    expect(canManageUsers(markus)).toBe(false);
    expect(canManageUsers(admin)).toBe(true);
  });
  it("department approval requires the department", () => {
    expect(canEditDepartment(markus, "itk")).toBe(true);
    expect(canEditDepartment(markus, "EEA")).toBe(false);
    expect(canApproveReview(markus, ffm, "ITK")).toBe(true);
    expect(canApproveReview(markus, ffm, "EEA")).toBe(false);
    expect(canApproveReview(viewer, ffm, "ITK")).toBe(false);
  });
  it("subscription scopes: own user/notification channels only; department by membership", () => {
    expect(canSubscribe(markus, "user:2")).toBe(true);
    expect(canSubscribe(markus, "user:3")).toBe(false);
    expect(canSubscribe(markus, "notifications:3")).toBe(false);
    expect(canSubscribe(admin, "notifications:3")).toBe(true);
    expect(canSubscribe(markus, "department:ITK")).toBe(true);
    expect(canSubscribe(markus, "department:EEA")).toBe(false);
    expect(canSubscribe(mitteOnly, "workspace:frankfurt")).toBe(true);
    expect(canSubscribe(mitteOnly, "workspace:kassel")).toBe(false);
    expect(canSubscribe(markus, "bogus:1")).toBe(false);
  });
  it("legacy role mapping is least-surprising", () => {
    expect(roleFromLegacy("admin")).toBe("admin");
    expect(roleFromLegacy("user")).toBe("editor");
    // unknown / missing must never become an editor
    expect(roleFromLegacy(undefined)).toBe("viewer");
    expect(roleFromLegacy(null)).toBe("viewer");
    expect(roleFromLegacy("superuser")).toBe("viewer");
  });
});

describe("workspace access is explicit and default-deny", () => {
  const base = { id: "9", name: "x", email: null, departments: [] as string[] };
  const P = (role: Principal["role"], workspaces: Principal["workspaces"]): Principal => ({ ...base, role, workspaces });
  const ffm = { bahnhofsmanagement: "Frankfurt" }, none = { bahnhofsmanagement: null };

  it("no workspace grant ([]) = no access at all, for every non-admin role", () => {
    for (const role of ["viewer", "editor"] as const) {
      const p = P(role, []);
      expect(canViewProject(p, ffm)).toBe(false);
      expect(canEditProject(p, ffm)).toBe(false);
      expect(canViewProject(p, none)).toBe(false);
      expect(canSubscribe(p, "workspace:frankfurt")).toBe(false);
      expect(workspaceRestriction(p)).toEqual([]);
    }
  });
  it("viewer with no workspace claim sees nothing; viewer with one workspace reads only it and never writes", () => {
    expect(canViewProject(P("viewer", []), ffm)).toBe(false);
    const v = P("viewer", ["Frankfurt"]);
    expect(canViewProject(v, ffm)).toBe(true);
    expect(canViewProject(v, { bahnhofsmanagement: "Kassel" })).toBe(false);
    expect(canEditProject(v, ffm)).toBe(false);
  });
  it("editor with one workspace edits only there", () => {
    const e = P("editor", ["Frankfurt"]);
    expect(canEditProject(e, ffm)).toBe(true);
    expect(canEditProject(e, { bahnhofsmanagement: "Kassel" })).toBe(false);
    expect(canCreateProject(e, { bahnhofsmanagement: "Kassel" })).toBe(false);
  });
  it("editor with explicit ALL edits everywhere (including workspace-less projects)", () => {
    const e = P("editor", "ALL");
    expect(canEditProject(e, ffm)).toBe(true);
    expect(canEditProject(e, { bahnhofsmanagement: "Kassel" })).toBe(true);
    expect(canViewProject(e, none)).toBe(true);
    expect(workspaceRestriction(e)).toBeNull();
    expect(canSubscribe(e, "workspace:kassel")).toBe(true);
  });
  it("admin is unrestricted regardless of the workspace field", () => {
    expect(canViewProject(P("admin", []), ffm)).toBe(true);
    expect(workspaceRestriction(P("admin", []))).toBeNull();
  });
  it("claims: only the literal ALL grants everything; missing/garbage never widen access", () => {
    expect(workspacesFromClaim(undefined)).toEqual([]);
    expect(workspacesFromClaim(null)).toEqual([]);
    expect(workspacesFromClaim("ALL")).toEqual([]);            // a bare string is not a valid claim shape
    expect(workspacesFromClaim(["Frankfurt", " Kassel "])).toEqual(["Frankfurt", "Kassel"]);
    expect(workspacesFromClaim(["all"])).toBe("ALL");
    expect(workspacesFromClaim(["Frankfurt", "ALL"])).toBe("ALL");
    expect(workspacesFromClaim(["*"])).toEqual(["*"]);          // wildcard is NOT a grant: it matches no workspace
    expect(workspacesFromClaim([42, {}, ""])).toEqual([]);
    expect(canViewProject(P("editor", workspacesFromClaim(["*"])), ffm)).toBe(false);
  });
  it("legacy users: no assignment = no workspaces; only admin / demo login / explicit env opt-in are open", () => {
    const u = { id: 7, openId: "o", name: "n", email: null, loginMethod: "manus", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } as never;
    expect(principalFromUser(u).workspaces).toEqual([]);
    expect(principalFromUser({ ...(u as object), role: "admin" } as never).workspaces).toBe("ALL");
    expect(principalFromUser({ ...(u as object), loginMethod: "demo" } as never).workspaces).toBe("ALL");
    process.env.LEGACY_USER_WORKSPACES = "ALL";
    try { expect(principalFromUser(u).workspaces).toBe("ALL"); } finally { delete process.env.LEGACY_USER_WORKSPACES; }
    expect(principalFromUser(u, { workspaces: ["Kassel"] }).workspaces).toEqual(["Kassel"]);
  });
});
