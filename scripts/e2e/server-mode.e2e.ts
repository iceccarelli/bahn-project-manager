/**
 * Server-mode browser proof. Two real Chromium contexts against two real server
 * instances (built bundle, real MariaDB/MySQL, real Redis), authenticated with
 * OIDC bearer tokens verified by the server against a local test IdP.
 *
 *   scripts/e2e/build-server-mode.sh && tsx scripts/e2e/server-mode.e2e.ts
 *
 * Every "B sees it" below is asserted on B's rendered DOM with no reload
 * (a window marker set before the change must still exist after it).
 * Writes artifacts/e2e-server-mode.json (machine-readable, used by the deployment gate).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import mysql from "mysql2/promise";

const DB_BASE = process.env.E2E_DB_BASE ?? "mysql://bahn:bahn@127.0.0.1:3306";
const DB_NAME = "bahn_e2e";
const REDIS = process.env.E2E_REDIS ?? "redis://127.0.0.1:6390";
const PORTS = [3200, 3201];
const PID = 481, PNR = "G.011570020";
const results: Array<{ name: string; ok: boolean; ms: number; detail?: string }> = [];
const measurements: Record<string, number | string> = {};
const children: ChildProcess[] = [];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | false | null | undefined> | T | false | null | undefined, ms = 8000, what = "condition"): Promise<T> {
  const t0 = Date.now();
  let last: unknown;
  while (Date.now() - t0 < ms) {
    try { const v = await fn(); if (v) return v as T; } catch (e) { last = e; }
    await sleep(40);
  }
  throw new Error(`timeout (${ms} ms) waiting for ${what}${last ? `: ${String(last)}` : ""}`);
}
async function step(name: string, fn: () => Promise<void>) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`  ok   ${name}`); }
  catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, detail: String(e) }); console.log(`  FAIL ${name}\n       ${String(e)}`); }
}

async function prepareDb() {
  const admin = await mysql.createConnection(DB_BASE);
  await admin.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
  await admin.query(`CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.end();
  const db = await mysql.createConnection(`${DB_BASE}/${DB_NAME}`);
  for (const f of readdirSync("drizzle").filter(f => /^\d{4}_.*\.sql$/.test(f)).sort())
    for (const stmt of readFileSync(path.join("drizzle", f), "utf8").split("--> statement-breakpoint")) if (stmt.trim()) await db.query(stmt);
  await db.end();
  await new Promise<void>((res, rej) => {
    const p = spawn("pnpm", ["exec", "tsx", "scripts/e2e/seed-real.ts", `${DB_BASE}/${DB_NAME}`], { stdio: "inherit" });
    p.on("exit", c => (c === 0 ? res() : rej(new Error("seed failed"))));
  });
}

async function main() {
  mkdirSync("artifacts", { recursive: true });
  await prepareDb();

  // ---- test IdP (JWKS) + tokens ----------------------------------------------------------
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "e2e", alg: "RS256", use: "sig" };
  const idp = createServer((_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise<void>(r => idp.listen(0, "127.0.0.1", r));
  const idpPort = (idp.address() as { port: number }).port;
  const ISS = `http://127.0.0.1:${idpPort}/`, AUD = "bahn-e2e";
  const mint = (oid: string, name: string, roles: string[], workspaces?: string[], departments?: string[]) =>
    new SignJWT({ tid: "t-e2e", oid, name, preferred_username: `${oid}@e2e.test`, roles, ...(workspaces ? { workspaces } : {}), ...(departments ? { departments } : {}) })
      .setProtectedHeader({ alg: "RS256", kid: "e2e" }).setIssuer(ISS).setAudience(AUD).setIssuedAt().setExpirationTime("2h").sign(privateKey);
  const tokenA = await mint("anna", "Anna (Browser A)", ["editor"], ["ALL"], ["ITK"]);
  const tokenB = await mint("bernd", "Bernd (Browser B)", ["editor"], ["Frankfurt"]);
  const tokenNoClaims = await mint("nobody", "Nobody", []);

  // ---- two server instances sharing DB + Redis -------------------------------------------
  for (const port of PORTS) {
    const p = spawn("node", ["dist-e2e/index.js"], {
      env: { ...process.env, NODE_ENV: "production", PORT: String(port), DATABASE_URL: `${DB_BASE}/${DB_NAME}`, JWT_SECRET: "e2e-".padEnd(48, "x"),
        OIDC_ISSUER: ISS, OIDC_AUDIENCE: AUD, OIDC_JWKS_URI: `${ISS}jwks`, REDIS_URL: REDIS, METRICS_TOKEN: "e2e", DB_POOL_SIZE: "10" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    p.stderr!.on("data", d => process.env.E2E_VERBOSE && process.stderr.write(`[srv${port}] ${d}`));
    children.push(p);
  }
  for (const port of PORTS) await until(async () => (await fetch(`http://127.0.0.1:${port}/api/ready`).catch(() => null))?.ok, 20000, `server ${port} ready`);
  const URLS = PORTS.map(p => `http://127.0.0.1:${p}`);

  const db = await mysql.createPool({ uri: `${DB_BASE}/${DB_NAME}`, timezone: "Z", connectionLimit: 4 });
  const q = async <T = any>(sql: string, args: unknown[] = []) => (await db.query(sql, args))[0] as T[];
  const api = async (base: string, token: string, proc: string, input: unknown, method: "GET" | "POST" = "POST") => {
    const r = await fetch(method === "GET" ? `${base}/api/trpc/${proc}?input=${encodeURIComponent(JSON.stringify({ json: input }))}` : `${base}/api/trpc/${proc}`,
      { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify({ json: input }) } : {}) });
    const j: any = await r.json();
    return { status: r.status, data: j.result?.data?.json, error: j.error?.json };
  };
  let n = 0;
  const key = () => `e2e-${Date.now()}-${n++}-${Math.random().toString(36).slice(2)}`;
  const ver = async (id: number) => (await q("SELECT syncVersion v FROM projects WHERE id=?", [id]))[0]?.v as number;
  const apiUpdate = (token: string, id: number, changes: Record<string, string | null>, expectedVersion?: number) =>
    ver(id).then(v => api(URLS[0]!, token, "projects.update", { id, expectedVersion: expectedVersion ?? v, changes, idempotencyKey: key() }));

  // ---- browsers --------------------------------------------------------------------------
  const browser: Browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" : undefined), args: ["--no-sandbox"] });
  const init = (token: string) => `
    try { sessionStorage.setItem("bahn.access_token", ${JSON.stringify(token)}); } catch (e) {}
    window.__noReload = true; window.__sse = []; window.__streamUrls = [];
    const of = window.fetch.bind(window);
    window.fetch = async (...a) => {
      const r = await of(...a);
      const u = String(a[0] && a[0].url ? a[0].url : a[0]);
      if (u.includes("/api/realtime/stream")) (window.__streamUrls = window.__streamUrls || []).push(decodeURIComponent(u));
      if (u.includes("/api/realtime/stream") && r.body) {
        const [x, y] = r.body.tee();
        (async () => { const rd = y.getReader(), td = new TextDecoder(); for (;;) { const c = await rd.read(); if (c.done) break; window.__sse.push(td.decode(c.value)); } })();
        return new Response(x, { status: r.status, headers: r.headers });
      }
      return r;
    };`;
  const openBrowser = async (base: string, token: string, name: string) => {
    const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1500, height: 900 } });
    await ctx.addInitScript(init(token));
    const page = await ctx.newPage();
    page.on("pageerror", e => console.log(`   [${name} pageerror] ${e.message}`));
    page.on("console", m => { if (m.type() === "error" && !/tile\.openstreetmap|ERR_|Failed to load resource/.test(m.text())) console.log(`   [${name} console.error] ${m.text().slice(0, 200)}`); });
    await page.route(/tile\.openstreetmap\.org/, r => r.abort());
    if (process.env.E2E_NET) {
      const t0 = Date.now();
      page.on("request", r => /realtime|trpc/.test(r.url()) && console.log(`   [${name} +${Date.now() - t0}ms] -> ${r.url().slice(-70)}`));
      page.on("requestfailed", r => /realtime|trpc/.test(r.url()) && console.log(`   [${name} +${Date.now() - t0}ms] xx ${r.failure()?.errorText} ${r.url().slice(-50)}`));
      page.on("response", r => /realtime|trpc/.test(r.url()) && console.log(`   [${name} +${Date.now() - t0}ms] <- ${r.status()} ${r.url().slice(-50)}`));
    }
    await page.goto(`${base}/projects`);
    return { ctx, page };
  };
  const row = (page: Page, nr = PNR) => page.locator("tbody tr", { hasText: nr }).first();
  const cell = (page: Page, label: string, nr = PNR) => row(page, nr).locator(`button[aria-label^="${label} von Projekt"], input[aria-label^="${label} von Projekt"]`).first();
  const cellText = async (page: Page, label: string, nr = PNR) => ((await cell(page, label, nr).textContent({ timeout: 1000 }).catch(() => null)) ?? "").trim();
  const search = async (page: Page, term: string) => { const i = page.locator("#projects-search"); await i.fill(term); await i.press("Enter"); await sleep(400); };
  const editCell = async (page: Page, label: string, value: string, nr = PNR) => {
    await cell(page, label, nr).click();
    const input = page.getByLabel(new RegExp(`^${label} von Projekt .* bearbeiten`)).first();
    await input.fill(value); await input.press("Enter");
  };
  const noReload = (page: Page) => page.evaluate(() => (window as any).__noReload === true);
  /** the table is virtualized: the DOM holds the window around the viewport; the set size is on the table itself */
  const rowSet = (page: Page) => page.evaluate(() => Number(document.querySelector("table[data-row-count]")?.getAttribute("data-row-count") ?? 0));
  const scrollRows = async (page: Page, index: number) => { const top = await page.evaluate(i => { const c = document.querySelector('[data-testid="projects-scroll"]'); if (!c) return -1; c.scrollTop = Math.max(0, i * 56 - 100); c.dispatchEvent(new Event("scroll")); return c.scrollTop; }, index); await sleep(350); return top; };
  const ids = async (page: Page) => (await page.locator("tbody tr td:first-child").allTextContents()).map(t => Number(t.trim())).filter(Boolean);
  const badge = (page: Page) => page.locator('[data-testid="connection-badge"]').first().textContent().then(t => (t ?? "").trim());

  console.log("\n== server-mode browser proof ==");
  let A!: { ctx: BrowserContext; page: Page }, B!: { ctx: BrowserContext; page: Page };

  await step("setup: project 481 (Koblenz) is moved into Frankfurt by A's account, so Frankfurt-only B may see it", async () => {
    const r = await apiUpdate(tokenA, PID, { bahnhofsmanagement: "Frankfurt" });
    if (r.status !== 200) throw new Error(JSON.stringify(r.error));
    measurements.startVersion = await ver(PID);
  });

  await step("auth: server-verified identities — no token = login page; no claims = no workspace access; B sees only Frankfurt", async () => {
    const anon = await api(URLS[0]!, "", "projects.list", { limit: 5 }, "GET");
    if (anon.status !== 401) throw new Error(`anonymous list -> ${anon.status}`);
    const none = await api(URLS[0]!, tokenNoClaims, "projects.list", { limit: 5, expand: [] }, "GET");
    if (none.status !== 200 || none.data.items.length !== 0) throw new Error("token without workspace claim must see 0 projects");
    const sB = await api(URLS[1]!, tokenB, "auth.session", undefined, "GET");
    if (sB.data.role !== "editor" || JSON.stringify(sB.data.workspaces) !== '["Frankfurt"]') throw new Error(JSON.stringify(sB.data));
    const listB = await api(URLS[1]!, tokenB, "projects.list", { limit: 100, expand: [] }, "GET");
    if (listB.data.items.some((p: any) => p.bahnhofsmanagement !== "Frankfurt")) throw new Error("B saw a non-Frankfurt project");
  });

  await step("both browsers open the real Projekte page (server pages, no data.json, no whole-dataset download)", async () => {
    A = await openBrowser(URLS[0]!, tokenA, "A");
    B = await openBrowser(URLS[1]!, tokenB, "B");
    const seenDataJson: string[] = [];
    for (const { page } of [A, B]) page.on("request", r => { if (/\/data\.json/.test(r.url())) seenDataJson.push(r.url()); });
    for (const { page } of [A, B]) {
      await search(page, "Kaisertreppe");
      await until(async () => (await row(page).count()) > 0, 15000, "row 481 visible");
    }
    await until(async () => /Live/.test(await badge(A.page)) && /Live/.test(await badge(B.page)), 10000, "both connections Live");
    // list payload size: the page is one cursor page, not the dataset
    const [aRows, bRows] = [await ids(A.page), await ids(B.page)];
    if (aRows.length > 100 || bRows.length > 100) throw new Error("more than one page rendered");
    if (seenDataJson.length) throw new Error(`/data.json was requested: ${seenDataJson.join(",")}`);
    const ls = await A.page.evaluate(() => Object.keys(localStorage).filter(k => /bahn_projects_v/.test(k)));
    if (ls.length) throw new Error(`local project store present: ${ls}`);
  });

  // ---------------- PROOF 1: A edits Projektstand, B sees it without reload ---------------------
  let vN = 0;
  await step("PROOF 1: A edits Projektstand of 481 → server commits N+1 → audit + outbox + relay → B's table changes, no reload", async () => {
    vN = await ver(PID);
    const before = await cellText(B.page, "Projektstand");
    const target = before === "EP" ? "FA" : "EP";
    const t0 = Date.now();
    await editCell(A.page, "Projektstand", target);
    await until(async () => (await cellText(B.page, "Projektstand")) === target, 5000, `B to show ${target}`);
    measurements["proof1_ms_click_to_B_dom"] = Date.now() - t0;
    if (!(await noReload(B.page)) || !(await noReload(A.page))) throw new Error("page reloaded");
    const v = await ver(PID);
    if (v !== vN + 1) throw new Error(`version ${v} != ${vN + 1}`);
    const [audit] = await q("SELECT userName,field,oldValue,newValue,aggregateVersion,eventId,traceId FROM audit_log WHERE entityId=? AND field='projektstand' ORDER BY id DESC LIMIT 1", [PID]);
    if (!audit || audit.aggregateVersion !== v || audit.newValue !== target || audit.oldValue !== before || !audit.traceId) throw new Error(`audit ${JSON.stringify(audit)}`);
    const [ev] = await q("SELECT aggregateVersion,processedAt,feedSeq FROM domain_events WHERE eventId=?", [audit.eventId]);
    if (!ev || ev.aggregateVersion !== v || !ev.processedAt || !ev.feedSeq) throw new Error(`outbox ${JSON.stringify(ev)}`);
    const sse = (await B.page.evaluate(() => (window as any).__sse.join(""))) as string;
    if (!sse.includes(audit.eventId)) throw new Error("B's stream never carried the event");
    measurements.audit_actor = audit.userName;
    vN = v;
  });

  // ---------------- item 2: create / delete propagation ------------------------------------------
  let createdId = 0;
  // ---------------- TOPOLOGY: fanout ≈ relevant recipients -------------------------------------------------
  await step("TOPOLOGY: B's global list subscribes to a collection channel + only the rows on screen; off-screen edits never reach B; scrolling subscribes new rows IN PLACE (no reconnect) and they go live", async () => {
    const streams = (page: Page) => page.evaluate(() => ((window as any).__streamUrls ?? []) as string[]);
    await search(B.page, ""); // the whole Frankfurt list (earlier steps left B on a one-row search)
    await until(async () => (await rowSet(B.page)) > 80, 10000, "B list with > 80 rows");
    const first = await streams(B.page);
    if (!first.length) throw new Error("no stream request seen");
    // what the server holds for B's stream = hello's scopes, then every `scopes` frame (in-place additions/removals)
    const held = async () => {
      const raw = (await B.page.evaluate(() => (window as any).__sse.join(""))) as string;
      let set = new Set<string>();
      for (const f of raw.split("\n\n")) {
        const ev = /event: (\w+)/.exec(f)?.[1], d = /data: (.*)/.exec(f)?.[1];
        if (!ev || !d) continue;
        try { const j = JSON.parse(d); if (ev === "hello") set = new Set(j.scopes); else if (ev === "scopes") { for (const x of j.accepted ?? []) set.add(x); for (const x of j.removed ?? []) set.delete(x); } } catch { /* partial */ }
      }
      return set;
    };
    await until(async () => [...(await held())].some(x => x.startsWith("project:")), 8000, "row channels added to the open stream");
    const sc = [...(await held())];
    if (sc.some(x => x.startsWith("workspace:"))) throw new Error(`still subscribed to workspace channels: ${sc.filter(x => x.startsWith("workspace:"))}`);
    if (!sc.includes("collection:frankfurt")) throw new Error(`no membership channel: ${sc.slice(0, 5)}`);
    const rowScopes = sc.filter(x => x.startsWith("project:")).length;
    if (rowScopes < 5 || rowScopes > 120) throw new Error(`${rowScopes} row channels for one screen of rows`);
    measurements.topology_initial_scopes = sc.length;
    // a Frankfurt project far below the first screen (B lists newest first)
    const list = await api(URLS[1]!, tokenB, "projects.list", { limit: 100, sort: "id", dir: "desc", expand: [] }, "GET");
    const far: number = list.data.items[70].id, near: number = list.data.items[2].id;
    const seenFor = (id: number) => B.page.evaluate(i => (window as any).__sse.join("").includes(`"aggregateId":"${i}"`), id);
    const mark = async () => (await B.page.evaluate(() => (window as any).__sse.length)) as number;
    await scrollRows(B.page, 0);
    const edit = await apiUpdate(tokenA, far, { kommentar: `offscreen-${Date.now()}` });
    if (edit.status !== 200) throw new Error(JSON.stringify(edit.error));
    await sleep(1200);
    if (await seenFor(far)) throw new Error("B received an event for a row that is not on its screen");
    // an on-screen row IS delivered
    const nearEdit = await apiUpdate(tokenA, near, { kommentar: `onscreen-${Date.now()}` });
    if (nearEdit.status !== 200) throw new Error(JSON.stringify(nearEdit.error));
    await until(async () => await seenFor(near), 6000, "event for an on-screen row");
    // scroll to the far row: its channel is added to the OPEN stream (scopes frame), no new stream request
    // scroll (as a user would) until the far row is rendered
    for (let i = 0; i < 60 && !(await ids(B.page)).includes(far); i++) { await B.page.evaluate(() => { const c = document.querySelector('[data-testid="projects-scroll"]'); if (c) { c.scrollTop += 500; c.dispatchEvent(new Event("scroll")); } }); await sleep(120); }
    if (!(await ids(B.page)).includes(far)) throw new Error("could not scroll the far row into view");
    await until(async () => (await held()).has(`project:${far}`), 8000, "scopes acknowledgement for the scrolled-in row");
    const afterScroll = await streams(B.page);
    if (afterScroll.length !== first.length) throw new Error(`the stream reconnected on scroll (${first.length} → ${afterScroll.length} requests)`);
    const before = await B.page.evaluate(() => (window as any).__sse.length) as number;
    const target = (await cellText(B.page, "Projektstand", list.data.items[70].projektnummer ?? "")) ;
    const up = await apiUpdate(tokenA, far, { projektstand: target === "FA" ? "EP" : "FA" });
    if (up.status !== 200) throw new Error(JSON.stringify(up.error));
    await until(async () => await seenFor(far), 6000, "event for the row after it was scrolled into view");
    measurements.topology_rows_subscribed_initially = rowScopes;
    void before; void mark;
    await scrollRows(B.page, 0);
  });

  // ---------------- DOMAIN UNIFICATION: PSV-ITK is a Gewerk view over the same aggregate ------------------------
  await step("PSV-ITK (server): the Gewerk page is the Project aggregate filtered to ITK — virtualized, read-model KPIs, and A's review edit reaches B live", async () => {
    const { page } = B;
    await page.goto(`${URLS[1]}/psv-itk`);
    await page.waitForSelector('[data-testid="server-department-view"]', { timeout: 15000 });
    await page.waitForSelector("table tbody tr td", { timeout: 15000 });
    const domRows = await page.$$eval("table tbody tr:not([aria-hidden])", r => r.length);
    const setSize = await rowSet(page);
    if (setSize <= 20 || domRows >= 80) throw new Error(`virtualization: ${domRows} DOM rows for a set of ${setSize}`);
    const kpi = await page.locator('[data-testid="server-department-view"] .text-4xl').first().innerText();
    if (!/\d/.test(kpi)) throw new Error(`KPI card shows "${kpi}" (read model not served)`);
    // B (Frankfurt-only) sees Frankfurt reviews only
    const sess = await api(URLS[1]!, tokenB, "dashboard.department", { department: "ITK" }, "GET");
    const all = await api(URLS[0]!, tokenA, "dashboard.department", { department: "ITK" }, "GET");
    if (!(sess.data.total > 0 && sess.data.total < all.data.total)) throw new Error(`department KPI scope: B ${sess.data.total} vs ALL ${all.data.total}`);
    if (sess.data.byWorkspace.some((w: any) => w.workspace !== "Frankfurt")) throw new Error("B's department aggregate contains another workspace");
    // live: filter to project 481 and watch the ITK status cell change when A edits it
    await page.locator("#dept-search").fill(PNR);
    await until(async () => (await rowSet(page)) === 1 && (await page.locator(`tbody tr button[aria-label^="Status ITK für Projekt"]`).count()) === 1, 10000, "exactly the ITK row of 481 (search by Projektnummer)");
    const cellNow = async () => ((await page.locator(`tbody tr button[aria-label^="Status ITK für Projekt"]`).first().textContent({ timeout: 1500 }).catch(() => null)) ?? "").trim();
    const before = await cellNow();
    const target = before === "in Bearbeitung" ? "prüffähig" : "in Bearbeitung";
    const v = await ver(PID);
    const r = await api(URLS[0]!, tokenA, "projects.updateReview", { projectId: PID, department: "ITK", expectedVersion: v, changes: { status: target }, idempotencyKey: key() });
    if (r.status !== 200) throw new Error(JSON.stringify(r.error));
    await until(async () => (await cellNow()) === target, 8000, `B's ITK status to show ${target}`)
      .catch(async e => { throw new Error(`${e.message} | before="${before}" now="${await cellNow()}" apiNow=${JSON.stringify((await api(URLS[1]!, tokenB, "projects.list", { limit: 5, search: PNR, department: "ITK", expand: ["table", "reviewSummary"] }, "GET")).data?.items?.length)} apiNoDept=${JSON.stringify((await api(URLS[1]!, tokenB, "projects.list", { limit: 5, search: PNR, expand: [] }, "GET")).data?.items?.length)} rows=${await page.locator("tbody tr").count()} body=${(await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 500)}`); });
    if (!(await noReload(page))) throw new Error("reloaded");
    await page.goto(`${URLS[1]}/projects`); // restore B's page for the following steps
    await search(page, "");
  });

  await step("ITEM 2: A creates a project → B (online) gets it via the event-triggered targeted list refresh, no reload", async () => {
    await search(B.page, ""); // list of all Frankfurt projects, newest id first
    await until(async () => (await rowSet(B.page)) > 20, 10000, "B list loaded");
    const r = await api(URLS[0]!, tokenA, "projects.create", { fields: { station: "E2E Neubau Frankfurt", bahnhofsmanagement: "Frankfurt", projektnummer: "E2E-NEU-1", projektstand: "AP" }, idempotencyKey: key() });
    if (r.status !== 200) throw new Error(JSON.stringify(r.error));
    createdId = r.data.project.id;
    await until(async () => (await ids(B.page)).includes(createdId), 8000, "new row in B's table");
    if (!(await noReload(B.page))) throw new Error("reloaded");
  });
  await step("ITEM 2: A(editor) is denied delete; an admin deletes it → B's row disappears by targeted removal, no reload", async () => {
    const denied = await api(URLS[0]!, tokenA, "projects.delete", { id: createdId, expectedVersion: 1, idempotencyKey: key() });
    if (denied.status !== 403) throw new Error(`editor delete -> ${denied.status}`);
    const tokenAdmin = await mint("admin", "Admin", ["admin"]);
    const r = await api(URLS[0]!, tokenAdmin, "projects.delete", { id: createdId, expectedVersion: 1, idempotencyKey: key() });
    if (r.status !== 200) throw new Error(JSON.stringify(r.error));
    await until(async () => !(await ids(B.page)).includes(createdId), 8000, "row removed in B");
    if (!(await noReload(B.page))) throw new Error("reloaded");
  });
  await search(B.page, "Kaisertreppe"); await search(A.page, "Kaisertreppe");
  await until(async () => (await row(B.page).count()) > 0 && (await row(A.page).count()) > 0, 10000, "rows back");

  // ---------------- PROOF 2: B disconnects, A changes 3×, B reconnects ------------------------------
  await step("PROOF 2: B goes offline; A changes 481 three times in the UI; B reconnects and converges exactly to server state", async () => {
    await B.ctx.setOffline(true);
    await until(async () => /Offline|wiederhergestellt|Verbinde/.test(await badge(B.page)), 8000, "B badge shows disconnected");
    const v0 = await ver(PID);
    await editCell(A.page, "Projektleitung", "E2E Leiter Eins");
    await until(async () => (await ver(PID)) === v0 + 1, 5000, "commit 1");
    await editCell(A.page, "Station", "Koblenz Hbf E2E");
    await until(async () => (await ver(PID)) === v0 + 2, 5000, "commit 2");
    await editCell(A.page, "Projektleitung", "E2E Leiter Drei");
    await until(async () => (await ver(PID)) === v0 + 3, 5000, "commit 3");
    if ((await cellText(B.page, "Projektleitung")) === "E2E Leiter Drei") throw new Error("B changed while offline?!");
    await B.ctx.setOffline(false);
    if (process.env.E2E_NET) for (let i = 0; i < 6; i++) { console.log(`   [B diag] onLine=${await B.page.evaluate(() => navigator.onLine)} badge=${await badge(B.page)}`); await sleep(1000); }
    await until(async () => /Wiederverbunden · 3 Änderungen synchronisiert/.test(await badge(B.page)), 15000, `B badge (was: ${await badge(B.page)})`);
    const [srv] = await q("SELECT station, projektleiter, projektstand FROM projects WHERE id=?", [PID]);
    await until(async () => (await cellText(B.page, "Projektleitung")) === srv.projektleiter && (await cellText(B.page, "Station")) === srv.station, 5000, "B converged");
    if (!(await noReload(B.page))) throw new Error("reloaded");
    measurements.proof2_badge = await badge(B.page);
    vN = await ver(PID);
  });

  // ---------------- PROOF 3: concurrent edit of the same field ------------------------------------------
  const conflictRun = async (choose: "server" | "mine") => {
    const v0 = await ver(PID);
    let held: import("playwright").Route | undefined;
    await B.page.route(/\/api\/trpc\/projects\.update/, async route => { if (!held) held = route; else await route.continue(); });
    await editCell(B.page, "Projektleitung", `B-Wert-${choose}`);
    await until(async () => !!held, 5000, "B's mutation held in flight");
    // B's UI shows its own optimistic value immediately
    await until(async () => (await cellText(B.page, "Projektleitung")) === `B-Wert-${choose}`, 3000, "B optimistic");
    await editCell(A.page, "Projektleitung", `A-Wert-${choose}`);          // A commits first
    await until(async () => (await ver(PID)) === v0 + 1, 5000, "A committed");
    await held!.continue();                                                   // B's stale write reaches the server
    await B.page.unroute(/\/api\/trpc\/projects\.update/);
    const dialog = B.page.getByRole("alertdialog");
    await until(async () => await dialog.isVisible(), 8000, "structured conflict dialog on B");
    const text = await dialog.innerText();
    if (!text.includes(`A-Wert-${choose}`) || !text.includes(`B-Wert-${choose}`) || !/Konflikt/.test(text)) throw new Error(`dialog: ${text}`);
    if ((await q("SELECT projektleiter p FROM projects WHERE id=?", [PID]))[0].p !== `A-Wert-${choose}`) throw new Error("B silently overwrote A");
    if ((await ver(PID)) !== v0 + 1) throw new Error("version moved although B was rejected");
    if (choose === "server") {
      await dialog.getByRole("button", { name: /Serverwert behalten/ }).click();
      await until(async () => (await cellText(B.page, "Projektleitung")) === `A-Wert-${choose}`, 5000, "B shows A's value");
      if ((await ver(PID)) !== v0 + 1) throw new Error("unexpected write");
    } else {
      await dialog.getByRole("button", { name: /Meinen Wert übernehmen/ }).click();
      await until(async () => (await ver(PID)) === v0 + 2, 5000, "B's explicit overwrite committed");
      await until(async () => (await cellText(A.page, "Projektleitung")) === `B-Wert-${choose}`, 5000, "A sees B's explicit overwrite live");
      const audits = await q("SELECT newValue,oldValue,aggregateVersion FROM audit_log WHERE entityId=? AND field='projektleiter' ORDER BY id DESC LIMIT 2", [PID]);
      if (audits[0].oldValue !== `A-Wert-${choose}` || audits[1].newValue !== `A-Wert-${choose}`) throw new Error(`audit chain ${JSON.stringify(audits)}`);
    }
  };
  await step("PROOF 3a: A and B edit the same field concurrently → A commits, B gets the structured conflict, nobody is overwritten; B keeps the server value", () => conflictRun("server"));
  await step("PROOF 3b: same race → B explicitly chooses 'mine' → committed as the next version, A sees it live, audit chain intact", () => conflictRun("mine"));

  // ---------------- PROOF 3c: department review edit rides the same pipeline ---------------------------
  await step("PROOF 3c: A changes the ITK review status of 481 in the table → versioned + audited + evented → B's status badge changes live; a non-ITK editor is refused", async () => {
    const statusBtn = (page: Page) => row(page).locator('button[aria-label^="Status ITK für Projekt"]').first();
    const [rv] = await q("SELECT status FROM department_reviews WHERE projectId=? AND department='ITK'", [PID]);
    if (!rv) throw new Error("project 481 has no ITK review in the seed");
    const target = rv.status === "Zustimmung erteilt" ? "in Bearbeitung" : "Zustimmung erteilt";
    const v0 = await ver(PID);
    await statusBtn(A.page).click();
    await A.page.getByLabel(/^Status ITK für Projekt/).selectOption(target);
    await until(async () => (await statusBtn(B.page).textContent())?.trim() === target, 5000, `B shows ITK status ${target}`);
    if ((await ver(PID)) !== v0 + 1) throw new Error("review edit did not bump the project version exactly once");
    const [a] = await q("SELECT field,oldValue,newValue,aggregateVersion FROM audit_log WHERE entityId=? AND field LIKE 'review.%' ORDER BY id DESC LIMIT 1", [PID]);
    if (a.field !== "review.ITK.status" || a.newValue !== target || a.aggregateVersion !== v0 + 1) throw new Error(JSON.stringify(a));
    if (!(await noReload(B.page))) throw new Error("reloaded");
    // B's token has no ITK department claim → the server refuses (no client-side trust)
    const denied = await api(URLS[1]!, tokenB, "projects.updateReview", { projectId: PID, department: "ITK", expectedVersion: await ver(PID), changes: { status: "abgelehnt" }, idempotencyKey: key() });
    if (denied.status !== 403) throw new Error(`non-ITK editor got ${denied.status}`);
  });

  // ---------------- PROOF 7/8: presence + notifications ---------------------------------------------------
  const openDetail = async (page: Page) => { await page.getByRole("button", { name: new RegExp(`Details zu Projekt ${PNR.replace(".", "\\.")}`) }).first().click(); await page.getByRole("dialog").waitFor(); };
  const closeDetail = async (page: Page) => { await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "hidden" }); };
  const strip = (page: Page) => page.locator('[data-testid="presence-strip"]').first();
  await step("PRESENCE: both open project 481 → each sees the other in the project strip (Redis TTL presence, pushed over the stream); leaving clears it; workspace presence counts B", async () => {
    await openDetail(A.page); await openDetail(B.page);
    await until(async () => /Anna \(Browser A\) sieht zu/.test((await strip(B.page).textContent()) ?? ""), 8000, "B sees Anna viewing");
    await until(async () => /Bernd \(Browser B\) sieht zu/.test((await strip(A.page).textContent()) ?? ""), 8000, "A sees Bernd viewing");
    const wp = await B.page.locator('[data-testid="workspace-presence"]').first().textContent().catch(() => null);
    measurements.workspace_presence_B = wp?.trim() ?? "";
    await closeDetail(A.page);
    await until(async () => /Nur Sie sehen/.test((await strip(B.page).textContent()) ?? ""), 8000, "B sees Anna gone");
    await closeDetail(B.page);
    // ephemeral: nothing about presence in SQL
    const tables = await q("SELECT table_name t FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name LIKE '%presence%'");
    if (tables.length) throw new Error("presence table exists in SQL");
    if (!(await noReload(B.page))) throw new Error("reloaded");
  });
  await step("NOTIFICATIONS: B watches 481; A changes Projektstand → B's bell shows an unread workflow notification live (no reload); a stop is 'critical'; reading clears it; the bell reads the real notification source", async () => {
    await openDetail(B.page);
    await B.page.getByTestId("watch-toggle").click();
    await until(async () => (await B.page.getByTestId("watch-toggle").getAttribute("aria-pressed")) === "true", 5000, "watching");
    await closeDetail(B.page);
    const bell = B.page.getByTestId("notification-bell");
    const cur = await cellText(A.page, "Projektstand");
    const next1 = cur === "EP" ? "AP" : "EP";
    await editCell(A.page, "Projektstand", next1);
    await until(async () => (await B.page.getByTestId("notification-badge").count()) > 0, 8000, "unread badge on B's bell");
    await bell.click();
    const item = B.page.getByTestId("notification-item").first();
    await until(async () => (await item.count()) > 0, 5000, "notification item");
    if ((await item.getAttribute("data-kind")) !== "workflow" || !/Projektstand/.test((await item.textContent()) ?? "")) throw new Error(`item: ${await item.textContent()}`);
    await B.page.keyboard.press("Escape");
    await editCell(A.page, "Projektstand", "Gestoppt");
    await until(async () => (await B.page.getByTestId("notification-badge").textContent())?.trim() === "2", 8000, "second unread");
    await bell.click();
    if ((await B.page.getByTestId("notification-item").first().getAttribute("data-kind")) !== "critical") throw new Error("stop is not critical");
    await B.page.getByText("Alle als gelesen markieren").click();
    await until(async () => (await B.page.getByTestId("notification-badge").count()) === 0, 5000, "badge cleared");
    const [{ n }] = await q("SELECT COUNT(*) n FROM notifications WHERE readAt IS NULL");
    if (Number(n) !== 0) throw new Error(`${n} unread rows remain in SQL`);
    await B.page.keyboard.press("Escape");
    await editCell(A.page, "Projektstand", cur);     // restore …
    await until(async () => (await q("SELECT projektstand p FROM projects WHERE id=?", [PID]))[0].p === cur, 5000, "restore committed");   // … and let it land before the next proof
    if (!(await noReload(B.page))) throw new Error("reloaded");
  });

  // ---------------- PROOF 4: workspace move Frankfurt → Kassel -----------------------------------------
  await step("PROOF 4: A moves 481 Frankfurt → Kassel; Frankfurt-only B loses the row and receives no Kassel state (stream + DOM + API)", async () => {
    await B.page.evaluate(() => { (window as any).__sse.length = 0; });
    const r = await apiUpdate(tokenA, PID, { bahnhofsmanagement: "Kassel", projektstand: "EIGV erfolgt", kommentar: "nur-in-Kassel-sichtbar" });
    if (r.status !== 200) throw new Error(JSON.stringify(r.error));
    await until(async () => (await row(B.page).count()) === 0, 8000, "row 481 gone from B");
    const wire = (await B.page.evaluate(() => (window as any).__sse.join(""))) as string;
    if (!/project\.removed/.test(wire)) throw new Error("B never received the removal");
    for (const leak of ["Kassel", "nur-in-Kassel-sichtbar", "EIGV erfolgt"]) if (wire.includes(leak)) throw new Error(`stream leaked "${leak}"`);
    const html = await B.page.content();
    if (/nur-in-Kassel-sichtbar|Kassel/.test(html.replace(/<script[\s\S]*?<\/script>/g, ""))) throw new Error("Kassel state present in B's DOM");
    const get = await api(URLS[1]!, tokenB, "projects.get", { id: PID }, "GET");
    if (get.status !== 404) throw new Error(`B can still read the project: ${get.status}`);
    if (!(await noReload(B.page))) throw new Error("reloaded");
  });

  // ---------------- PROOF 5: collection-level recovery ---------------------------------------------------
  await step("PROOF 5: B offline; A creates a project, deletes one, moves one out, moves one in; B reconnects and its table equals the authoritative visible collection", async () => {
    await search(B.page, "");
    await until(async () => (await rowSet(B.page)) >= 50, 10000, "B full list");
    const visibleBefore = await ids(B.page);
    const victim = visibleBefore[3]!, mover = visibleBefore[5]!;           // both currently visible to B
    const [{ id: comingIn }] = await q("SELECT id FROM projects WHERE bahnhofsmanagement='Kassel' AND id<>? ORDER BY id DESC LIMIT 1", [PID]);
    await B.ctx.setOffline(true);
    await until(async () => /Offline|wiederhergestellt|Verbinde/.test(await badge(B.page)), 8000, "B disconnected");
    const tokenAdmin = await mint("admin", "Admin", ["admin"]);
    const cr = await api(URLS[0]!, tokenA, "projects.create", { fields: { station: "E2E Recovery Neu", bahnhofsmanagement: "Frankfurt", projektnummer: "E2E-REC-1" }, idempotencyKey: key() });
    createdId = cr.data.project.id;
    const del = await api(URLS[0]!, tokenAdmin, "projects.delete", { id: victim, expectedVersion: await ver(victim), idempotencyKey: key() });
    const out = await apiUpdate(tokenA, mover, { bahnhofsmanagement: "Kassel" });
    const inn = await apiUpdate(tokenA, comingIn, { bahnhofsmanagement: "Frankfurt" });
    if ([cr, del, out, inn].some(x => x.status !== 200)) throw new Error(JSON.stringify([cr.error, del.error, out.error, inn.error]));
    await B.ctx.setOffline(false);
    await until(async () => /Wiederverbunden · \d+ Änderungen? synchronisiert/.test(await badge(B.page)), 15000, `resync badge (was: ${await badge(B.page)})`);
    const auth = await api(URLS[1]!, tokenB, "projects.list", { limit: 100, sort: "id", dir: "desc", expand: [] }, "GET");
    const authoritative: number[] = auth.data.items.map((p: any) => p.id);
    // The DOM holds only the rows around the viewport, so the comparison is window by window against the authoritative order.
    const windowAt = async (index: number) => { const top = await scrollRows(B.page, index); const got = await ids(B.page); const first = authoritative.indexOf(got[0]!); return { got, top, want: authoritative.slice(Math.max(0, first), Math.max(0, first) + got.length), first }; };
    await until(async () => { const { got, want } = await windowAt(0); return got.length > 0 && JSON.stringify(got) === JSON.stringify(want); }, 10000, "B's table top window equals the authoritative first rows")
      .catch(async e => { const { got, want } = await windowAt(0); throw new Error(`${e.message}\n  got ${got}\n  want ${want}\n  created=${createdId} in=${comingIn} victim=${victim} mover=${mover}`); });
    const total = await rowSet(B.page);
    if (total < authoritative.length) throw new Error(`B holds ${total} rows, the authoritative first page has ${authoritative.length}`);
    // wherever the window lands, it must be a contiguous slice of the authoritative order
    for (const idx of [0, 25, 50, 75]) {
      const { got, want, top, first } = await windowAt(idx);
      if (first < 0 || JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`window @${idx} (scrollTop ${top}) is not a contiguous slice of the authoritative order:\n got ${got}\n want ${want}`);
    }
    const everyone = new Set<number>();
    for (const idx of [0, 20, 40, 60, 80]) { await scrollRows(B.page, idx); for (const i of await ids(B.page)) everyone.add(i); }
    for (const [id, want] of [[createdId, true], [comingIn, true], [victim, false], [mover, false]] as const)
      if (authoritative.includes(id) && everyone.has(id) !== want) throw new Error(`id ${id} presence ${everyone.has(id)} != ${want}`);
    await scrollRows(B.page, 0);
    if (!(await noReload(B.page))) throw new Error("reloaded");
    measurements.proof5_badge = await badge(B.page);
  });

  // ---------------- structure / metrics -------------------------------------------------------------------
  await step("integrity: every committed change has exactly one audit set, one event, one feedSeq; feed is gapless; nothing unpublished/dead", async () => {
    await until(async () => Number((await q("SELECT COUNT(*) n FROM domain_events WHERE processedAt IS NULL"))[0].n) === 0, 5000, "outbox drained");
    const [c] = await q("SELECT COUNT(*) events, SUM(failedAt IS NOT NULL) dead, MIN(feedSeq) lo, MAX(feedSeq) hi, COUNT(feedSeq) seqd FROM domain_events");
    if (Number(c.dead) !== 0) throw new Error("dead-lettered events");
    if (Number(c.hi) - Number(c.lo) + 1 !== Number(c.seqd)) throw new Error("feed has gaps");
    const [{ orphan }] = await q("SELECT COUNT(*) orphan FROM domain_events e WHERE e.aggregateType='project' AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.eventId=e.eventId)");
    if (Number(orphan) !== 0) throw new Error(`${orphan} project events without audit rows`);
    measurements.events = Number(c.events);
    const m = await (await fetch(`${URLS[0]}/api/metrics`, { headers: { authorization: "Bearer e2e" } })).text();
    const m2 = await (await fetch(`${URLS[1]}/api/metrics`, { headers: { authorization: "Bearer e2e" } })).text();
    const total = (t: string, name: string) => Number(new RegExp(`^${name} (\\d+)`, "m").exec(t)?.[1] ?? 0);
    measurements.published_instance1 = total(m, "bahn_outbox_published_total");
    measurements.published_instance2 = total(m2, "bahn_outbox_published_total");
    measurements.dropped = total(m, "bahn_realtime_events_dropped_total") + total(m2, "bahn_realtime_events_dropped_total");
  });

  await A.ctx.close(); await B.ctx.close(); await browser.close();
  await db.end(); idp.close();
}

let crashed: unknown;
try { await main(); } catch (e) { crashed = e; console.error("E2E crashed:", e); }
finally { for (const c of children) c.kill("SIGTERM"); }
const failed = results.filter(r => !r.ok).length;
writeFileSync("artifacts/e2e-server-mode.json", JSON.stringify({
  suite: "server-mode-browser-proof", finishedAt: new Date().toISOString(), commit: process.env.GIT_COMMIT ?? null,
  passed: results.filter(r => r.ok).length, failed, crashed: crashed ? String(crashed) : null, measurements, results,
}, null, 2));
console.log(`\n== summary ==\n${results.filter(r => r.ok).length} passed, ${failed} failed${crashed ? ", CRASHED" : ""}`);
process.exit(failed || crashed ? 1 : 0);
