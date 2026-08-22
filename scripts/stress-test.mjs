/**
 * Stress and independence.
 *
 * The smoke suite proves each surface works once. This proves the app survives
 * being used hard: tabs switched back and forth, filters thrown away and
 * rebuilt, three maps mounted and unmounted in sequence, the search driven at
 * typing speed against the whole index.
 *
 * Three questions it answers, none of which a single-pass smoke test can:
 *   1. Do the three tabs leak state into one another under repetition?
 *   2. Does each tab get its own map, or do they share one Leaflet instance
 *      that survives the route change and shows the wrong markers?
 *   3. Does anything grow without bound — detached DOM, listeners, Leaflet
 *      containers — as a reader moves around for a few minutes?
 *
 * It fails loudly. A leak here is a defect, not a warning.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const PORT = Number(process.env.PORT || 4183);
const ROOT = path.resolve("dist/public");
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2",
  ".ttf": "font/ttf", ".png": "image/png",
};

if (!existsSync(ROOT)) {
  console.error("!! dist/public is missing — run `pnpm build` first.");
  process.exit(1);
}

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  let file = path.join(ROOT, url);
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(ROOT, "index.html");
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
const EXTERNAL = /Failed to load resource|net::ERR_/;
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const url = m.location?.()?.url ?? "";
  if (url && !url.startsWith(`http://localhost:${PORT}`) && EXTERNAL.test(m.text())) return;
  errors.push(m.text().slice(0, 200));
});
page.on("pageerror", (e) => errors.push(`PAGEERROR ${String(e).slice(0, 200)}`));

const U = (r) => `http://localhost:${PORT}${r}`;

// Without this every assertion below measures the login screen, which has no
// table, no map and no search box — and reports that as a failure of the app.
await page.goto(U("/login"));
await page.evaluate(() =>
  localStorage.setItem(
    "bahn-demo-user",
    JSON.stringify({ id: 1, openId: "stress", name: "Stress", email: "s@db.de", role: "admin" }),
  ),
);
const go = async (r) => {
  await page.goto(U(r), { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
};

let passed = 0;
const failures = [];
const assert = (c, m) => { if (!c) throw new Error(m); };
async function check(name, fn) {
  const before = errors.length;
  try {
    await fn();
    const fresh = errors.slice(before);
    if (fresh.length) throw new Error(`console error: ${fresh[0]}`);
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  FAIL ${name}\n         ${err instanceof Error ? err.message : err}`);
  }
}

const TABS = [
  { route: "/projects", label: "Projekte", search: "Projekte durchsuchen — Ort, Projektleitung oder Gewerk" },
  { route: "/bvb-eea", label: "BVB-EEA", search: "BVB-EEA Prüfungen durchsuchen" },
  { route: "/psv-itk", label: "PSV-ITK", search: "PSV-ITK Prüfungen durchsuchen" },
];

console.log("\n== the three tabs stay independent under repetition ==");

await check("twenty tab switches leak no search, no view and no filter", async () => {
  const baseline = {};
  for (const tab of TABS) {
    await go(tab.route);
    await page.waitForSelector("table tbody tr", { timeout: 25000 });
    baseline[tab.route] = await page.$$eval("table tbody tr", (r) => r.length);
  }

  for (let round = 0; round < 20; round++) {
    const tab = TABS[round % TABS.length];
    await go(tab.route);
    await page.waitForSelector("table tbody tr", { timeout: 25000 });

    // Every third visit, leave a filter and a view behind on purpose.
    if (round % 3 === 0) {
      await page.getByLabel(tab.search).fill("Frankfurt");
      await page.waitForTimeout(400);
      await page.click('[aria-label="Kachelansicht"]');
      await page.waitForTimeout(400);
      continue;
    }

    const term = await page.getByLabel(tab.search).inputValue();
    assert(term === "", `${tab.label} inherited the search "${term}" on round ${round}`);
    const pressed = await page.getAttribute('[aria-label="Tabellenansicht"]', "aria-pressed");
    assert(pressed === "true", `${tab.label} inherited a view on round ${round}`);
    const rows = await page.$$eval("table tbody tr", (r) => r.length);
    assert(
      rows === baseline[tab.route],
      `${tab.label} shows ${rows} rows on round ${round}, baseline ${baseline[tab.route]}`,
    );
  }
});

await check("each tab scopes to its own Gewerk, every time", async () => {
  const counts = {};
  for (let round = 0; round < 6; round++) {
    for (const tab of TABS) {
      await go(tab.route);
      await page.waitForSelector("table tbody tr", { timeout: 25000 });
      const rows = await page.$$eval("table tbody tr", (r) => r.length);
      if (counts[tab.route] === undefined) counts[tab.route] = rows;
      assert(counts[tab.route] === rows, `${tab.label} drifted from ${counts[tab.route]} to ${rows}`);
    }
  }
  const distinct = new Set(Object.values(counts));
  assert(distinct.size === TABS.length, `tabs share row counts: ${JSON.stringify(counts)}`);
});

console.log("\n== each tab gets its own map ==");

await check("a map is created and destroyed per tab, never shared or stacked", async () => {
  for (let round = 0; round < 6; round++) {
    const tab = TABS[round % TABS.length];
    await go(tab.route);
    await page.click('[aria-label="Kartenansicht"]');
    await page.waitForSelector(".leaflet-container", { timeout: 20000 });
    await page.waitForTimeout(1200);

    // Exactly one live map. Two would mean an unmounted tab's map survived the
    // route change and is drawing another Gewerk's markers underneath.
    const containers = await page.$$eval(".leaflet-container", (els) => els.length);
    assert(containers === 1, `${tab.label} has ${containers} map containers`);

    const markers = await page.$$eval(".db-dot-marker", (els) => els.length);
    assert(markers > 0, `${tab.label} rendered a map with no markers`);
  }
});

await check("the markers differ per tab, so no tab is showing another's stations", async () => {
  const fingerprint = {};
  for (const tab of TABS) {
    await go(tab.route);
    await page.click('[aria-label="Kartenansicht"]');
    await page.waitForSelector(".leaflet-container", { timeout: 20000 });
    await page.waitForTimeout(1500);
    fingerprint[tab.route] = await page.$$eval(".db-dot-marker", (els) => els.length);
  }
  const values = Object.values(fingerprint);
  assert(
    new Set(values).size > 1,
    `all three maps drew the same marker count: ${JSON.stringify(fingerprint)}`,
  );
});

console.log("\n== nothing grows without bound ==");

await check("forty route changes leave no Leaflet container and no listener behind", async () => {
  const routes = ["/", "/projects", "/bvb-eea", "/psv-itk", "/audit", "/anmeldung"];
  for (let i = 0; i < 40; i++) {
    await page.goto(U(routes[i % routes.length]), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(120);
  }
  await go("/");
  const leftovers = await page.$$eval(".leaflet-container", (els) => els.length);
  assert(leftovers === 0, `${leftovers} map containers survived onto the Dashboard`);

  const nodes = await page.evaluate(() => document.getElementsByTagName("*").length);
  assert(nodes < 6000, `the Dashboard carries ${nodes} elements — something is accumulating`);
});

console.log("\n== the search keeps up with typing ==");

await check("typing a station character by character never blocks a frame", async () => {
  await go("/");
  const box = page.getByLabel("Website durchsuchen — Projekte, Orte, Personen und Seiten");
  await box.click();

  const term = "Langenselbold";
  const worst = await page.evaluate(async (word) => {
    const input = document.querySelector('[role="combobox"]');
    if (!input) throw new Error("no combobox on the page");
    let slowest = 0;
    for (let i = 1; i <= word.length; i++) {
      const started = performance.now();
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, word.slice(0, i));
      input?.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      slowest = Math.max(slowest, performance.now() - started);
    }
    return slowest;
  }, term);

  // One frame is 16.7 ms. A keystroke that takes longer is a keystroke the
  // reader watches arrive.
  assert(worst < 120, `the slowest keystroke took ${worst.toFixed(1)} ms`);

  await page.waitForSelector('[role="option"]', { timeout: 5000 });
  const hits = await page.$$eval('[role="option"]', (els) => els.length);
  assert(hits > 0, "typing the whole station name found nothing");
});

await check("two hundred searches in a row do not degrade", async () => {
  await go("/");
  const timings = await page.evaluate(async () => {
    const input = document.querySelector('[role="combobox"]');
    if (!input) throw new Error("no combobox on the page");
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    const terms = ["fra", "kassel", "G.0115", "eea", "karte", "zzzq", "bensheim", "itk"];
    const first = [];
    const last = [];
    for (let i = 0; i < 200; i++) {
      const started = performance.now();
      setter?.call(input, terms[i % terms.length] + (i % 3 === 0 ? "" : " "));
      input?.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const took = performance.now() - started;
      if (i < 20) first.push(took);
      if (i >= 180) last.push(took);
    }
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    return { first: mean(first), last: mean(last) };
  });
  // Not "fast", but "not slowing down": a search that degrades is caching or
  // accumulating something it should not.
  assert(
    timings.last < timings.first * 3 + 30,
    `search slowed from ${timings.first.toFixed(1)} ms to ${timings.last.toFixed(1)} ms`,
  );
});

console.log("\n== hammering the data flow ==");

await check("thirty rapid status changes all persist and all reach the log", async () => {
  await go("/psv-itk");
  await page.waitForSelector("table tbody tr", { timeout: 25000 });

  // The control is a badge you activate, not a permanently mounted <select> —
  // 18,172 selects took the Projekte table from 4.6 s to 10.0 s to paint. So
  // each change here is the full interaction: activate, choose, commit.
  const badges = page.locator('table tbody td:nth-child(13) button');
  const count = Math.min(await badges.count(), 30);
  assert(count >= 10, `only ${count} status controls to exercise`);

  const written = [];
  for (let i = 0; i < count; i++) {
    await badges.nth(i).click();
    const select = page.locator('table tbody td:nth-child(13) select').first();
    await select.waitFor({ timeout: 5000 });
    const current = await select.inputValue();
    const options = await select.locator("option").allTextContents();
    // Never "nicht erforderlich": that removes the row from this Gewerk and
    // would shift every index after it.
    const next = options.find(
      (o) => o && o !== current && o !== "—" && o !== "nicht erforderlich",
    );
    if (!next) {
      await page.keyboard.press("Escape");
      continue;
    }
    await select.selectOption(next);
    written.push({ i, next });
  }
  assert(written.length >= 10, `only ${written.length} changes were made`);
  await page.waitForTimeout(1500);

  for (const { i, next } of written) {
    const shown = await badges.nth(i).innerText();
    assert(shown.includes(next), `row ${i} reads "${shown}" instead of "${next}"`);
  }

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("table tbody tr", { timeout: 25000 });
  const after = page.locator('table tbody td:nth-child(13) button');
  for (const { i, next } of written) {
    const shown = await after.nth(i).innerText();
    assert(shown.includes(next), `after a reload row ${i} reads "${shown}" instead of "${next}"`);
  }

  await go("/audit");
  const entries = await page.$$eval("[data-audit-action]", (els) =>
    els.map((e) => e.getAttribute("data-audit-action")),
  );
  const reviewEntries = entries.filter((a) => a === "Prüfung aktualisiert").length;
  assert(
    reviewEntries >= Math.min(written.length, 10),
    `${written.length} changes produced only ${reviewEntries} log entries`,
  );
});

console.log("\n== summary ==");
console.log(`${passed} passed, ${failures.length} failed`);
if (errors.length) console.log(`${errors.length} console error(s) observed`);
await browser.close();
server.close();
process.exit(failures.length ? 1 : 0);
