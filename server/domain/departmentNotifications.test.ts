import { describe, expect, it } from "vitest";
import { dedupKeyFor, defaultSubscribed, departmentsWithWork, eligibleForDepartment, grantFromSnapshot, isSubscribed, planDepartmentNotifications, type GrantHolder } from "./departmentNotifications";
import { principalIdForOpenId } from "./principalId";

const holder = (principalId: string, role: "admin" | "editor" | "viewer", departments: string[], workspaces: "ALL" | string[] = "ALL"): GrantHolder => ({ principalId, grant: { role, departments, workspaces } });
const work = { checklistId: 7, projectId: 99, workspace: "Frankfurt", departments: ["EEA", "ITK"] };
const label = { station: "Alpha", projektnummer: "G.1", actorName: "Markus" };

describe("department notification policy (pure)", () => {
  it("only reviews with work count: 'offen' yes, 'nicht erforderlich' no", () => {
    expect(departmentsWithWork([{ department: "EEA", status: "offen" }, { department: "ITK", status: "nicht erforderlich" }, { department: "BS", status: null }])).toEqual(["EEA"]);
  });
  it("eligibility is permission: editors by department claim, admins always, viewers never — case-insensitive on the claim", () => {
    expect(eligibleForDepartment({ role: "editor", departments: ["eea"] }, "EEA")).toBe(true);
    expect(eligibleForDepartment({ role: "editor", departments: ["EEA"] }, "ITK")).toBe(false);
    expect(eligibleForDepartment({ role: "admin", departments: [] }, "ITK")).toBe(true);
    expect(eligibleForDepartment({ role: "viewer", departments: ["EEA"] }, "EEA")).toBe(false);
  });
  it("default policy: editors follow their grant's departments, administrators opt in; an explicit row always wins", () => {
    expect(defaultSubscribed({ role: "editor", departments: ["EEA"] }, "EEA")).toBe(true);
    expect(defaultSubscribed({ role: "admin", departments: [] }, "EEA")).toBe(false);
    expect(isSubscribed({ role: "editor", departments: ["EEA"] }, "EEA", { enabled: false })).toBe(false);
    expect(isSubscribed({ role: "admin", departments: [] }, "EEA", { enabled: true })).toBe(true);
  });
  it("recipients: EEA-only gets EEA, ITK-only gets ITK, both get both; the actor, viewers, other-workspace editors and unsubscribed users get nothing; subscription never widens", () => {
    const holders = [
      holder("eea", "editor", ["EEA"]), holder("itk", "editor", ["ITK"]), holder("both", "editor", ["EEA", "ITK"]),
      holder("actor", "editor", ["EEA", "ITK"]), holder("viewer", "viewer", ["EEA"]), holder("kassel", "editor", ["EEA"], ["Kassel"]),
      holder("off", "editor", ["ITK"]), holder("admin", "admin", []), holder("wide", "editor", ["BS"]),
    ];
    const rows = [
      { userId: "off", department: "ITK", enabled: false, source: "user" as const },
      { userId: "admin", department: "EEA", enabled: true, source: "user" as const },
      { userId: "wide", department: "EEA", enabled: true, source: "admin" as const }, // explicit ON, but the grant no longer carries EEA
    ];
    const out = planDepartmentNotifications(work, holders, rows, "actor", label);
    const got = out.map((n) => `${n.userId}:${n.department}`).sort();
    expect(got).toEqual(["admin:EEA", "both:EEA", "both:ITK", "eea:EEA", "itk:ITK"]);
    const n = out.find((x) => x.userId === "eea")!;
    expect(n).toMatchObject({ kind: "assignment", dedupKey: "checklist.submitted:7:EEA", link: "/projects?projekt=99", workspace: "Frankfurt" });
    expect(n.title).toContain("EEA");
    expect(n.title).toContain("Alpha");
  });
  it("a submission with only ITK work notifies only ITK subscribers", () => {
    const out = planDepartmentNotifications({ ...work, departments: ["ITK"] }, [holder("eea", "editor", ["EEA"]), holder("itk", "editor", ["ITK"])], [], "x", label);
    expect(out.map((n) => n.userId)).toEqual(["itk"]);
  });
  it("the dedup key is the logical fact, not the event", () => {
    expect(dedupKeyFor(7, "EEA")).toBe(dedupKeyFor(7, "EEA"));
    expect(dedupKeyFor(7, "EEA")).not.toBe(dedupKeyFor(8, "EEA"));
  });
  it("grant snapshots: the provisioner's JSON parses; garbage is no grant; unknown roles are viewers", () => {
    expect(grantFromSnapshot('{"role":"editor","workspaces":["Frankfurt"],"departments":["EEA"]}')).toEqual({ role: "editor", workspaces: ["Frankfurt"], departments: ["EEA"] });
    expect(grantFromSnapshot('{"role":"admin","workspaces":"ALL","departments":[]}')).toEqual({ role: "admin", workspaces: "ALL", departments: [] });
    expect(grantFromSnapshot('{"role":"root","workspaces":"*"}')).toEqual({ role: "viewer", workspaces: [], departments: [] });
    expect(grantFromSnapshot("not json")).toBeNull();
    expect(grantFromSnapshot(null)).toBeNull();
  });
  it("principal id derivation is pinned (migration 0014 backfills the same value with SHA2)", () => {
    // sha256("oidc:t:o-1") = 7a0e… — the first 31 hex chars after 'o'
    expect(principalIdForOpenId("oidc:t:o-1")).toMatch(/^o[0-9a-f]{31}$/);
    expect(principalIdForOpenId("oidc:t:o-1")).toBe(principalIdForOpenId("oidc:t:o-1"));
    expect(principalIdForOpenId("oidc:t:o-1")).not.toBe(principalIdForOpenId("oidc:t:o-2"));
  });
});
