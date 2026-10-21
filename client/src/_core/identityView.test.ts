import { describe, expect, it } from "vitest";
import { describeDemoUser, describeSession, initialsOf, workspaceSummary } from "./identityView";

describe("describeSession — the person shown is the person the server validated", () => {
  it("shows name, e-mail, application role, workspaces and department grants as given", () => {
    const v = describeSession({ name: "Erika Muster", email: "erika.muster@bahn.example", role: "editor", workspaces: ["Frankfurt", "Kassel"], departments: ["ITK"] });
    expect(v).toMatchObject({ displayName: "Erika Muster", email: "erika.muster@bahn.example", initials: "EM", roleKey: "editor", roleLabel: "Bearbeiter", workspaces: ["Frankfurt", "Kassel"], workspaceSummary: "Frankfurt, Kassel", departments: ["ITK"], hasAnyGrant: true, source: "microsoft" });
  });
  it("two different people never share an identity view, and nothing of one leaks into the other", () => {
    const a = describeSession({ name: "Anna Admin", email: "anna@bahn.example", role: "admin", workspaces: "ALL", departments: [] });
    const b = describeSession({ name: "Viktor Viewer", email: "viktor@bahn.example", role: "viewer", workspaces: ["Mainz"], departments: ["EEA"] });
    expect(a).toMatchObject({ displayName: "Anna Admin", roleKey: "admin", roleLabel: "Administrator", workspaceSummary: "Alle Bahnhofsmanagements", departments: [] });
    expect(b).toMatchObject({ displayName: "Viktor Viewer", roleKey: "viewer", roleLabel: "Lesezugriff", workspaces: ["Mainz"], departments: ["EEA"] });
    expect(JSON.stringify(b)).not.toMatch(/Anna|anna@|Administrator/);
  });
  it("missing optional claims fall back gracefully and never to a made-up persona or title", () => {
    expect(describeSession({ email: "only.mail@bahn.example", role: "viewer", workspaces: ["Mainz"] })).toMatchObject({ displayName: "only.mail@bahn.example", email: null, initials: "O" });
    const anon = describeSession({});
    expect(anon).toMatchObject({ displayName: "Angemeldet", email: null, initials: "?", roleKey: "viewer", workspaces: [], workspaceSummary: "Kein Bahnhofsmanagement freigegeben", departments: [], hasAnyGrant: false });
    expect(JSON.stringify(anon)).not.toMatch(/Prüfer|Fachspezialist|Vincenzo|Grimaldi/);
  });
  it("unknown roles, malformed grants and wrong types are least-privileged, not trusted", () => {
    const v = describeSession({ name: 42 as never, role: "superuser", workspaces: "*", departments: [1, null, "ITK", " ", { x: 1 }] as never });
    expect(v).toMatchObject({ displayName: "Angemeldet", roleKey: "viewer", workspaces: [], departments: ["ITK"] });
    expect(describeSession({ role: "admin" }).hasAnyGrant).toBe(true);
  });
  it("a department grant is shown as a grant, with no function title attached to it", () => {
    const v = describeSession({ name: "Erika Muster", role: "editor", workspaces: ["Kassel"], departments: ["ITK"] });
    expect(JSON.stringify(v)).not.toMatch(/Fachspezialist|Prüfer|Leiter|Manager/);
  });
});

describe("helpers", () => {
  it("initials: first+last word, Unicode-safe, e-mail fallback", () => {
    expect(initialsOf("Jürgen von der Heide", null)).toBe("JH");
    expect(initialsOf("Özlem", null)).toBe("Ö");
    expect(initialsOf(null, "zoe@bahn.example")).toBe("Z");
    expect(initialsOf(null, null)).toBe("?");
  });
  it("workspace summary caps long lists", () => {
    expect(workspaceSummary("ALL")).toBe("Alle Bahnhofsmanagements");
    expect(workspaceSummary(["A", "B", "C", "D"])).toBe("4 Bahnhofsmanagements");
  });
  it("the demo account is labelled as a demo, not as a real role", () => {
    expect(describeDemoUser({ name: "Admin", email: "admin@bahn.de" })).toMatchObject({ source: "demo", roleKey: "demo", roleLabel: "Demo-Konto" });
  });
});
