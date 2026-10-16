import { describe, expect, it } from "vitest";
import { assess, claimShape, decodePayload, EXPECTED, idpKind, PERSONAS, subjectLabel, tokenEnvName } from "./entraAcceptance";

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
    expect(assess("admin", { role: "admin", workspaces: "ALL" }, shape).ok).toBe(true);
    expect(assess("admin", { role: "editor", workspaces: ["Kassel"] }, shape).problems).toHaveLength(2);
    expect(assess("editor", { role: "editor", workspaces: ["Kassel"] }, shape).ok).toBe(true);
    expect(assess("editor", { role: "editor", workspaces: "ALL" }, shape).ok).toBe(false); // an editor with ALL is a mis-assignment
    expect(assess("viewer", { role: "viewer", workspaces: [] }, shape).ok).toBe(false);
    expect(assess("nogrant", { role: "viewer", workspaces: [] }, shape).ok).toBe(true);
    expect(assess("nogrant", { role: "viewer", workspaces: ["Kassel"] }, shape).ok).toBe(false); // would hide the pending-access page
    expect(Object.keys(EXPECTED)).toEqual([...PERSONAS]);
    expect(tokenEnvName("nogrant")).toBe("ENTRA_TOKEN_NOGRANT");
  });
  it("warns when the tenant emits workspaces as a string (the server ignores it) and for app-only tokens", () => {
    const a = assess("editor", { role: "editor", workspaces: [] }, claimShape({ tid: "t", oid: "o", workspaces: "Kassel", idtyp: "app" }));
    expect(a.ok).toBe(false);
    expect(a.warnings.join(" ")).toMatch(/single string/);
    expect(a.warnings.join(" ")).toMatch(/app-only/);
  });
});
