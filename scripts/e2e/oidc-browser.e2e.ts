/**
 * Real browser sign-in proof: Authorization Code + PKCE through the actual Login page, against a mock
 * OIDC authority (discovery, /authorize, /token with a REAL PKCE check, JWKS) and the production server
 * bundle with real DB + Redis. This proves the client/server auth contract; it is NOT a proof against
 * Microsoft Entra (no tenant is available) — that remains an external prerequisite (docs/staging.md).
 *
 *   OUT=dist-oidc VITE_SERVER_MODE=1 VITE_OIDC_AUTHORITY=http://127.0.0.1:3290/ VITE_OIDC_CLIENT_ID=bahn-spa \
 *     VITE_OIDC_SCOPE="openid profile" scripts/e2e/build-server-mode.sh
 *   E2E_DB_BASE=mysql://root:pw@127.0.0.1:3390 tsx scripts/e2e/oidc-browser.e2e.ts
 * Writes artifacts/e2e-oidc-browser.json.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import mysql from "mysql2/promise";

const DB_BASE = process.env.E2E_DB_BASE ?? "mysql://bahn:bahn@127.0.0.1:3306", DB_NAME = "bahn_e2e_oidc";
const REDIS = process.env.E2E_REDIS ?? "redis://127.0.0.1:6390";
const IDP_PORT = 3290, APP_PORT = 3291, ISS = `http://127.0.0.1:${IDP_PORT}/`, AUD = "bahn-oidc-e2e", APP = `http://127.0.0.1:${APP_PORT}`;
const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
const step = async (name: string, fn: () => Promise<void>) => {
  try { await fn(); results.push({ name, ok: true }); console.log(`  ok   ${name}`); }
  catch (e) { results.push({ name, ok: false, detail: String(e) }); console.log(`  FAIL ${name}\n       ${e}`); }
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./;

const admin = await mysql.createConnection(DB_BASE);
await admin.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
await admin.query(`CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await admin.end();
const mg = await mysql.createConnection(`${DB_BASE}/${DB_NAME}`);
for (const f of readdirSync("drizzle").filter(f => /^\d{4}_.*\.sql$/.test(f)).sort())
  for (const s of readFileSync(path.join("drizzle", f), "utf8").split("--> statement-breakpoint")) if (s.trim()) await mg.query(s);
await mg.end();
await new Promise<void>((res, rej) => { const p = spawn("pnpm", ["exec", "tsx", "scripts/e2e/seed-real.ts", `${DB_BASE}/${DB_NAME}`], { stdio: "inherit" }); p.on("exit", c => (c === 0 ? res() : rej(new Error("seed failed")))); });

// ---- mock authority ------------------------------------------------------------------------
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
type Who = { oid: string; name: string; roles: string[]; workspaces?: string[] };
let nextIdentity: Who = { oid: "anna", name: "Anna", roles: ["editor"], workspaces: ["ALL"] };
const codes = new Map<string, { challenge: string; who: Who; redirect: string }>();
let tokenRequests = 0;
const sign = (w: Who, exp: string) => new SignJWT({ tid: "t", oid: w.oid, name: w.name, preferred_username: `${w.oid}@idp.test`, roles: w.roles, ...(w.workspaces ? { workspaces: w.workspaces } : {}) })
  .setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(ISS).setAudience(AUD).setIssuedAt().setExpirationTime(exp).sign(privateKey);
const idp = createServer(async (req, res) => {
  const u = new URL(req.url!, ISS);
  res.setHeader("access-control-allow-origin", APP); res.setHeader("access-control-allow-headers", "content-type");
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
  if (u.pathname === "/.well-known/openid-configuration") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ issuer: ISS, authorization_endpoint: `${ISS}authorize`, token_endpoint: `${ISS}token`, end_session_endpoint: `${ISS}logout`, jwks_uri: `${ISS}jwks` })); return; }
  if (u.pathname === "/jwks") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ keys: [jwk] })); return; }
  if (u.pathname === "/authorize") {
    if (u.searchParams.get("code_challenge_method") !== "S256" || u.searchParams.get("response_type") !== "code") { res.writeHead(400).end("bad request"); return; }
    const code = `c${codes.size}-${Math.random().toString(36).slice(2)}`;
    codes.set(code, { challenge: u.searchParams.get("code_challenge")!, who: nextIdentity, redirect: u.searchParams.get("redirect_uri")! });
    res.writeHead(302, { location: `${u.searchParams.get("redirect_uri")}?code=${code}&state=${u.searchParams.get("state")}` }).end(); return;
  }
  if (u.pathname === "/token") {
    tokenRequests++;
    let body = ""; for await (const c of req) body += c;
    const f = new URLSearchParams(body), e = codes.get(f.get("code") ?? "");
    codes.delete(f.get("code") ?? ""); // single use
    res.setHeader("content-type", "application/json");
    const ok = e && f.get("redirect_uri") === e.redirect && createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url") === e.challenge && !f.get("client_secret");
    if (!ok) { res.writeHead(400).end(JSON.stringify({ error: "invalid_grant" })); return; }
    res.end(JSON.stringify({ access_token: await sign(e!.who, "1h"), token_type: "Bearer", expires_in: 3600 })); return;
  }
  if (u.pathname === "/logout") { res.writeHead(302, { location: u.searchParams.get("post_logout_redirect_uri") ?? "/" }).end(); return; }
  res.writeHead(404).end();
});
await new Promise<void>(r => idp.listen(IDP_PORT, "127.0.0.1", r));

const srv: ChildProcess = spawn("node", [`${process.env.OUT ?? "dist-oidc"}/index.js`], {
  env: { ...process.env, NODE_ENV: "production", PORT: String(APP_PORT), DATABASE_URL: `${DB_BASE}/${DB_NAME}`, JWT_SECRET: "e2e-".padEnd(48, "x"), OIDC_ISSUER: ISS, OIDC_AUDIENCE: AUD, OIDC_JWKS_URI: `${ISS}jwks`, REDIS_URL: REDIS, METRICS_TOKEN: "e2e", DB_POOL_SIZE: "10" },
  stdio: ["ignore", "ignore", "pipe"],
});
srv.stderr!.on("data", d => process.env.E2E_VERBOSE && process.stderr.write(`[srv] ${d}`));
for (let i = 0; i < 100 && !(await fetch(`${APP}/api/ready`).then(r => r.ok).catch(() => false)); i++) await sleep(200);

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" : undefined), args: ["--no-sandbox"] });
async function session(who: Who) {
  nextIdentity = who;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.route(/tile\.openstreetmap\.org/, r => r.abort());
  const seen = { trpcAuth: [] as (string | undefined)[], sseAuth: [] as (string | undefined)[], dataJson: 0, trpcNoAuth: [] as string[] };
  page.on("request", r => {
    const u = r.url();
    if (/\/data\.json/.test(u)) seen.dataJson++;
    if (u.startsWith(`${APP}/api/trpc`)) { seen.trpcAuth.push(r.headers().authorization); if (!r.headers().authorization) seen.trpcNoAuth.push(u.slice(APP.length, APP.length + 80)); }
    if (u.includes("/api/realtime/stream")) seen.sseAuth.push(r.headers().authorization);
  });
  return { ctx, page, seen };
}
const storage = (page: import("playwright").Page) => page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));

console.log("\n== real browser OIDC sign-in (mock authority) ==");
let A: Awaited<ReturnType<typeof session>>;

await step("unauthenticated visit: bounced to /login, no data requested, no token anywhere", async () => {
  A = await session({ oid: "anna", name: "Anna", roles: ["editor"], workspaces: ["ALL"] });
  await A.page.goto(`${APP}/projects`);
  await A.page.waitForURL(/\/login/, { timeout: 10000 });
  await A.page.getByRole("button", { name: /Mit Microsoft anmelden/ }).waitFor();
  if (await A.page.getByLabel("Passwort").count()) throw new Error("password form present in SSO mode");
  if (await A.page.getByText(/demo/i).count()) throw new Error("demo affordance visible in SSO mode");
  const s = await storage(A.page);
  if (JSON.stringify(s).match(JWT_RE)) throw new Error("token in storage before sign-in");
  if (A.seen.trpcAuth.some(x => x)) throw new Error("bearer sent before sign-in");
});

await step("sign-in via the IdP: PKCE code exchange, lands signed in on the Projects page with rows", async () => {
  await A.page.getByRole("button", { name: /Mit Microsoft anmelden/ }).click();
  await A.page.waitForURL(u => u.origin === APP && !/\/(login|auth)/.test(u.pathname), { timeout: 15000 })
    .catch(async e => { throw new Error(`${e.message.split("\n")[0]} — stuck at ${A.page.url()}: ${(await A.page.locator("body").innerText()).slice(0, 200)}`); });
  await A.page.goto(`${APP}/projects`);
  await A.page.locator("tbody tr").first().waitFor({ timeout: 15000 });
  if (tokenRequests !== 1) throw new Error(`expected exactly 1 token request, got ${tokenRequests}`);
  // requests made BEFORE sign-in (the anonymous auth.session probe) legitimately carry no bearer: audit only what follows
  A.seen.trpcAuth.length = 0; A.seen.trpcNoAuth.length = 0; A.seen.sseAuth.length = 0;
  await A.page.reload();
  await A.page.locator("tbody tr").first().waitFor({ timeout: 15000 });
});

await step("storage audit: access token only in sessionStorage; localStorage holds no token, no refresh/id token", async () => {
  const s = await storage(A.page);
  if (JSON.stringify(s.local).match(JWT_RE)) throw new Error("JWT found in localStorage");
  if (!JWT_RE.test(s.session["bahn.access_token"] ?? "")) throw new Error("no access token in sessionStorage");
  if (Object.keys({ ...s.local, ...s.session }).some(k => /refresh|id_token/i.test(k))) throw new Error("refresh/id token stored");
  if (s.session["bahn.oidc_flow"]) throw new Error("PKCE flow state left behind");
  const cookies = await A.ctx.cookies();
  if (cookies.some(c => /session|token/i.test(c.name))) throw new Error(`auth cookie set: ${cookies.map(c => c.name)}`);
});

await step("access token rides on tRPC and the SSE stream; /data.json is never fetched", async () => {
  for (let i = 0; i < 50 && !A.seen.sseAuth.length; i++) await sleep(200);
  if (!A.seen.sseAuth.length || A.seen.sseAuth.some(a => !a?.startsWith("Bearer eyJ"))) throw new Error(`SSE auth: ${JSON.stringify(A.seen.sseAuth)}`);
  if (!A.seen.trpcAuth.length || A.seen.trpcNoAuth.length) throw new Error(`tRPC requests without bearer: ${A.seen.trpcNoAuth.join(", ")}`);
  if (A.seen.dataJson) throw new Error("/data.json requested");
  await A.page.locator('[data-testid="connection-badge"]').first().waitFor();
});

await step("reload keeps the tab signed in without a second IdP round trip", async () => {
  await A.page.reload();
  await A.page.locator("tbody tr").first().waitFor({ timeout: 15000 });
  if (tokenRequests !== 1) throw new Error(`unexpected extra token request (${tokenRequests})`);
});

await step("logout clears client auth state, reaches the IdP end-session, and protected routes bounce again", async () => {
  await A.page.getByText("Abmelden").first().click();
  await A.page.waitForURL(/\/login/, { timeout: 10000 });
  const s = await storage(A.page);
  if (JSON.stringify(s).match(JWT_RE) || s.session["bahn.access_token"]) throw new Error("token survived logout");
  await A.page.goto(`${APP}/projects`);
  await A.page.waitForURL(/\/login/, { timeout: 10000 });
  const r = await fetch(`${APP}/api/trpc/projects.list?input=${encodeURIComponent(JSON.stringify({ json: { limit: 5 } }))}`);
  if (r.status !== 401) throw new Error(`anonymous API -> ${r.status}`);
});

await step("forged / tampered / wrong-audience / expired tokens are refused by the server with 401", async () => {
  const good = await sign({ oid: "x", name: "x", roles: ["editor"], workspaces: ["ALL"] }, "1h");
  const expired = await new SignJWT({ tid: "t", oid: "x", roles: ["editor"], workspaces: ["ALL"] }).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(ISS).setAudience(AUD).setIssuedAt(1).setExpirationTime(2).sign(privateKey);
  const wrongAud = await new SignJWT({ tid: "t", oid: "x", roles: ["editor"], workspaces: ["ALL"] }).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(ISS).setAudience("someone-else").setIssuedAt().setExpirationTime("1h").sign(privateKey);
  const other = await generateKeyPair("RS256");
  const forged = await new SignJWT({ tid: "t", oid: "x", roles: ["admin"], workspaces: ["ALL"] }).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(ISS).setAudience(AUD).setIssuedAt().setExpirationTime("1h").sign(other.privateKey);
  const tampered = good.replace(/\.[^.]+\./, `.${Buffer.from(JSON.stringify({ oid: "x", roles: ["admin"], workspaces: ["ALL"] })).toString("base64url")}.`);
  const call = async (t: string) => (await fetch(`${APP}/api/trpc/projects.list?input=${encodeURIComponent(JSON.stringify({ json: { limit: 1 } }))}`, { headers: { authorization: `Bearer ${t}` } })).status;
  const got = { good: await call(good), expired: await call(expired), wrongAud: await call(wrongAud), forged: await call(forged), tampered: await call(tampered) };
  if (got.good !== 200 || [got.expired, got.wrongAud, got.forged, got.tampered].some(s => s !== 401)) throw new Error(JSON.stringify(got));
});

await step("authorization is not loosened by sign-in: no claim = no data; Frankfurt claim = Frankfurt only; unknown role stays viewer", async () => {
  const cases: Array<[string, Who, (r: any) => boolean]> = [
    ["no workspace claim", { oid: "n1", name: "N", roles: ["editor"] }, r => r.items.length === 0],
    ["Frankfurt only", { oid: "f1", name: "F", roles: ["editor"], workspaces: ["Frankfurt"] }, r => r.items.length > 0 && r.items.every((p: any) => p.bahnhofsmanagement === "Frankfurt")],
    ["'*' is not ALL", { oid: "s1", name: "S", roles: ["editor"], workspaces: ["*"] }, r => r.items.length === 0],
    ["unknown role", { oid: "u1", name: "U", roles: ["superuser", "root"], workspaces: ["Frankfurt"] }, () => true],
  ];
  for (const [label, who, check] of cases) {
    const t = await sign(who, "1h");
    const H = { authorization: `Bearer ${t}` };
    const s: any = (await (await fetch(`${APP}/api/trpc/auth.session`, { headers: H })).json()).result.data.json;
    const l: any = (await (await fetch(`${APP}/api/trpc/projects.list?input=${encodeURIComponent(JSON.stringify({ json: { limit: 100, expand: [] } }))}`, { headers: H })).json()).result.data.json;
    if (!check(l)) throw new Error(`${label}: ${JSON.stringify(l.items.length)} items`);
    if (label === "unknown role" && s.role !== "viewer") throw new Error(`unknown role elevated to ${s.role}`);
    if (who.workspaces?.[0] === "*" && JSON.stringify(s.workspaces) === '"ALL"') throw new Error("'*' granted ALL");
  }
});

await step("a user signed in as a restricted principal sees only their workspace through the real UI", async () => {
  const B = await session({ oid: "bernd", name: "Bernd", roles: ["editor"], workspaces: ["Frankfurt"] });
  await B.page.goto(`${APP}/login`);
  await B.page.getByRole("button", { name: /Mit Microsoft anmelden/ }).click();
  await B.page.waitForURL(u => u.origin === APP && !/\/(login|auth)/.test(u.pathname), { timeout: 15000 });
  await B.page.goto(`${APP}/projects`);
  await B.page.locator("tbody tr").first().waitFor({ timeout: 15000 });
  const tok = (await storage(B.page)).session["bahn.access_token"];
  const l: any = (await (await fetch(`${APP}/api/trpc/projects.list?input=${encodeURIComponent(JSON.stringify({ json: { limit: 100, expand: [] } }))}`, { headers: { authorization: `Bearer ${tok}` } })).json()).result.data.json;
  if (!l.items.length || l.items.some((p: any) => p.bahnhofsmanagement !== "Frankfurt")) throw new Error("workspace leak");
  await B.ctx.close();
});

await step("legacy snapshot is not a side door: /data.json and /schedule.json are 401 anonymous, 403 workspace-restricted, 200 only for all-workspace principals", async () => {
  if (existsSync(`${process.env.OUT ?? "dist-oidc"}/public/data.json`)) throw new Error("data.json is still in the public directory");
  const get = async (f: string, who?: Who) => { const r = await fetch(`${APP}/${f}`, { headers: who ? { authorization: `Bearer ${await sign(who, "1h")}` } : {} }); return { status: r.status, ct: r.headers.get("content-type") ?? "", len: Number(r.headers.get("content-length") ?? 0), text: r.status === 200 ? "" : await r.text() }; };
  for (const f of ["data.json", "schedule.json"]) {
    const anon = await get(f), fr = await get(f, { oid: "f2", name: "F", roles: ["editor"], workspaces: ["Frankfurt"] }), none = await get(f, { oid: "n2", name: "N", roles: ["editor"] }), all = await get(f, { oid: "a2", name: "A", roles: ["editor"], workspaces: ["ALL"] });
    if (anon.status !== 401 || fr.status !== 403 || none.status !== 403 || all.status !== 200 || !all.ct.includes("json")) throw new Error(`${f}: ${JSON.stringify({ anon: anon.status, fr: fr.status, none: none.status, all: all.status, ct: all.ct })}`);
    if (/projektnummer|Koblenz/.test(anon.text + fr.text + none.text)) throw new Error(`${f} content leaked in an error body`);
  }
});

await browser.close(); idp.close(); srv.kill("SIGTERM");
const failed = results.filter(r => !r.ok);
mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/e2e-oidc-browser.json", JSON.stringify({ suite: "oidc-browser", authority: "mock (local) — NOT Microsoft Entra", at: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
