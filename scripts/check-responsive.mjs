// scripts/check-responsive.mjs — headless responsive + nav smoke test for the prod build.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "..", "dist", "public");
const PORT = 4173;
if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error(`\n❌ ${DIST}/index.html not found. Run "pnpm build:demo" first.\n`);
  process.exit(2);
}
const MIME = { ".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json",
  ".svg":"image/svg+xml",".png":"image/png",".ico":"image/x-icon",".woff2":"font/woff2",".map":"application/json" };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent((req.url || "/").split("?")[0]);
  let fp = path.join(DIST, u);
  if (u === "/" || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    if (!(fs.existsSync(fp) && fs.statSync(fp).isFile())) fp = path.join(DIST, "index.html");
  }
  fs.readFile(fp, (e, d) => {
    if (e) { res.writeHead(404); res.end("nf"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream" });
    res.end(d);
  });
});
const ROUTES = [
  { path:"/", name:"Dashboard" }, { path:"/projects", name:"Projekte" },
  { path:"/bvb-eea", name:"BVB-EEA" }, { path:"/psv-itk", name:"PSV-ITK" },
  { path:"/audit", name:"Änderungshistorie" },
];
const VIEWPORTS = [
  { label:"mobile  375", width:375, height:812 },
  { label:"mobile  390", width:390, height:844 },
  { label:"mobile  430", width:430, height:932 },
  { label:"phone   744", width:744, height:1133 },   // iPad mini portrait: still below 768 -> bottom bar
  { label:"tablet  768", width:768, height:1024 },
  // 834 and 820 are iPad Pro 11 and iPad Air in portrait. They sat in the dead
  // band where the sidebar had not mounted and the trigger was already hidden,
  // so they are pinned here permanently.
  { label:"tablet  820", width:820, height:1180 },
  { label:"tablet  834", width:834, height:1194 },
  { label:"laptop 1024", width:1024, height:768 }, { label:"laptop 1280", width:1280, height:800 }, { label:"desktop 1440", width:1440, height:900 },
];
const DEMO_USER = { id:1, name:"Admin", email:"admin@bahn.de", role:"admin", openId:"demo-admin",
  loginMethod:"demo", createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), lastSignedIn:new Date().toISOString() };
const base = `http://localhost:${PORT}`;
let failures = 0;
const log = (ok, msg) => { console.log(`${ok ? "✅" : "❌"} ${msg}`); if (!ok) failures++; };
await new Promise((r) => server.listen(PORT, r));
/*
 * Same container problem e2e-smoke.mjs already solves: as root in an
 * unprivileged container Chrome's setuid sandbox cannot initialise and the
 * default 64 MB /dev/shm exhausts the renderer, so a bare launch() dies with
 * "Target page, context or browser has been closed". These flags are safe —
 * this harness only ever loads the bundle it just built.
 */
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    await ctx.addInitScript((u) => localStorage.setItem("bahn-demo-user", JSON.stringify(u)), DEMO_USER);
    const page = await ctx.newPage();
    for (const route of ROUTES) {
      await page.goto(base + route.path, { waitUntil: "networkidle" });
      await page.waitForSelector("header", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(600);
      const m = await page.evaluate(() => {
        const el = document.querySelector("main");
        return el ? { s: el.scrollWidth, c: el.clientWidth } : { s: 0, c: 0 };
      });
      log(m.s <= m.c + 2, `${vp.label}px  ${route.name.padEnd(18)} main ${m.s}/${m.c}px`);
    }
    /*
     * The shell contract (client/src/hooks/useMobile.tsx, components/BottomTabBar.tsx, navModel.ts):
     *   < 768   phones   a bottom tab bar (4 destinations + Mehr), no side rail, no hamburger, content never hidden behind the bar
     *   >= 768  tablets+ a side rail (icons below 1280, icon + label above), no bottom bar
     * Both must reach every destination without a keyboard trick.
     */
    const phone = vp.width < 768;
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    await page.waitForSelector("header");
    const bar = page.getByTestId("bottom-nav");
    const railState = page.locator('[data-slot="sidebar"][data-state]').first();
    const rail = page.locator('[data-slot="sidebar-inner"]').first();
    const railItem = (name) => page.locator('[data-sidebar="menu-button"], [data-slot="sidebar-menu-button"]').filter({ hasText: name }).first();
    log(!(await page.getByRole("button", { name: "Navigation öffnen" }).count()), `${vp.label}px  no hamburger (navigation is never behind a drawer)`);
    if (phone) {
      log(await bar.isVisible(), `${vp.label}px  bottom tab bar visible`);
      const tabs = await bar.locator("a, button").count();
      log(tabs === 5, `${vp.label}px  bottom bar has 5 targets (${tabs})`);
      const small = await bar.locator("a, button").evaluateAll(els => els.filter(e => { const r = e.getBoundingClientRect(); return r.height < 44 || r.width < 44; }).length);
      log(small === 0, `${vp.label}px  every tab is a >= 44px touch target`);
      // the document scrolls: at the very end, the last thing on the page must sit above the bar, not under it
      const geo = await page.evaluate(async () => {
        window.scrollTo(0, document.documentElement.scrollHeight); await new Promise(r => setTimeout(r, 150));
        const b = document.querySelector('[data-testid="bottom-nav"]').getBoundingClientRect();
        const inset = document.querySelector('[data-slot="sidebar-inset"]');
        const last = inset.lastElementChild.getBoundingClientRect();
        return { barTop: b.top, barBottom: b.bottom, vh: innerHeight, mainBottom: last.bottom, docW: document.documentElement.scrollWidth, vw: innerWidth };
      });
      log(Math.abs(geo.barBottom - geo.vh) <= 1, `${vp.label}px  bar is pinned to the bottom edge`);
      log(geo.mainBottom <= geo.barTop + 1, `${vp.label}px  content ends above the bar (${Math.round(geo.mainBottom)} <= ${Math.round(geo.barTop)})`);
      log(geo.docW <= geo.vw, `${vp.label}px  no horizontal page scroll`);
      log(!(await rail.isVisible().catch(() => false)), `${vp.label}px  no side rail on a phone`);
      for (const [tab, re] of [["tab-projekte", /\/projects$/], ["tab-aktivitaet", /\/audit$/], ["tab-anmeldung", /\/anmeldung$/], ["tab-start", /\/$/]]) {
        await page.getByTestId(tab).click(); await page.waitForTimeout(250);
        log(re.test(new URL(page.url()).pathname) && (await page.getByTestId(tab).getAttribute("aria-current")) === "page", `${vp.label}px  ${tab} navigates and is marked current`);
      }
      await page.getByTestId("tab-more").click(); await page.waitForTimeout(350);
      const sheetOk = await page.getByTestId("more-sheet").isVisible();
      log(sheetOk, `${vp.label}px  Mehr opens the sheet`);
      log(await page.getByText("Konto und Einstellungen").isVisible().catch(() => false) && await page.getByRole("link", { name: /BVB-EEA/ }).isVisible().catch(() => false) && await page.getByRole("link", { name: /PSV-ITK/ }).isVisible().catch(() => false), `${vp.label}px  Mehr lists BVB-EEA, PSV-ITK and Konto`);
      await page.getByRole("link", { name: /BVB-EEA/ }).click(); await page.waitForTimeout(400);
      log(/\/bvb-eea$/.test(new URL(page.url()).pathname) && !(await page.getByTestId("more-sheet").isVisible().catch(() => false)), `${vp.label}px  Mehr -> BVB-EEA navigates and closes the sheet`);
      log((await page.getByTestId("tab-more").getAttribute("aria-expanded")) === "false" && /text-primary-strong/.test((await page.getByTestId("tab-more").getAttribute("class")) ?? ""), `${vp.label}px  Mehr is the highlighted tab while a page behind it is open`);
    } else {
      log(!(await bar.isVisible().catch(() => false)), `${vp.label}px  no bottom bar on tablet/desktop`);
      log(await rail.isVisible(), `${vp.label}px  side rail visible`);
      const expanded = vp.width >= 1280;
      const st = await railState.getAttribute("data-state");
      log(st === (expanded ? "expanded" : "collapsed"), `${vp.label}px  rail starts ${expanded ? "expanded (icon + label)" : "collapsed (icons)"} (state=${st})`);
      log(await page.getByTestId("rail-new").isVisible(), `${vp.label}px  primary action "Projekt anmelden" visible in the rail`);
      await railItem("Projekte").click(); await page.waitForTimeout(300);
      log(/\/projects$/.test(new URL(page.url()).pathname), `${vp.label}px  rail nav -> /projects`);
      await page.getByTestId("rail-new").click(); await page.waitForTimeout(300);
      log(/\/anmeldung$/.test(new URL(page.url()).pathname), `${vp.label}px  rail primary action -> /anmeldung`);
      const cur = await page.locator('[aria-current="page"]').count();
      log(cur >= 1, `${vp.label}px  the open page is marked aria-current`);
    }
    await ctx.close();
  }
} finally { await browser.close(); server.close(); }
console.log(`\n${failures === 0 ? "🎉 ALL RESPONSIVE CHECKS PASSED" : `🔥 ${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
