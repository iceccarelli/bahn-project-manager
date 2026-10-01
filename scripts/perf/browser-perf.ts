/**
 * Browser performance measurement of the Projekte page against a REAL server (production bundle, real MySQL,
 * real 1,298-project dataset, OIDC-authenticated). Produces numbers, not impressions:
 *
 *   DOM node count · table rows in DOM · time to first row · LCP · CLS · INP (worst interaction in a scripted
 *   session) · scroll frame times · JS heap · initial transferred bytes (total + JS) · map time-to-first-marker
 *   · list API payload size (raw + gzip) for the old and the new projection.
 *
 *   tsx scripts/perf/browser-perf.ts --label after  [--public dist-e2e/public]
 *   tsx scripts/perf/browser-perf.ts --label before --public <dir with the old client build>
 *
 * Writes artifacts/browser-perf-<label>.json. Single machine: generator, browser and server share CPU, so absolute
 * numbers are indicative of the DOM/JS work (what virtualization changes), not of a deployed network path.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1]! : d; };
const LABEL = arg("label", "after"), PUBLIC = arg("public", "dist-e2e/public");
const DB = process.env.PERF_DATABASE_URL ?? "mysql://root:pw@127.0.0.1:3390/bahn_real";
const REDIS = process.env.E2E_REDIS ?? "redis://127.0.0.1:6390";
const PORT = Number(arg("port", "3320"));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---- server with the chosen client build ---------------------------------------------------------
const stage = `dist-perf-${LABEL}`;
rmSync(stage, { recursive: true, force: true });
cpSync("dist-e2e", stage, { recursive: true });
if (PUBLIC !== "dist-e2e/public") { rmSync(`${stage}/public`, { recursive: true, force: true }); cpSync(PUBLIC, `${stage}/public`, { recursive: true }); }

const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "p", alg: "RS256", use: "sig" };
const idp = createServer((_q, r) => { r.setHeader("content-type", "application/json"); r.end(JSON.stringify({ keys: [jwk] })); });
await new Promise<void>(r => idp.listen(0, "127.0.0.1", r));
const ISS = `http://127.0.0.1:${(idp.address() as { port: number }).port}/`;
const token = await new SignJWT({ tid: "t", oid: "perf", name: "Perf", roles: ["admin"], workspaces: ["ALL"] }).setProtectedHeader({ alg: "RS256", kid: "p" }).setIssuer(ISS).setAudience("perf").setIssuedAt().setExpirationTime("2h").sign(privateKey);
const srv: ChildProcess = spawn("node", [`${stage}/index.js`], { env: { ...process.env, NODE_ENV: "production", PORT: String(PORT), DATABASE_URL: DB, JWT_SECRET: "p".repeat(48), OIDC_ISSUER: ISS, OIDC_AUDIENCE: "perf", OIDC_JWKS_URI: `${ISS}jwks`, REDIS_URL: REDIS, METRICS_TOKEN: "perf", DB_POOL_SIZE: "10" }, stdio: ["ignore", "ignore", "inherit"] });
for (let i = 0; i < 100 && !(await fetch(`http://127.0.0.1:${PORT}/api/ready`).then(r => r.ok).catch(() => false)); i++) await sleep(200);
const BASE = `http://127.0.0.1:${PORT}`;

// ---- API payloads ----------------------------------------------------------------------------------
const list = async (input: unknown) => {
  const r = await fetch(`${BASE}/api/trpc/projects.list?input=${encodeURIComponent(JSON.stringify({ json: input }))}`, { headers: { authorization: `Bearer ${token}` } });
  const body = Buffer.from(await r.arrayBuffer());
  return { status: r.status, raw: body.length, gzip: gzipSync(body).length };
};
const payload = {
  before_reviews_details_total: await list({ limit: 100, sort: "id", dir: "desc", expand: ["reviews", "details"], includeTotal: true }),
  after_table_projection: await list({ limit: 100, sort: "id", dir: "desc", expand: ["table", "reviewSummary"] }),
  summary_only: await list({ limit: 100, sort: "id", dir: "desc", expand: [] }),
};

// ---- browser ---------------------------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined, args: ["--no-sandbox", "--enable-precise-memory-info"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(`
  window.__name = (f) => f; // tsx/esbuild instruments named functions inside evaluate() callbacks
  try { sessionStorage.setItem("bahn.access_token", ${JSON.stringify(token)}); } catch (e) {}
  window.__perf = { lcp: 0, cls: 0, firstRowAt: null, events: [], longTasks: 0 };
  new PerformanceObserver(l => { for (const e of l.getEntries()) window.__perf.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver(l => { for (const e of l.getEntries()) window.__perf.events.push({ name: e.name, duration: e.duration, interactionId: e.interactionId || 0 }); }).observe({ type: "event", durationThreshold: 16, buffered: true });
  new PerformanceObserver(l => { window.__perf.longTasks += l.getEntries().length; }).observe({ type: "longtask", buffered: true });
  new MutationObserver(() => { if (window.__perf.firstRowAt === null && document.querySelector("table tbody tr td")) window.__perf.firstRowAt = performance.now(); }).observe(document, { childList: true, subtree: true });
`);
await ctx.route(/tile\.openstreetmap\.org/, r => r.abort());
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
let transferred = 0, jsTransferred = 0;
const meta = new Map<string, string>();
const urls = new Map<string, string>(); const sizes: Array<{ url: string; kb: number }> = [];
cdp.on("Network.responseReceived", (e: any) => { meta.set(e.requestId, e.response.mimeType); urls.set(e.requestId, e.response.url); });
cdp.on("Network.loadingFinished", (e: any) => { sizes.push({ url: (urls.get(e.requestId) ?? "").replace(/^https?:\/\/[^/]+/, "").slice(0, 80), kb: Math.round(e.encodedDataLength / 1024) }); transferred += e.encodedDataLength; if (/javascript/.test(meta.get(e.requestId) ?? "")) jsTransferred += e.encodedDataLength; });

const t0 = Date.now();
await page.goto(`${BASE}/projects`);
await page.waitForSelector("table tbody tr td", { timeout: 30000 });
const timeToRowsMs = Date.now() - t0;
await sleep(1500);
const nodes = () => page.evaluate(() => document.getElementsByTagName("*").length);
const rowsDom = () => page.evaluate(() => document.querySelectorAll("table tbody tr:not([aria-hidden])").length);
const rowSet = () => page.evaluate(() => { const t = document.querySelector("table[data-row-count]"); return t ? Number(t.getAttribute("data-row-count")) : document.querySelectorAll("table tbody tr").length; });
const heap = async () => (await cdp.send("Runtime.getHeapUsage") as { usedSize: number }).usedSize;
const initial = { domNodes: await nodes(), tableRowsInDom: await rowsDom(), rowSet: await rowSet(), jsHeapMB: +(await heap() / 1048576).toFixed(1), transferredKB: Math.round(transferred / 1024), jsTransferredKB: Math.round(jsTransferred / 1024) };

// scroll performance: a scripted 4-second scroll through the table, sampling frame times
const scrollStats = await page.evaluate(async () => {
  const c = (document.querySelector('[data-testid="projects-scroll"]') ?? document.scrollingElement) as HTMLElement;
  const frames: number[] = []; let last = performance.now(); let raf = 0;
  const loop = (t: number) => { frames.push(t - last); last = t; raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  const end = performance.now() + 4000, step = 40;
  while (performance.now() < end) { c.scrollTop += step; await new Promise(r => setTimeout(r, 16)); }
  cancelAnimationFrame(raf);
  frames.sort((a, b) => a - b);
  const p = (q: number) => frames[Math.min(frames.length - 1, Math.floor(frames.length * q))] ?? 0;
  return { frames: frames.length, p50: +p(0.5).toFixed(1), p95: +p(0.95).toFixed(1), p99: +p(0.99).toFixed(1), over50ms: frames.filter(f => f > 50).length };
});
const afterScroll = { domNodes: await nodes(), tableRowsInDom: await rowsDom(), rowSet: await rowSet(), jsHeapMB: +(await heap() / 1048576).toFixed(1) };

// INP: interactions a user performs. The worst interaction duration is the INP candidate.
await page.evaluate(() => { const c = document.querySelector('[data-testid="projects-scroll"]'); if (c) (c as HTMLElement).scrollTop = 0; });
await sleep(300);
// the interactions below are what a user does; their event-timing durations feed INP (not the wall time of the script)
await page.locator("th button, th [role=button]").nth(1).click().catch(() => {}); await sleep(500);          // sort
{ const i = page.locator("#projects-search"); await i.click(); await i.type("Frank", { delay: 30 }); await i.press("Enter"); await sleep(700); }   // search
await page.locator('button[aria-label*="Details zu Projekt"]').first().click().catch(() => {}); await sleep(600); await page.keyboard.press("Escape"); await sleep(300); // open detail
{ const i = page.locator("#projects-search"); await i.fill(""); await i.press("Enter"); await sleep(600); }   // reset
const inpEvents = await page.evaluate(() => (window as any).__perf.events as Array<{ name: string; duration: number; interactionId: number }>);
const interactionDurations = inpEvents.filter(e => e.interactionId > 0).map(e => e.duration).sort((a, b) => a - b);
const inp = interactionDurations.length ? interactionDurations[Math.min(interactionDurations.length - 1, Math.ceil(interactionDurations.length * 0.98) - 1)]! : 0;

// map: time from toggling the view to the first marker
let mapMs: number | null = null, mapMarkers = 0;
{
  const t = Date.now();
  await page.getByRole("button", { name: /Karte|Map/i }).first().click().catch(() => {});
  await page.waitForSelector(".leaflet-marker-icon, path.leaflet-interactive", { timeout: 15000 }).then(() => { mapMs = Date.now() - t; }).catch(() => {});
  mapMarkers = await page.locator(".leaflet-marker-icon, path.leaflet-interactive").count();
}
const perf = await page.evaluate(() => (window as any).__perf as { lcp: number; cls: number; firstRowAt: number | null; longTasks: number });

const out = {
  label: LABEL, at: new Date().toISOString(), environment: "single host (browser + server + DB share CPU), Chromium headless, 1440x900, real 1,298-row dataset, MySQL 8.4",
  initial, afterScroll, scroll: scrollStats,
  webVitals: { lcpMs: Math.round(perf.lcp), cls: +perf.cls.toFixed(4), inpMs: Math.round(inp), firstRowRenderedAtMs: perf.firstRowAt === null ? null : Math.round(perf.firstRowAt), timeToRowsMs, longTasks: perf.longTasks },
  slowestInteractionsMs: [...interactionDurations].reverse().slice(0, 5),
  map: { timeToFirstMarkerMs: mapMs, markers: mapMarkers },
  largestTransfers: sizes.sort((a, b) => b.kb - a.kb).slice(0, 8),
  listPayloadBytes: payload,
};
mkdirSync("artifacts", { recursive: true });
writeFileSync(`artifacts/browser-perf-${LABEL}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close(); srv.kill("SIGTERM"); idp.close();
rmSync(stage, { recursive: true, force: true });
process.exit(0);
