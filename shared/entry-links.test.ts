import { describe, expect, it } from "vitest";
import { entryLink } from "./entry-links";

describe("entryLink", () => {
  it("accepts https and local http, nothing else", () => {
    expect(entryLink("https://demo.example.com/")).toBe("https://demo.example.com/");
    expect(entryLink(" https://demo.example.com/app ")).toBe("https://demo.example.com/app");
    expect(entryLink("http://localhost:5173/")).toBe("http://localhost:5173/");
    for (const bad of ["", undefined, null, "javascript:alert(1)", "//evil.example", "/login", "ftp://x.example", "http://demo.example.com", "https://user:pw@demo.example.com", "not a url", "data:text/html,x"]) expect(entryLink(bad as never)).toBeNull();
  });
});
