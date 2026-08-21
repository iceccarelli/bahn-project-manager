/**
 * Map chrome geometry check.
 *
 * The map carries four overlays the app owns (summary card, legend, control
 * cluster) plus two Leaflet renders into its own DOM (zoom control,
 * attribution). Leaflet's live BELOW the React overlays in the tree, which is
 * how a probe that only walked the React siblings of `.leaflet-container` once
 * reported "no overlap" while the app's buttons sat directly on top of
 * Leaflet's +/- buttons on a phone. This walks both.
 *
 * Asserted at six device profiles, in BOTH legend states (the legend defaults
 * to closed below 640px, so measuring only the default proves nothing about
 * the open one):
 *
 *   - no two pieces of chrome overlap
 *   - no piece of chrome spills outside the map
 *   - on a coarse pointer, every control is at least 44x44
 *
 * Map MARKERS are deliberately excluded from the size assertion: at 26-34px
 * they clear WCAG 2.5.8 (24x24), and inflating 425 of them to 44px would fuse
 * the network into one blob. Leaflet's attribution links are excluded too —
 * that is a legal credit line, not a control.
 *
 *   pnpm build:client && pnpm check:map
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "dist", "public");
const PORT = Number(process.env.MAP_CHECK_PORT || 4822);
const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css",
  ".json":"application/json", ".woff2":"font/woff2", ".png":"image/png",
  ".svg":"image/svg+xml", ".ttf":"font/ttf" };

if (!fs.existsSync(path.join(ROOT, "index.html"))) {
  console.error("!! dist/public/index.html missing — run `pnpm build:client` first");
  process.exit(2);
}

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  let f = path.join(ROOT, u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(ROOT, "index.html");
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

// Same container remedy as e2e-smoke.mjs: root in an unprivileged container
// cannot initialise Chrome's setuid sandbox, and the default 64MB /dev/shm
// exhausts the renderer.
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

const PROFILES = [
  ["iPhone SE",     375,  667,  true],
  ["iPhone 14 Pro", 393,  852,  true],
  ["iPad mini",     744, 1133,  true],
  ["iPad Pro 11",   834, 1194,  true],
  ["iPad land",    1194,  834,  true],
  ["Laptop",       1440,  900, false],
];

const DEMO_USER = { id: 1, openId: "map-check", name: "Map Check", email: "map@db.de", role: "admin" };

let failures = 0;

for (const [name, width, height, touch] of PROFILES) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: touch && width < 800,
    hasTouch: touch,
  });
  await ctx.addInitScript((u) => localStorage.setItem("bahn-demo-user", JSON.stringify(u)), DEMO_USER);
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/projects`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.click('[aria-label="Kartenansicht"]');
  await page.waitForSelector(".leaflet-container", { timeout: 15000 });
  await page.waitForTimeout(2500);
  const mapEl = await page.$(".leaflet-container");
  if (mapEl) await mapEl.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);

  const measure = () => page.evaluate(() => {
    const map = document.querySelector(".leaflet-container");
    const root = map.parentElement;
    const mb = map.getBoundingClientRect();

    const items = [];
    for (const el of root.children) if (!el.classList.contains("leaflet-container")) items.push(["app", el]);
    for (const el of map.querySelectorAll(".leaflet-control")) items.push(["leaflet", el]);

    const boxes = items
      .map(([kind, el]) => {
        const b = el.getBoundingClientRect();
        return {
          kind,
          name: (el.className || "").toString().split(" ").slice(0, 2).join(" ") || el.tagName,
          x: Math.round(b.x - mb.x), y: Math.round(b.y - mb.y),
          w: Math.round(b.width), h: Math.round(b.height),
        };
      })
      .filter((b) => b.w > 0 && b.h > 0);

    let overlap = 0;
    const pairs = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], c = boxes[j];
        const ox = Math.max(0, Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x));
        const oy = Math.max(0, Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y));
        if (ox * oy > 0) { overlap += ox * oy; pairs.push(`${a.kind}:${a.name} x ${c.kind}:${c.name} = ${ox * oy}px²`); }
      }
    }

    const coarse = matchMedia("(pointer: coarse)").matches;
    const tiny = [];
    for (const el of root.querySelectorAll('a[href]:not(.leaflet-marker-icon),button,[role="button"]')) {
      if (el.closest(".leaflet-marker-icon")) continue;
      if (el.closest(".leaflet-control-attribution")) continue;
      const bb = el.getBoundingClientRect();
      if (bb.width === 0 || bb.height === 0) continue;
      if (getComputedStyle(el).visibility === "hidden") continue;
      if (coarse && (bb.width < 43.5 || bb.height < 43.5)) {
        tiny.push(`${el.tagName.toLowerCase()} ${Math.round(bb.width)}x${Math.round(bb.height)}`);
      }
    }

    const area = mb.width * mb.height;
    const covered = boxes.reduce((s, x) => s + x.w * x.h, 0) - overlap;
    const spill = boxes
      .filter((x) => x.x < -1 || x.y < -1 || x.x + x.w > Math.round(mb.width) + 1 || x.y + x.h > Math.round(mb.height) + 1)
      .map((x) => x.name);

    return {
      mapW: Math.round(mb.width), mapH: Math.round(mb.height), n: boxes.length,
      overlap, pairs, spill, tiny, boxes,
      coveredPct: Math.round((covered / area) * 1000) / 10,
    };
  });

  const closed = await measure();
  await page.getByRole("button", { name: "Legende" }).click();
  await page.waitForTimeout(400);
  const open = await measure();

  const ok = [closed, open].every((r) => r.overlap === 0 && r.spill.length === 0 && r.tiny.length === 0);
  if (!ok) failures++;
  console.log(
    `${ok ? "✅" : "❌"} ${name.padEnd(14)} map ${closed.mapW}x${closed.mapH}  ` +
    `closed: cover ${closed.coveredPct}% overlap ${closed.overlap} spill ${closed.spill.length} tap<44 ${closed.tiny.length}  |  ` +
    `open: cover ${open.coveredPct}% overlap ${open.overlap} spill ${open.spill.length} tap<44 ${open.tiny.length}`,
  );
  if (!ok) {
    for (const [tag, r] of [["closed", closed], ["open", open]]) {
      if (r.pairs.length) console.log(`     ${tag}: ` + r.pairs.join(`\n     ${tag}: `));
      if (r.spill.length) console.log(`     ${tag} spill: ` + r.spill.join(", "));
      if (r.tiny.length)  console.log(`     ${tag} tap<44: ` + r.tiny.slice(0, 6).join(" | "));
      for (const b of r.boxes) console.log(`       ${tag} [${b.x},${b.y}] ${b.w}x${b.h} ${b.kind}:${b.name}`);
    }
  }
  await ctx.close();
}

await browser.close();
server.close();
console.log(failures === 0 ? "\n🎉 MAP CHROME CLEAN AT EVERY PROFILE\n" : `\n🔥 ${failures} PROFILE(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
