/**
 * Runs the real acceptance script as a subprocess against a local key server, so the wiring (not just the helpers) is covered:
 * a Microsoft-looking issuer whose tokens are verified against a custom OIDC_JWKS_URI must never be labelled `real-entra`.
 * The accept path (Microsoft's own key endpoint) needs the network and a tenant, so it is covered by decideVerdict's unit test only.
 */
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

const ISS = "https://login.microsoftonline.com/tid-1/v2.0", AUD = "api://bahn-cli-test";
let server: Server;
let jwksUri: string;
let app: Server;
let appUrl: string;
let appDepartments: string[];
const tokens: Record<string, string> = {};
const tok = (name: string): string => tokens[name] ?? "";
const SECRET_NAME = "Erika Muster";
const SECRET_MAIL = "erika.muster@bahn.example";
const SECRET_OID = "oid-secret-0001";
interface Report { verdict: string; keySource: string; personas: Array<{ status: string; problems: string[] }>; checks: Array<{ status: string }> }

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k", alg: "RS256", use: "sig" };
  server = createServer((_q, r) => { r.setHeader("content-type", "application/json"); r.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise<void>(res => server.listen(0, "127.0.0.1", res));
  jwksUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/jwks`;
  // a stand-in for the deployed server's auth.session: it knows the four test tokens, answers null for anyone else
  const answers: Record<string, unknown> = {};
  app = createServer((q, r) => {
    const t = (q.headers.authorization ?? "").replace(/^Bearer /, "");
    const a = answers[t];
    r.setHeader("content-type", "application/json");
    r.end(JSON.stringify({ result: { data: { json: a ?? null } } }));
  });
  await new Promise<void>(res => app.listen(0, "127.0.0.1", res));
  appUrl = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  const mint = (roles: string[]) => new SignJWT({ tid: "tid-1", oid: SECRET_OID, name: SECRET_NAME, preferred_username: SECRET_MAIL, roles })
    .setProtectedHeader({ alg: "RS256", kid: "k" }).setIssuer(ISS).setAudience(AUD).setIssuedAt().setExpirationTime("1h").sign(privateKey);
  tokens.admin = await mint(["admin", "Workspace.ALL"]);
  tokens.editor = await mint(["editor", "Workspace.Kassel", "Department.ITK"]);
  tokens.editorNoDept = await mint(["editor", "Workspace.Kassel"]);
  tokens.viewer = await mint(["viewer", "Workspace.Kassel"]);
  tokens.nogrant = await mint(["viewer"]);
  answers[tokens.admin] = { role: "admin", workspaces: "ALL", get departments() { return []; } };
  answers[tokens.editor] = { role: "editor", workspaces: ["Kassel"], get departments() { return appDepartments; } };
  answers[tokens.viewer] = { role: "viewer", workspaces: ["Kassel"], departments: [] };
  answers[tokens.nogrant] = { role: "viewer", workspaces: [], departments: [] };
});
beforeEach(() => { appDepartments = ["ITK"]; });
afterAll(() => { server?.close(); app?.close(); });

// async on purpose: the key server lives in THIS process, so the event loop must stay free while the script fetches from it
function run(env: Record<string, string>): Promise<{ code: number | null; out: string; report: Report }> {
  return new Promise(resolve => {
    const child = spawn("pnpm", ["exec", "tsx", "scripts/gate/entra-acceptance.ts"], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", OIDC_ISSUER: ISS, OIDC_AUDIENCE: AUD, ENTRA_TOKEN_ADMIN: tok("admin"), ENTRA_TOKEN_EDITOR: tok("editor"), ENTRA_TOKEN_VIEWER: tok("viewer"), ENTRA_TOKEN_NOGRANT: tok("nogrant"), ...env },
    });
    let out = "";
    child.stdout.on("data", d => { out += d; });
    child.on("close", code => resolve({ code, out, report: out ? JSON.parse(out) : null }));
  });
}

describe("entra-acceptance script (subprocess)", () => {
  it("a Microsoft issuer over a custom OIDC_JWKS_URI verifies the tokens but is never real-entra — with or without the allow flag", async () => {
    const strict = await run({ OIDC_JWKS_URI: jwksUri });
    expect(strict.report.personas.map(p => p.status)).toEqual(["pass", "pass", "pass", "pass"]);
    expect(strict.report.verdict).toBe("selftest-not-entra");
    expect(strict.report.keySource).toMatch(/NOT Microsoft's/);
    expect(strict.code).toBe(1);
    const allowed = await run({ OIDC_JWKS_URI: jwksUri, ENTRA_ACCEPTANCE_ALLOW_NON_ENTRA: "1" });
    expect(allowed.report.verdict).toBe("selftest-not-entra");
    expect(allowed.code).toBe(0);
  }, 90_000);

  it("a missing department grant fails the run; the report carries no token, name, e-mail or object id", async () => {
    const r = await run({ OIDC_JWKS_URI: jwksUri, ENTRA_ACCEPTANCE_ALLOW_NON_ENTRA: "1", ENTRA_TOKEN_EDITOR: tok("editorNoDept") });
    expect(r.code).toBe(1);
    expect(r.report.verdict).toBe("fail");
    expect(r.report.personas[1].problems.join()).toMatch(/missing department grant\(s\) \["ITK"\]/);
    for (const secret of [...Object.values(tokens), SECRET_NAME, SECRET_MAIL, SECRET_OID]) expect(r.out).not.toContain(secret);
  }, 90_000);

  it("the deployed server agrees: pass; it derives other departments than local verification: fail (order does not matter)", async () => {
    const env = { OIDC_JWKS_URI: jwksUri, ENTRA_ACCEPTANCE_ALLOW_NON_ENTRA: "1", ENTRA_ACCEPTANCE_URL: appUrl };
    const agree = await run(env);
    expect(agree.code).toBe(0);
    expect(agree.report.checks.map(c => c.status)).toEqual(["pass", "pass"]);
    appDepartments = ["EEA"];
    const differ = await run(env);
    expect(differ.code).toBe(1);
    expect(differ.report.personas[1].problems.join()).toMatch(/departments: deployed server says \["EEA"\], local verification says \["ITK"\]/);
    appDepartments = [];
    expect((await run(env)).report.personas[1].problems.join()).toMatch(/departments: deployed server says \[\]/);
  }, 90_000);

  it("no tokens at all is not-run (exit 2), never a pass", async () => {
    const r = await run({ OIDC_JWKS_URI: jwksUri, ENTRA_TOKEN_ADMIN: "", ENTRA_TOKEN_EDITOR: "", ENTRA_TOKEN_VIEWER: "", ENTRA_TOKEN_NOGRANT: "" });
    expect(r.code).toBe(2);
    expect(r.report.verdict).toBe("not-run");
  }, 90_000);
});
