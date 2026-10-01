import { describe, expect, it } from "vitest";
import { buildCsp } from "./security";

describe("CSP", () => {
  it("is same-origin only without an IdP", () => {
    expect(buildCsp({} as NodeJS.ProcessEnv)).toContain("connect-src 'self';");
  });
  it("admits exactly the IdP origin for the browser token exchange, never scripts or wildcards", () => {
    const c = buildCsp({ OIDC_ISSUER: "https://login.microsoftonline.com/tenant/v2.0" } as unknown as NodeJS.ProcessEnv);
    expect(c).toContain("connect-src 'self' https://login.microsoftonline.com;");
    expect(c).toContain("script-src 'self';");
    expect(c).not.toMatch(/connect-src[^;]*\*/);
  });
  it("ignores a malformed extra origin instead of widening the policy", () => {
    expect(buildCsp({ CSP_CONNECT_EXTRA: "not a url *" } as unknown as NodeJS.ProcessEnv)).toContain("connect-src 'self';");
  });
});
