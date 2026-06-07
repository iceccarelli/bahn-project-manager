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
  console.error(`\n❌ ${DIST}/index.html not found. Run "NODE_ENV=production pnpm build:client" first.\n`);
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
  { label:"mobile  375", width:375, height:812 }, { label:"tablet  768", width:768, height:1024 },
  { label:"laptop 1024", width:1024, height:768 }, { label:"desktop 1440", width:1440, height:900 },
];
const DEMO_USER = { id:1, name:"Admin", email:"admin@bahn.de", role:"admin", openId:"demo-admin",
  loginMethod:"demo", createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), lastSignedIn:new Date().toISOString() };
const base = `http://localhost:${PORT}`;
let failures = 0;
const log = (ok, msg) => { console.log(`${ok ? "✅" : "❌"} ${msg}`); if (!ok) failures++; };
await new Promise((r) => server.listen(PORT, r));
const browser = await chromium.launch();
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
    if (vp.width < 768) {
      await page.goto(base + "/", { waitUntil: "networkidle" });
      await page.waitForSelector("header");
      const btn = page.getByRole("button", { name: "Navigation öffnen" });
      const visible = await btn.isVisible().catch(() => false);
      log(visible, `${vp.label}px  hamburger visible`);
      if (visible) {
        await btn.click(); await page.waitForTimeout(400);
        const navOk = await page.getByText("Änderungshistorie", { exact: true }).isVisible().catch(() => false);
        log(navOk, `${vp.label}px  nav sheet opens with all tabs`);
      }
    } else {
      await page.goto(base + "/", { waitUntil: "networkidle" });
      await page.getByText("Projekte", { exact: true }).first().click();
      await page.waitForTimeout(300);
      log(/\/projects$/.test(page.url()), `${vp.label}px  sidebar nav -> /projects`);
    }
    await ctx.close();
  }
} finally { await browser.close(); server.close(); }
console.log(`\n${failures === 0 ? "🎉 ALL RESPONSIVE CHECKS PASSED" : `🔥 ${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
