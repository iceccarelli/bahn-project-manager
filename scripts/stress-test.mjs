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
import os from "node:os";

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
  // The Dashboard has a map of its own now (the Netz-Explorer between the
  // counters and the relief), so the invariant is "exactly one", not "none":
  // a second container is a map that outlived the route that mounted it.
  await page.waitForSelector(".leaflet-container", { timeout: 30000 });
  const containers = await page.$$eval(".leaflet-container", (els) => els.length);
  assert(
    containers === 1,
    `${containers} map containers on the Dashboard — ${containers - 1} survived a route change`,
  );

  const nodes = await page.evaluate(() => document.getElementsByTagName("*").length);
  assert(nodes < 6000, `the Dashboard carries ${nodes} elements — something is accumulating`);
});

console.log("\n== the search keeps up with typing ==");

/**
 * Typing, judged against the same app on the same machine in the same minute.
 *
 * Three rounds of this gate were red on the developer's Codespace and green in
 * the sandbox that wrote it — 126 ms, then 64,5 ms against a 60 ms line drawn
 * from the sandbox's own numbers. The app was never the variable. Same build,
 * same word, measured side by side:
 *
 *   Sandbox, unbelastet     Median 16,6 ms
 *   Codespace nach Suite    Median 53,7 – 64,5 ms
 *
 * Four times the wall clock for identical work, and no absolute threshold
 * survives that. Two calibrations were tried and thrown away: the machine's
 * idle frame time stays at 16,7 ms however loaded it is, because an idle page
 * still gets its vsync; a synthetic CPU benchmark measured 6 ms whether or not
 * three other tabs were spinning, because the benchmark thread still gets a
 * core.
 *
 * What does survive is the app compared with itself. The Änderungshistorie is
 * 215 elements and no map; the Dashboard is 3.444 and draws 425 markers. Both
 * carry the same search box over the same index. Type the same word into both,
 * one after the other, and the ratio is a property of this build alone —
 * whatever the machine is doing, it is doing it to both measurements.
 *
 * Measured on the reference build: Historie 17,6 ms, Dashboard 16,6 ms.
 */
const typeInto = async (route, word) => {
  await go(route);
  await page.waitForSelector('[role="combobox"]', { timeout: 25000 });
  // The index is built from the loaded projects; typing before it exists
  // measures an empty search.
  await page
    .waitForFunction(() => /1\.\d{3}\s+Projekte/.test(document.body.innerText), null, {
      timeout: 120000,
    })
    .catch(() => {});
  await page.waitForTimeout(800);
  return page.evaluate(async (w) => {
    const input = document.querySelector('[role="combobox"]');
    if (!input) throw new Error("no combobox on the page");
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    const times = [];
    for (let i = 1; i <= w.length; i++) {
      const started = performance.now();
      setter?.call(input, w.slice(0, i));
      input?.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      times.push(performance.now() - started);
    }
    const sorted = [...times].sort((a, b) => a - b);
    return {
      median: sorted[Math.floor(sorted.length / 2)],
      worst: Math.max(...times),
      hits: document.querySelectorAll('[role="option"]').length,
    };
  }, word);
};

await check("typing stays as cheap on the heaviest page as on the lightest", async () => {
  const term = "Langenselbold";
  const light = await typeInto("/audit", term);
  const heavy = await typeInto("/", term);

  assert(light.hits > 0, "typing the whole station name found nothing on the light page");
  assert(heavy.hits > 0, "typing the whole station name found nothing on the Dashboard");

  const ratio = heavy.median / Math.max(light.median, 1);
  console.log(
    `       Tastenanschlag: Historie ${light.median.toFixed(1)} ms · Dashboard ${heavy.median.toFixed(1)} ms ` +
      `· Faktor ${ratio.toFixed(2)} · langsamster ${Math.max(light.worst, heavy.worst).toFixed(1)} ms`,
  );

  /*
   * 2,5x is the line, and it is drawn where a regression would show rather
   * than where this machine happens to sit. The map already cost a factor of
   * two once — 425 pulsing markers competing with the typing for frames — and
   * that is the shape of defect this is here to catch. Anything the two pages
   * share, including a slow machine, cancels.
   */
  assert(
    ratio < 2.5,
    `the Dashboard costs ${ratio.toFixed(2)}x the Änderungshistorie per keystroke ` +
      `(${heavy.median.toFixed(1)} ms against ${light.median.toFixed(1)} ms)`,
  );

  // And a floor no machine excuses: a search that takes a quarter second per
  // character is broken everywhere, not slow here.
  assert(
    heavy.median < 250,
    `the median keystroke took ${heavy.median.toFixed(1)} ms on the Dashboard`,
  );
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

console.log("\n== many people at once ==");

const cores = os.cpus().length;

/**
 * The app is client-side, so "many simultaneous users" is many browsers, each
 * with its own storage, all working the same 1,298 projects at the same time.
 *
 * Two failure modes this catches that one page never can:
 *   1. a query that is answered from module-level state rather than from the
 *      caller's argument — six sessions asking six different things and one
 *      of them getting somebody else's answer;
 *   2. an index built once per process rather than once per session, which
 *      looks fine alone and collapses when six of them build it at once.
 */
const seedSession = async (context, name) => {
  const p = await context.newPage();
  await p.goto(U("/login"));
  await p.evaluate(
    (who) =>
      localStorage.setItem(
        "bahn-demo-user",
        JSON.stringify({ id: 1, openId: who, name: who, email: "s@db.de", role: "admin" }),
      ),
    name,
  );
  return p;
};

/**
 * Drive the site-wide search on an already-loaded page and read what it found.
 *
 * Waits for the list to arrive rather than for a duration somebody guessed.
 * This container has 2 cores and these checks run six browsers at once, so a
 * fixed sleep measures the scheduler, not the search — the same mistake the
 * 44-pixel gate made, and it fails the same way: green here, red on the
 * reader's machine, or the reverse.
 */
const searchOn = (p, term, budgetMs = 25000) =>
  p.evaluate(
    async ([word, budget]) => {
      const input = document.querySelector('[role="combobox"]');
      if (!input) throw new Error("no combobox on the page");
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      const started = performance.now();
      setter?.call(input, word);
      input?.dispatchEvent(new Event("input", { bubbles: true }));
      const read = () =>
        [...document.querySelectorAll('[role="option"]')].map((o) =>
          (o.textContent || "").slice(0, 80),
        );
      let hits = [];
      while (performance.now() - started < budget) {
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        hits = read();
        if (hits.length > 0) break;
      }
      return { took: performance.now() - started, hits };
    },
    [term, budgetMs],
  );

await check("six sessions search at the same time and each gets its own answer", async () => {
  // Six distinct terms, each with an unmistakable fingerprint in the result.
  const work = [
    { term: "Bensheim", expect: /bensheim/i },
    { term: "Wetzlar", expect: /wetzlar/i },
    { term: "Fulda", expect: /fulda/i },
    { term: "Kassel", expect: /kassel/i },
    { term: "Wiesbaden", expect: /wiesbaden/i },
    { term: "Darmstadt", expect: /darmstadt/i },
  ];

  const contexts = [];
  const pages = [];
  let slowest = 0;
  try {
    for (let i = 0; i < work.length; i++) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      contexts.push(ctx);
      pages.push(await seedSession(ctx, `stress-${i}`));
    }
    // All six on the Dashboard, then all six typing at once — not one after
    // the other, which would prove nothing about simultaneity.
    await Promise.all(
      pages.map((p) => p.goto(U("/"), { waitUntil: "networkidle" })),
    );
    /*
     * The box, and then the data behind it.
     *
     * `[role="combobox"]` exists from the first paint; the index it searches
     * does not — 1,298 projects have to be read and validated first. Six cold
     * boots on two cores made that gap wide enough to type into: session 3
     * asked for "Kassel" against an empty index, got nothing, and the gate
     * called it cross-contamination. Waiting for the project count is waiting
     * for the thing that makes the answer possible.
     */
    await Promise.all(pages.map((p) => p.waitForSelector('[role="combobox"]', { timeout: 25000 })));
    await Promise.all(
      pages.map((p) =>
        p
          .waitForFunction(() => /1\.\d{3}\s+Projekte/.test(document.body.innerText), null, {
            timeout: 120000,
          })
          .catch(() => {}),
      ),
    );

    const results = await Promise.all(pages.map((p, i) => searchOn(p, work[i].term)));

    for (let i = 0; i < work.length; i++) {
      const { term, expect } = work[i];
      const { hits, took } = results[i];
      assert(
        hits.length > 0,
        `session ${i} searching "${term}" found nothing in ${took.toFixed(0)} ms — the index was not ready, or the search is broken`,
      );
      assert(
        hits.some((h) => expect.test(h)),
        `session ${i} searched "${term}" and got: ${hits.slice(0, 3).join(" | ")}`,
      );
      // Nobody else's term may appear in this session's list.
      for (let j = 0; j < work.length; j++) {
        if (j === i) continue;
        assert(
          !hits.some((h) => work[j].expect.test(h)),
          `session ${i} ("${term}") is showing results for "${work[j].term}"`,
        );
      }
      // Not a latency SLA: six browsers on two cores contend for a CPU no real
      // pair of users shares. What must hold is that every one of them
      // eventually answers, and answers its own question.
      slowest = Math.max(slowest, took);
    }
    console.log(`       six sessions answered; slowest ${slowest.toFixed(0)} ms on ${cores} cores`);
  } finally {
    for (const ctx of contexts) await ctx.close();
  }
});

await check("two tabs of one session keep their own search, and share one store", async () => {
  // Same context means one localStorage: the recipient overrides and the audit
  // trail are deliberately shared between tabs, and the search deliberately is
  // not. A tab that adopts the other tab's query has confused the two.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const a = await seedSession(ctx, "tab-a");
    const b = await ctx.newPage();
    await Promise.all([
      a.goto(U("/"), { waitUntil: "networkidle" }),
      b.goto(U("/"), { waitUntil: "networkidle" }),
    ]);
    await Promise.all([
      a.waitForSelector('[role="combobox"]', { timeout: 25000 }),
      b.waitForSelector('[role="combobox"]', { timeout: 25000 }),
    ]);
    // Same reason as above: the index has to exist before it can be searched.
    await Promise.all(
      [a, b].map((p) =>
        p
          .waitForFunction(() => /1\.\d{3}\s+Projekte/.test(document.body.innerText), null, {
            timeout: 120000,
          })
          .catch(() => {}),
      ),
    );

    const [ra, rb] = await Promise.all([searchOn(a, "Bensheim"), searchOn(b, "Kassel")]);
    assert(ra.hits.some((h) => /bensheim/i.test(h)), "tab A lost its own search");
    assert(rb.hits.some((h) => /kassel/i.test(h)), "tab B lost its own search");
    assert(!ra.hits.some((h) => /kassel/i.test(h)), "tab A adopted tab B's query");
    assert(!rb.hits.some((h) => /bensheim/i.test(h)), "tab B adopted tab A's query");

    // And the shared half is genuinely shared: what tab A writes, tab B reads
    // after a reload. This is the store the audit trail lives in.
    await a.evaluate(() => localStorage.setItem("stress_shared_probe", "written-by-a"));
    await b.reload({ waitUntil: "networkidle" });
    const seen = await b.evaluate(() => localStorage.getItem("stress_shared_probe"));
    assert(seen === "written-by-a", `tab B reads "${seen}" from the shared store`);
    await a.evaluate(() => localStorage.removeItem("stress_shared_probe"));
  } finally {
    await ctx.close();
  }
});

await check("a change in one tab reaches the other tab without a reload", async () => {
  /*
   * Two tabs share one localStorage but not one query cache. Before
   * useCrossTabSync, tab B kept showing the old status until it was reloaded —
   * two people at one desk reading figures that had already been overwritten.
   *
   * This is one browser, deliberately: two machines still do not see each
   * other's edits, because nothing is written to a server. The hook says so in
   * its own header, and this check does not pretend otherwise.
   */
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const a = await seedSession(ctx, "sync-a");
    const b = await ctx.newPage();
    await a.goto(U("/psv-itk"), { waitUntil: "domcontentloaded" });
    await b.goto(U("/psv-itk"), { waitUntil: "domcontentloaded" });
    await a.waitForSelector("table tbody tr", { timeout: 40000 });
    await b.waitForSelector("table tbody tr", { timeout: 40000 });

    const cell = "table tbody tr:first-child td:nth-child(13)";
    const before = (await b.locator(`${cell} button`).first().innerText()).trim();

    await a.locator(`${cell} button`).first().click();
    const select = a.locator(`${cell} select`).first();
    await select.waitFor({ timeout: 10000 });
    const current = await select.inputValue();
    const options = await select.locator("option").allTextContents();
    const next = options.find(
      (o) => o && o !== current && o !== "—" && o !== "nicht erforderlich",
    );
    assert(next, "no other status to choose");
    await select.selectOption(next);

    // No reload on B — the whole point. Waits for the value, not for a guessed
    // number of milliseconds.
    await b
      .waitForFunction(
        (want) => {
          const el = document.querySelector(
            "table tbody tr:first-child td:nth-child(13) button",
          );
          return (el?.textContent ?? "").includes(want);
        },
        next,
        { timeout: 15000 },
      )
      .catch(() => {});
    const after = (await b.locator(`${cell} button`).first().innerText()).trim();
    assert(
      after.includes(next),
      `tab B still reads "${after}" after tab A wrote "${next}" (was "${before}")`,
    );
  } finally {
    await ctx.close();
  }
});

await check("six sessions booting at once all reach the same totals", async () => {
  // The figure every page derives independently. Six cold boots in parallel
  // must produce six identical answers — a differing one means a race between
  // the data load and the first render, and that is a defect whatever the
  // machine. "networkidle" is deliberately not the wait here: with six
  // browsers on two cores it times out on contention alone, which says
  // nothing about the app. The table arriving is the actual condition.
  const contexts = [];
  try {
    const pages = [];
    for (let i = 0; i < 6; i++) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      contexts.push(ctx);
      pages.push(await seedSession(ctx, `boot-${i}`));
    }
    await Promise.all(
      pages.map((p) => p.goto(U("/projects"), { waitUntil: "domcontentloaded" })),
    );
    /*
     * Waits for the figure this check compares, not for a row to be painted.
     *
     * `waitForSelector("table tbody tr")` waits for VISIBILITY, and visibility
     * is a layout fact: on a loaded machine the 1,298 rows are in the DOM —
     * Playwright said so, "locator resolved to 1298 elements" — while the
     * first one has not been laid out yet, and the check failed after 90 s
     * having already had its answer. A gate whose result depends on the
     * renderer's queue is measuring the renderer, not the app.
     */
    const totals = await Promise.all(
      pages.map(async (p) => {
        /*
         * Two conditions, each waited for on its own terms.
         *
         * The figure and the rows behind it do not arrive together: with six
         * browsers on two cores the header paints while the 1,298 rows are
         * still being committed, and reading both at one instant reported
         * "(0 Zeilen, meldet 1.298 Projekte)" for a page that was perfectly
         * fine a second later. Each gets a generous window; only then are the
         * six answers compared.
         */
        await p
          .waitForFunction(
            () => /1\.\d{3}\s+Projekte/.test(document.body.innerText),
            null,
            { timeout: 120000 },
          )
          .catch(() => {});
        await p
          .waitForFunction(
            () => document.querySelectorAll("table tbody tr").length > 0,
            null,
            { timeout: 120000 },
          )
          .catch(() => {});
        const rows = await p.$$eval("table tbody tr", (els) => els.length);
        const text = await p.locator("body").innerText();
        const total = (text.match(/1\.\d{3}\s+Projekte/) || ["(none)"])[0];
        // A page that prints the total but never rendered a row is not the
        // same answer as one that did, and must not pass as identical.
        return rows > 0 ? total : `(keine Zeilen, meldet ${total})`;
      }),
    );
    const distinct = new Set(totals);
    assert(
      distinct.size === 1 && !distinct.has("(none)"),
      `six simultaneous boots reported: ${[...distinct].join(" / ")}`,
    );
    console.log(`       six simultaneous boots all read ${[...distinct][0]}`);
  } finally {
    for (const ctx of contexts) await ctx.close();
  }
});

console.log("\n== summary ==");
console.log(`${passed} passed, ${failures.length} failed`);
if (errors.length) console.log(`${errors.length} console error(s) observed`);
await browser.close();
server.close();
process.exit(failures.length ? 1 : 0);
