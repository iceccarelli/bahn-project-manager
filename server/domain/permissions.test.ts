import { describe, expect, it } from "vitest";
import {
  canApproveReview, canDeleteProject, canEditDepartment, canEditProject, canExport, canManageUsers,
  canSubscribe, canViewAudit, canViewProject, roleFromLegacy,
} from "./permissions";
import { admin, markus, viewer, mitteOnly } from "./testFixtures";

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
    expect(roleFromLegacy(undefined)).toBe("editor");
  });
});
