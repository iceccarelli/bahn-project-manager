import { describe, expect, it } from "vitest";
import { entryLink, ssoEntry } from "./entry-links";

describe("entryLink", () => {
  it("accepts https and local http, nothing else", () => {
    expect(entryLink("https://demo.example.com/")).toBe("https://demo.example.com/");
    expect(entryLink(" https://demo.example.com/app ")).toBe("https://demo.example.com/app");
    expect(entryLink("http://localhost:5173/")).toBe("http://localhost:5173/");
    for (const bad of ["", undefined, null, "javascript:alert(1)", "//evil.example", "/login", "ftp://x.example", "http://demo.example.com", "https://user:pw@demo.example.com", "not a url", "data:text/html,x"]) expect(entryLink(bad as never)).toBeNull();
  });
});

describe("ssoEntry", () => {
  it("links to the production /login for a valid URL, with or without trailing slash", () => {
    expect(ssoEntry("https://app.example.com")).toEqual({ kind: "link", href: "https://app.example.com/login" });
    expect(ssoEntry("https://app.example.com/", "https://demo.example.com")).toEqual({ kind: "link", href: "https://app.example.com/login" });
  });
  it("says why there is no link instead of hiding the entry", () => {
    expect(ssoEntry(undefined)).toEqual({ kind: "unconfigured", reason: "missing" });
    expect(ssoEntry("  ")).toEqual({ kind: "unconfigured", reason: "missing" });
    for (const bad of ["javascript:alert(1)", "/login", "http://app.example.com", "https://u:p@app.example.com"]) expect(ssoEntry(bad)).toEqual({ kind: "unconfigured", reason: "invalid" });
  });
  it("never points the demo back at itself (redirect loop)", () => {
    expect(ssoEntry("https://bahn-project-manager.vercel.app", "https://bahn-project-manager.vercel.app")).toEqual({ kind: "unconfigured", reason: "self" });
  });
});
