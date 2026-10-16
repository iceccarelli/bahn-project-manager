import { describe, expect, it } from "vitest";
import { assess, claimShape, compareWithServer, decodePayload, EXPECTED, idpKind, PERSONAS, subjectLabel, tokenEnvName, trustsMicrosoftKeys } from "./entraAcceptance";

const jwt = (payload: object) => `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;

describe("entra acceptance helpers", () => {
  it("only Microsoft's own issuer hosts count as Entra (look-alikes do not)", () => {
    expect(idpKind("https://login.microsoftonline.com/t/v2.0")).toBe("microsoft-entra");
    expect(idpKind("https://sts.windows.net/t/")).toBe("microsoft-entra");
    expect(idpKind("https://login.microsoftonline.com.evil.example/t/v2.0")).toBe("other");
    expect(idpKind("http://127.0.0.1:3290/")).toBe("other");
    expect(idpKind("not a url")).toBe("other");
  });
  it("decodes a payload without trusting it, and reports structure, not identity values", () => {
    const p = decodePayload(jwt({ iss: "i", aud: "a", ver: "2.0", tid: "T", oid: "O", name: "Erika Muster", preferred_username: "e@x", roles: ["Editor", "Workspace.Kassel"], workspaces: "Kassel", iat: 100, exp: 3700 }))!;
    const shape = claimShape(p);
    expect(shape).toMatchObject({ ver: "2.0", hasTid: true, hasOid: true, grantRoles: ["Workspace.Kassel"], workspacesClaim: "string", departmentsClaim: "absent", lifetimeSeconds: 3600 });
    expect(JSON.stringify(shape)).not.toMatch(/Erika|e@x|"O"/);
    expect(decodePayload("garbage")).toBeNull();
  });
  it("subject labels are stable and do not contain the subject", () => {
    expect(subjectLabel("t:o")).toBe(subjectLabel("t:o"));
    expect(subjectLabel("t:o")).not.toBe(subjectLabel("t:p"));
    expect(subjectLabel("tenant:object")).toMatch(/^[0-9a-f]{8}$/);
  });
  it("each persona is judged against its expected grant", () => {
    const shape = claimShape({ tid: "t", oid: "o" });
    expect(assess("admin", { role: "admin", workspaces: "ALL", departments: [] }, shape).ok).toBe(true);
    expect(assess("admin", { role: "editor", workspaces: ["Kassel"], departments: [] }, shape).problems).toHaveLength(2);
    expect(assess("editor", { role: "editor", workspaces: ["Kassel"], departments: ["ITK"] }, shape).ok).toBe(true);
    expect(assess("editor", { role: "editor", workspaces: "ALL", departments: ["ITK"] }, shape).ok).toBe(false); // an editor with ALL is a mis-assignment
    expect(assess("viewer", { role: "viewer", workspaces: [], departments: [] }, shape).ok).toBe(false);
    expect(assess("viewer", { role: "viewer", workspaces: ["Kassel"], departments: [] }, shape).ok).toBe(true);
    expect(assess("nogrant", { role: "viewer", workspaces: [], departments: [] }, shape).ok).toBe(true);
    expect(assess("nogrant", { role: "viewer", workspaces: ["Kassel"], departments: [] }, shape).ok).toBe(false); // would hide the pending-access page
    expect(Object.keys(EXPECTED)).toEqual([...PERSONAS]);
    expect(tokenEnvName("nogrant")).toBe("ENTRA_TOKEN_NOGRANT");
  });
  it("department grants are asserted: the editor needs one, viewer and nogrant must have none, admin is not constrained", () => {
    const shape = claimShape({ tid: "t", oid: "o" });
    expect(assess("editor", { role: "editor", workspaces: ["Kassel"], departments: [] }, shape).problems.join()).toMatch(/departments are \[\]/);
    expect(assess("viewer", { role: "viewer", workspaces: ["Kassel"], departments: ["EEA"] }, shape).problems.join()).toMatch(/expected none/);
    expect(assess("nogrant", { role: "viewer", workspaces: [], departments: ["EEA"] }, shape).ok).toBe(false);
    expect(assess("admin", { role: "admin", workspaces: "ALL", departments: ["EEA", "ITK"] }, shape).ok).toBe(true);
  });
  it("real-entra needs Microsoft keys for the issuers' one tenant: a custom OIDC_JWKS_URI cannot be certified as Entra", () => {
    const v2 = "https://login.microsoftonline.com/tid-1/v2.0", v1 = "https://sts.windows.net/tid-1/";
    const keys = "https://login.microsoftonline.com/tid-1/discovery/v2.0/keys";
    expect(trustsMicrosoftKeys([v2, v1], undefined).ok).toBe(true);
    expect(trustsMicrosoftKeys([v2], "").ok).toBe(true);
    expect(trustsMicrosoftKeys([v2], keys).ok).toBe(true);
    expect(trustsMicrosoftKeys([v2], "http://127.0.0.1:3290/jwks").ok).toBe(false);          // Microsoft-looking issuer over mock keys
    expect(trustsMicrosoftKeys([v2], "https://evil.example/tid-1/discovery/v2.0/keys").ok).toBe(false);
    expect(trustsMicrosoftKeys([v2], "https://login.microsoftonline.com/other/discovery/v2.0/keys").ok).toBe(false); // another tenant's keys
    expect(trustsMicrosoftKeys([v2, "https://sts.windows.net/tid-2/"], undefined).ok).toBe(false); // issuers of two tenants
    expect(trustsMicrosoftKeys([v2, "http://127.0.0.1:3290/"], undefined).ok).toBe(false);
    expect(trustsMicrosoftKeys([], undefined).ok).toBe(false);
  });
  it("the deployed server must agree with local verification on role, workspaces and departments — order-insensitively", () => {
    const id = { role: "editor" as const, workspaces: ["Kassel", "Mainz"], departments: ["EEA", "ITK"] };
    expect(compareWithServer(id, { status: 200, role: "editor", workspaces: ["Mainz", "Kassel"], departments: ["ITK", "EEA"] })).toEqual([]);
    expect(compareWithServer(id, { status: 200, role: "viewer", workspaces: ["Kassel", "Mainz"], departments: ["EEA", "ITK"] }).join()).toMatch(/role/);
    expect(compareWithServer(id, { status: 200, role: "editor", workspaces: ["Kassel"], departments: ["EEA", "ITK"] }).join()).toMatch(/workspaces/);
    expect(compareWithServer(id, { status: 200, role: "editor", workspaces: "ALL", departments: ["EEA", "ITK"] }).join()).toMatch(/workspaces/);
    expect(compareWithServer(id, { status: 200, role: "editor", workspaces: ["Kassel", "Mainz"], departments: ["EEA"] }).join()).toMatch(/departments/);
    expect(compareWithServer(id, { status: 200, role: "editor", workspaces: ["Kassel", "Mainz"] }).join()).toMatch(/departments/); // server omitted them
    expect(compareWithServer({ ...id, workspaces: "ALL" }, { status: 200, role: "editor", workspaces: "ALL", departments: ["EEA", "ITK"] })).toEqual([]);
    expect(compareWithServer({ ...id, workspaces: "ALL" }, { status: 200, role: "editor", workspaces: ["Kassel"], departments: ["EEA", "ITK"] }).join()).toMatch(/workspaces/);
    expect(compareWithServer(id, { status: 401 })).toHaveLength(1);
  });
  it("warns when the tenant emits workspaces as a string (the server ignores it) and for app-only tokens", () => {
    const a = assess("editor", { role: "editor", workspaces: [], departments: [] }, claimShape({ tid: "t", oid: "o", workspaces: "Kassel", idtyp: "app" }));
    expect(a.ok).toBe(false);
    expect(a.warnings.join(" ")).toMatch(/single string/);
    expect(a.warnings.join(" ")).toMatch(/app-only/);
  });
});
