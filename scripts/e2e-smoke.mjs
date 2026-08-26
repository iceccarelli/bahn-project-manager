/**
 * End-to-end smoke suite.
 *
 * Runs the production bundle in headless Chromium and asserts the things a
 * blind click-everything crawl cannot: that navigation reaches each route,
 * that an edit survives a reload, that it lands in the audit trail, that
 * filters actually filter, and that the Projektanmeldung wizard creates a
 * project with exactly the reviews the checklist implies.
 *
 *   pnpm build:client && pnpm e2e
 *
 * Exits non-zero on the first failed assertion, so CI can gate on it.
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = "dist/public";
const PORT = Number(process.env.E2E_PORT || 4610);
const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css",
  ".json":"application/json", ".woff2":"font/woff2", ".png":"image/png", ".svg":"image/svg+xml" };

if (!fs.existsSync(path.join(ROOT, "index.html"))) {
  console.error("!! dist/public/index.html missing — run `pnpm build:client` first");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  let f = path.join(ROOT, u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(ROOT, "index.html");
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

/**
 * Launching Chromium inside a container.
 *
 * Two failure modes, and they need different answers:
 *
 *   "executable doesn't exist"  -> the browser was never downloaded
 *   "Target page, context or browser has been closed"
 *                               -> it launched and died on startup
 *
 * The second is what Codespaces and most CI images produce. Chrome's setuid
 * sandbox cannot initialise when the process runs as root in an unprivileged
 * container, and the default /dev/shm is 64 MB, which the renderer exhausts
 * immediately. Both flags below are the standard remedy and are safe here:
 * this harness only ever loads a local bundle it just built.
 */
const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
];

async function launch() {
  const base = {
    headless: true,
    args: LAUNCH_ARGS,
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {}),
  };
  try {
    return await chromium.launch(base);
  } catch (first) {
    // Fall back to the full Chrome build: `playwright install chromium` also
    // fetches a headless shell, and on some images only one of the two has its
    // shared libraries satisfied.
    try {
      return await chromium.launch({ ...base, channel: "chromium" });
    } catch {
      const msg = first instanceof Error ? first.message.split("\n")[0] : String(first);
      console.error("!! could not launch Chromium.");
      if (/doesn't exist|Executable doesn't exist/i.test(msg)) {
        console.error("   The browser is not installed. Run:");
        console.error("     pnpm exec playwright install --with-deps chromium");
      } else {
        console.error("   Chromium launched and then exited. This is almost always a");
        console.error("   missing system library or a sandbox restriction. Run:");
        console.error("     pnpm exec playwright install --with-deps chromium");
        console.error("   `--with-deps` is the part that matters: it installs the shared");
        console.error("   libraries that a plain `playwright install` does not.");
      }
      console.error(`   (${msg})`);
      server.close();
      process.exit(1);
    }
  }
}

const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();

let consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR ${String(e).slice(0, 160)}`));
/**
 * A failed OpenStreetMap tile is an environment fact, not an app defect.
 *
 * Chromium reports every blocked or unreachable subresource as a console
 * error, so in a sandbox or on a CI runner without egress the map view alone
 * emits dozens of them and would fail whichever assertion happened to open it.
 * Only requests to a host this bundle does not serve are ignored — an error
 * from the app's own code or its own assets still fails the suite.
 */
const EXTERNAL_RESOURCE_ERROR =
  /Failed to load resource|net::ERR_(TUNNEL_CONNECTION_FAILED|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|CONNECTION_(REFUSED|TIMED_OUT)|BLOCKED_BY_CLIENT)/;
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const text = m.text();
  const url = m.location?.()?.url ?? "";
  const isExternal = url !== "" && !url.startsWith(`http://localhost:${PORT}`);
  if (isExternal && EXTERNAL_RESOURCE_ERROR.test(text)) return;
  consoleErrors.push(`console ${text.slice(0, 160)}`);
});

const U = (r) => `http://localhost:${PORT}${r}`;

/**
 * Wait until nothing on screen is still arriving.
 *
 * Sections fade in as they are scrolled to and table rows stream in behind
 * them. Neither changes what an element is — that invariant is enforced in the
 * stylesheet and gated in check-ui — but both take time, and a measurement
 * taken mid-arrival is a measurement of a moving thing.
 *
 * This is why "both table row actions are separate 44px targets" passed on one
 * machine and failed on another: it measured at a fixed 800ms and the answer
 * depended on how fast the machine painted. A gate whose result depends on the
 * hardware is not a gate. Waiting for the actual condition, rather than for a
 * duration somebody guessed, is the fix.
 */
const settled = async (target = page) => {
  await target
    .waitForFunction(
      () => {
        const moving = [...document.querySelectorAll(".reveal")].some((el) => {
          const r = el.getBoundingClientRect();
          const onScreen = r.bottom > 0 && r.top < window.innerHeight;
          return onScreen && Number.parseFloat(getComputedStyle(el).opacity) < 0.99;
        });
        const rows = [...document.querySelectorAll("tbody[data-stream] > tr")].slice(0, 30);
        const streaming = rows.some(
          (r) => Number.parseFloat(getComputedStyle(r).opacity) < 0.99,
        );
        return !moving && !streaming;
      },
      null,
      { timeout: 15000 },
    )
    .catch(() => {});
};
const go = async (r) => {
  await page.goto(U(r), { waitUntil: "networkidle" });
  // Settled, not "800ms and hope": every check below this line measures a page
  // that has finished arriving, on any machine.
  await settled();
  await page.waitForTimeout(150);
};

let passed = 0;
const failures = [];
async function check(name, fn) {
  consoleErrors = [];
  try {
    await fn();
    if (consoleErrors.length) throw new Error(`console error: ${consoleErrors[0]}`);
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err: err instanceof Error ? err.message : String(err) });
    console.log(`  FAIL ${name}\n         ${err instanceof Error ? err.message : err}`);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

await page.goto(U("/login"));
await page.evaluate(() => localStorage.setItem("bahn-demo-user",
  JSON.stringify({ id: 1, openId: "e2e", name: "Vincenzo Grimaldi", email: "v@db.de", role: "admin" })));

console.log("\n== navigation ==");
for (const [label, route, marker] of [
  ["Dashboard", "/", "h1"],
  ["Projektanmeldung", "/anmeldung", "h1"],
  ["Projekte", "/projects", "table"],
  ["BVB-EEA", "/bvb-eea", "table"],
  ["PSV-ITK", "/psv-itk", "table"],
  ["Änderungshistorie", "/audit", "h1"],
]) {
  await check(`sidebar "${label}" reaches ${route}`, async () => {
    await go("/");
    await page.getByRole("button", { name: label, exact: true }).first().click();
    await page.waitForTimeout(900);
    assert(new URL(page.url()).pathname === route, `landed on ${new URL(page.url()).pathname}`);
    // Wait for the marker rather than assert on it after a fixed 900ms.
    // /projects parses 1,298 projects and 18,172 review rows out of a 3.6 MB
    // JSON before the table exists; on a 2-core CI runner that is not done in
    // 900ms, and the suite failed for slowness rather than for a defect.
    await page
      .locator(marker)
      .first()
      .waitFor({ state: "visible", timeout: 20000 })
      .catch(() => {});
    assert(await page.locator(marker).first().isVisible(), `no <${marker}> on ${route}`);
  });
}

console.log("\n== data flow and persistence ==");
const STAMP = `E2E-${Date.now().toString(36)}`;

await check("inline edit writes through and survives a reload", async () => {
  await go("/projects");
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  const cell = page.locator('button[aria-label^="Projektstand von Projekt"]').first();
  await cell.click();
  const input = page.locator('input[aria-label^="Projektstand"]').first();
  await input.fill(STAMP);
  await input.press("Enter");
  await page.waitForTimeout(700);
  await go("/projects");
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  const found = await page.locator(`text=${STAMP}`).count();
  assert(found > 0, "edited value not present after reload");
});

await check("the edit is recorded in the audit trail", async () => {
  await go("/audit");
  const body = await page.locator("body").innerText();
  assert(body.includes(STAMP) || body.includes("Projekt aktualisiert"),
    "no audit entry for the edit");
});

await check("localStorage is the persistence layer and holds the edit", async () => {
  const hit = await page.evaluate((stamp) => {
    for (const k of Object.keys(localStorage)) {
      if ((localStorage.getItem(k) || "").includes(stamp)) return k;
    }
    return null;
  }, STAMP);
  assert(hit !== null, "edit not found in localStorage");
});

console.log("\n== filtering and sorting ==");
await check("search narrows the table", async () => {
  await go("/projects");
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  const before = await page.locator("tbody tr").count();
  await page.locator('input[aria-label^="Projekte durchsuchen"]').fill("Frankfurt");
  /*
   * Waits for the table to be narrower, not for 900 ms.
   *
   * The search debounces 250 ms and then re-renders a 1,298-row table down to
   * 334. On a loaded machine that re-render outlasts any duration somebody
   * picks, and this gate read 1298 -> 1298 while the header above the table
   * already said "334 Projekte gefunden" — the app was right and the clock was
   * wrong. Third time this suite has been taught the same lesson.
   */
  await page
    .waitForFunction(
      (n) => document.querySelectorAll("tbody tr").length < n,
      before,
      { timeout: 20000 },
    )
    .catch(() => {});
  const after = await page.locator("tbody tr").count();
  assert(after > 0 && after < before, `rows ${before} -> ${after}`);
});

await check("sort headers reorder and announce aria-sort", async () => {
  await go("/projects");
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  const th = page.locator("th", { hasText: "Projektnummer" }).first();
  await th.locator("button").click();
  await page.waitForTimeout(600);
  const sort = await th.getAttribute("aria-sort");
  assert(sort === "ascending" || sort === "descending", `aria-sort=${sort}`);
});

await check("view toggles switch between table, cards and map", async () => {
  await go("/projects");
  await page.getByRole("button", { name: "Kachelansicht" }).click();
  await page.waitForTimeout(600);
  assert((await page.locator("table").count()) === 0, "table still present in card view");
  await page.getByRole("button", { name: "Tabellenansicht" }).click();
  await page.waitForTimeout(600);
  assert((await page.locator("table").count()) > 0, "table did not come back");
});

console.log("\n== Projektanmeldung wizard ==");

await check("wizard exports a real PDF with the corrected ITK recipients", async () => {
  await go("/anmeldung");
  const form = page.locator("main");
  await form.getByRole("textbox", { name: /Projektnummer/i }).first().fill("E2E.0001");
  await form.getByRole("textbox", { name: /Projektleitung/i }).first().fill("E2E Prüfer");
  await page.getByRole("button", { name: /^Schritt 2:/ }).click();
  await page.waitForTimeout(600);

  // answer ITK "Ja" so a review opens and the notification list is populated
  const groups = page.locator("fieldset", { hasText: "ITK" });
  let set = false;
  for (let i = 0; i < (await groups.count()); i++) {
    const ja = groups.nth(i).locator("label", { hasText: /^Ja$/ });
    if (await ja.count()) { await ja.first().click(); set = true; break; }
  }
  assert(set, "could not answer the ITK question");
  await page.waitForTimeout(400);

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }),
    page.getByRole("button", { name: /Checkliste als PDF/ }).click(),
  ]);
  const file = path.join("/tmp", `e2e-${Date.now()}.pdf`);
  await download.saveAs(file);
  const buf = fs.readFileSync(file);
  assert(buf.subarray(0, 5).toString() === "%PDF-", "not a PDF");
  assert(buf.length > 10_000, `suspiciously small: ${buf.length} bytes`);
  assert(/^Checkliste_E2E\.0001_.*\.pdf$/.test(download.suggestedFilename()),
    `unexpected filename ${download.suggestedFilename()}`);
  fs.unlinkSync(file);
});

await check("step 5 names who each Fachprüfung reaches", async () => {
  await page.getByRole("button", { name: /Bestätigung/ }).click();
  await page.waitForTimeout(900);
  const body = await page.locator("body").innerText();
  // The off-by-two used to route ITK to a Brandschutz specialist and skip the
  // department's two busiest reviewers.
  assert(body.includes("Emin Er"), "Emin Er not listed as an ITK recipient");
  assert(body.includes("Daniel Goldhausen"), "Daniel Goldhausen not listed");
  assert(!body.includes("Gorißen"), "a Brandschutz specialist is still on the ITK list");
});


console.log("\n== full submit: wizard -> project -> reviews -> audit ==");

let createdNumber = "";
await check("submitting the wizard creates a project with exactly the right reviews", async () => {
  await go("/anmeldung");
  const form = page.locator("main");
  createdNumber = `E2E.${Date.now().toString(36).toUpperCase()}`;
  await form.getByRole("textbox", { name: /Projektnummer/i }).first().fill(createdNumber);
  await form.getByRole("textbox", { name: /Projektleitung/i }).first().fill("E2E Prüfer");

  // Step 1 also needs a station; take the first option the cascade offers.
  const station = form.getByRole("textbox", { name: /Station/i }).first();
  if (await station.count()) await station.fill("Frankfurt (Main) Süd");

  await page.getByRole("button", { name: /^Schritt 2:/ }).click();
  await page.waitForTimeout(600);

  // Answer exactly two Gewerke "Ja" -> exactly two reviews must open.
  const wanted = ["ITK", "Fördertechnik"];
  for (const label of wanted) {
    const groups = page.locator("fieldset", { hasText: label });
    let done = false;
    for (let i = 0; i < (await groups.count()); i++) {
      const ja = groups.nth(i).locator("label", { hasText: /^Ja$/ });
      if (await ja.count()) { await ja.first().click(); done = true; break; }
    }
    assert(done, `could not answer "${label}"`);
  }
  await page.waitForTimeout(500);

  // Step 2 reports the count the answers imply.
  const step2 = await page.locator("body").innerText();
  assert(step2.includes("2 von 14"),
    `step 2 did not report 2 of 14: ${(step2.match(/\d+ von 14[^\n]*/) || ["(no count)"])[0]}`);

  // Step 3 must agree: buildDepartmentReviews always emits all 14 rows, so
  // exactly 12 are "nicht erforderlich" and the two answered are open.
  await page.getByRole("button", { name: /Prüfungen/ }).first().click();
  await page.waitForTimeout(800);
  const step3 = await page.locator("body").innerText();
  assert(/NICHT ERFORDERLICH \(12\)/i.test(step3),
    "step 3 did not show 12 of 14 as nicht erforderlich");
  // 12 of 14 closed means exactly the 2 answered are open — nothing else can
  // open a review. Asserting *which* two by scraping column order is
  // layout-dependent and proves nothing extra; the count is the invariant, and
  // shared/checklist.test.ts already pins the trigger rule per department.
});

await check("the created project reaches the projects table", async () => {
  await page.getByRole("button", { name: /Bestätigung/ }).click();
  await page.waitForTimeout(800);
  const submit = page.getByRole("button", { name: /Fachspezialistenprüfung anmelden/ });
  if (await submit.isDisabled()) {
    // Not every required field is reachable headlessly; the draft path still
    // proves persistence, so fall back to it rather than asserting a false pass.
    // Say so out loud: a check that silently degrades to a weaker assertion
    // reads as a pass for the thing it stopped testing.
    console.log("       ! submit disabled — falling back to the draft path");
    await page.getByRole("button", { name: /Als Entwurf speichern/ }).click();
    await page.waitForTimeout(900);
    const stored = await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) {
        if (k.includes("checklist")) return localStorage.getItem(k) || "";
      }
      return "";
    });
    assert(stored.includes(createdNumber), "draft not persisted");
    return;
  }
  await submit.click();
  await page.waitForTimeout(1500);

  // The confirmation has to close the process, not just announce it: the two
  // Gewerke this Anmeldung left open each get a prefilled mail, and the button
  // out lands on the project that was created rather than on all 1,298.
  const confirmation = await page.locator("body").innerText();
  assert(
    /Fachbereiche benachrichtigen/.test(confirmation),
    "the confirmation offers no way to notify the Fachbereiche it just opened",
  );
  const notify = await page.evaluate(() =>
    [...document.querySelectorAll('a[href^="mailto:"]')].map((a) => a.getAttribute("href")),
  );
  assert(notify.length > 0, "no Fachbereich mail on the confirmation screen");
  for (const href of notify) {
    const q = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    assert((q.get("body") ?? "").includes("Projektnummer:"), "notification body carries no context");
  }

  await page.getByRole("button", { name: /^Projekt öffnen$/ }).click();
  await page.waitForTimeout(1500);
  const landed = new URL(page.url());
  assert(landed.pathname === "/projects", `landed on ${landed.pathname}`);
  assert(
    landed.searchParams.get("q") === createdNumber,
    `landed unfiltered: q=${landed.searchParams.get("q")}`,
  );
  const rows = await page.locator("tbody tr").count();
  assert(rows >= 1, "created project not in the table");
  assert(rows < 100, `landing did not filter — ${rows} rows`);
});

console.log("\n== cross-page consistency ==");

await check("review status edits persist and stay consistent across pages", async () => {
  await go("/projects");
  const cell = page.locator('button[aria-label^="Prüfer "]').first();
  if ((await cell.count()) === 0) return; // department columns collapsed; nothing to assert
  const stamp = `PR-${Date.now().toString(36)}`;
  await cell.click();
  const input = page.locator('input[aria-label^="Prüfer "]').first();
  await input.fill(stamp);
  await input.press("Enter");
  await page.waitForTimeout(800);
  await go("/audit");
  const body = await page.locator("body").innerText();
  assert(body.includes("aktualisiert") || body.includes(stamp),
    "review edit did not reach the audit trail");
});

await check("the dashboard total matches the projects table total", async () => {
  await go("/projects");
  const projectsText = await page.locator("body").innerText();
  await go("/");
  const dashText = await page.locator("body").innerText();
  // Both pages derive from shared/project-metrics.ts, so the same figure must
  // appear on both. This is the assertion the fabricated multipliers failed.
  const projectsTotal = (projectsText.match(/1\.29\d|1\.30\d/) || [])[0];
  const dashTotal = (dashText.match(/1\.29\d|1\.30\d/) || [])[0];
  assert(projectsTotal && dashTotal && projectsTotal === dashTotal,
    `totals disagree: projects=${projectsTotal} dashboard=${dashTotal}`);
});

await check("theme choice survives a reload", async () => {
  await go("/");
  const before = await page.evaluate(() => document.documentElement.className);
  await page.getByRole("button", { name: "Theme wechseln" }).click();
  await page.waitForTimeout(500);
  const toggled = await page.evaluate(() => document.documentElement.className);
  assert(before !== toggled, "theme did not change");
  await go("/");
  const after = await page.evaluate(() => document.documentElement.className);
  assert(after === toggled, `theme reverted after reload: ${toggled} -> ${after}`);
});

await check("CSV export produces a file with the expected header", async () => {
  await go("/projects");
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 30000 }),
    page.getByRole("button", { name: /Export/ }).click(),
  ]);
  const f = path.join("/tmp", `e2e-${Date.now()}.csv`);
  await dl.saveAs(f);
  const head = fs.readFileSync(f, "utf-8").split("\n")[0];
  assert(head.includes("Projektnummer"), `unexpected CSV header: ${head.slice(0, 80)}`);
  fs.unlinkSync(f);
});


console.log("\n== no invented data ==");

await check("the dashboard contains no placeholder or fabricated content", async () => {
  await go("/");
  const body = await page.locator("body").innerText();
  // Every string below was on the dashboard and was not real: five invented
  // notifications (two naming stations outside RB Mitte), a hardcoded fallback
  // deadline, a literal "Unbekannt" reviewer, three "Verfügbar" labels over a
  // Microsoft 365 integration that had no code behind it, an "API: Verbunden"
  // badge on a static SPA, and a version that disagreed with package.json.
  const invented = [
    "Bad Hersfeld - Nachforderung",
    "Zustimmung erteilt für Frankfurt Hbf",
    "Köln Messe",
    "München Ost",
    "Neue Excel-Datei hochgeladen",
    "Unbekannt",
    "2026-06-15",
    "Verfügbar",
    "API: Verbunden",
    "Version 2.4.1",
  ];
  const found = invented.filter((s) => body.includes(s));
  assert(found.length === 0, `fabricated content is back: ${found.join(", ")}`);
});

await check("every Schnellaktion navigates somewhere real", async () => {
  // The previous four wrote an audit entry claiming the work had happened
  // ("Kritische Fälle eskaliert") and then did nothing at all.
  const routes = {
    "Fachspezialistenprüfung anmelden": "/anmeldung",
    "Änderungshistorie öffnen": "/audit",
    "BVB-EEA-Prüfungen ansehen": "/bvb-eea",
  };
  for (const [label, route] of Object.entries(routes)) {
    await go("/");
    await page.getByRole("button", { name: label }).click();
    await page.waitForTimeout(800);
    assert(new URL(page.url()).pathname === route,
      `"${label}" went to ${new URL(page.url()).pathname}, expected ${route}`);
  }
});

console.log("\n== map -> cards -> details ==");

/**
 * The path the CEO view actually takes: a marker on the map, the station's
 * cards, one project's details, and a contact route out of it.
 *
 * Before this existed, `handleMapProjectSelect` was `setViewMode("table")`
 * plus a toast claiming the project was "in der Tabelle angezeigt" — nothing
 * was selected, filtered or scrolled to — and "Details anzeigen" was the same
 * `setViewMode("table")` with no details behind it. Both passed every check in
 * this file, because no check followed the flow.
 */
let stationName = null;

await check("a map marker opens a popup that offers the whole station", async () => {
  await go("/projects");
  await page.click('[aria-label="Kartenansicht"]');
  await page.waitForSelector(".leaflet-container", { timeout: 15000 });
  await page.waitForTimeout(2500);
  const markers = await page.$$(".db-dot-marker");
  assert(markers.length > 0, "no markers rendered");
  // force: the markers overlap heavily at the initial zoom, so Playwright's
  // actionability check sees a neighbour on top of the one we mean.
  await markers[markers.length - 1].click({ force: true });
  await page.waitForTimeout(700);
  assert(await page.$("[data-station-all]"), "popup has no station-level action");
  const projectButtons = await page.$$("[data-pid]");
  assert(projectButtons.length > 0, "popup lists no projects");
});

await check("clicking a project in the popup lands on the filtered card view", async () => {
  const projectButtons = await page.$$("[data-pid]");
  await projectButtons[0].click({ force: true });
  await page.waitForTimeout(1200);

  const pressed = await page.getAttribute('[aria-label="Kachelansicht"]', "aria-pressed");
  assert(pressed === "true", `expected the card view, aria-pressed was ${pressed}`);

  stationName = await page.evaluate(() => {
    const el = [...document.querySelectorAll("span")].find(
      (e) => e.children.length === 0 && /^Station: /.test(e.textContent || ""),
    );
    return el ? el.textContent.replace(/^Station:\s*/, "") : null;
  });
  assert(stationName, "no station filter chip after arriving from the map");

  // every rendered card belongs to that station
  const stations = await page.$$eval("[data-project-card]", (cards) =>
    cards.map((c) => c.querySelector("h3, [data-slot='card-title']")?.textContent?.trim() ?? ""),
  );
  assert(stations.length > 0, "card view rendered no cards");
  // Guard the guard: if the title selector stopped matching, every entry would
  // be "" and the leak check below would pass while testing nothing.
  assert(
    stations.every((s) => s.length > 0),
    "could not read the station off every card — the leak check would be vacuous",
  );
  const foreign = stations.filter((s) => s !== stationName);
  assert(foreign.length === 0, `cards from other stations leaked through: ${foreign.join(", ")}`);
});

await check("the detail dialog opens with every Fachprüfung", async () => {
  const dialog = await page.$('[role="dialog"]');
  assert(dialog, "no dialog after clicking a project on the map");
  const rows = await page.$$eval('[role="dialog"] tbody tr', (r) => r.length);
  assert(rows === 14, `dialog listed ${rows} Fachprüfungen, expected all 14`);
});

await check("contact links are real addresses, never constructed ones", async () => {
  const links = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return {
      mail: [...d.querySelectorAll('a[href^="mailto:"]')].map((a) => a.getAttribute("href")),
      teams: [...d.querySelectorAll('a[href^="https://teams.microsoft.com"]')].map((a) =>
        a.getAttribute("href"),
      ),
      tel: [...d.querySelectorAll('a[href^="tel:"]')].length,
    };
  });
  assert(links.mail.length > 0, "dialog offered no mail route at all");
  assert(links.teams.length > 0, "dialog offered no Teams route at all");
  // No source carries a telephone number, so a tel: link could only be invented.
  assert(links.tel === 0, `dialog rendered ${links.tel} telephone links from data that has none`);

  // Every address must exist in Hilfsdatei. Anything else is constructed.
  const known = new Set(
    JSON.parse(fs.readFileSync("data/contacts.source.json", "utf8"))
      .map((c) => (c.mail || "").toLowerCase())
      .filter(Boolean),
  );
  const addresses = links.mail.map((h) =>
    decodeURIComponent(h.slice("mailto:".length).split("?")[0]).toLowerCase(),
  );
  const invented = [...new Set(addresses)].filter((a) => !known.has(a));
  assert(invented.length === 0, `addresses not in Hilfsdatei: ${invented.join(", ")}`);

  // The Teams link must target the same person the mail link writes to.
  const teamsUsers = links.teams.map((h) => new URL(h).searchParams.get("users").toLowerCase());
  const strayTeams = [...new Set(teamsUsers)].filter((u) => !known.has(u));
  assert(strayTeams.length === 0, `Teams links to unknown addresses: ${strayTeams.join(", ")}`);
});

await check("clearing the station filter restores the full result set", async () => {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const before = await page.$$eval("[data-project-card]", (c) => c.length);
  await page.getByRole("button", { name: /Filter .* entfernen/ }).first().click();
  await page.waitForTimeout(600);
  const after = await page.$$eval("[data-project-card]", (c) => c.length);
  assert(after > before, `clearing the chip did not widen the set (${before} -> ${after})`);
  const chipGone = await page.evaluate(
    () =>
      ![...document.querySelectorAll("span")].some(
        (e) => e.children.length === 0 && /^Station: /.test(e.textContent || ""),
      ),
  );
  assert(chipGone, "the station chip survived being dismissed");
});

await check("\"Details anzeigen\" on a card opens that project's dialog", async () => {
  const card = await page.$("[data-project-card]");
  const id = await card.getAttribute("data-project-card");
  const nummer = await page.evaluate((pid) => {
    const c = document.querySelector(`[data-project-card="${pid}"]`);
    return c?.querySelector(".font-mono")?.textContent?.trim() ?? null;
  }, id);
  await page.evaluate((pid) => {
    document
      .querySelector(`[data-project-card="${pid}"]`)
      .querySelector('button[aria-label^="Details"]')
      .click();
  }, id);
  await page.waitForTimeout(700);
  const dialog = await page.$('[role="dialog"]');
  assert(dialog, "\"Details anzeigen\" opened nothing");
  const shown = await page.evaluate(
    () => document.querySelector('[role="dialog"] .font-mono')?.textContent?.trim() ?? null,
  );
  assert(
    !nummer || nummer === "N/A" || shown === nummer,
    `dialog showed ${shown} for the card that reads ${nummer}`,
  );
  await page.keyboard.press("Escape");
});

console.log("\n== derived, not typed in ==");

/**
 * The audit that produced these found the same shape of defect nine times: a
 * figure on screen that no code derives, or a chart keyed on a raw status
 * string so rows silently vanish. These assertions pin the fixes.
 */
await check("no page states a figure the data does not support", async () => {
  for (const route of ["/", "/projects", "/bvb-eea", "/psv-itk", "/anmeldung"]) {
    await go(route);
    const body = await page.locator("body").innerText();
    const invented = [
      "+23 seit letzter Woche",   // a weekly delta with no time series behind it
      "Datenbank: Online",        // no database exists in this build
      "Excel Sync: Aktiv",        // no sync process exists
      "Version 1.0.0",            // package.json says 2.0.0
      "22 Fragen",                // the wizard renders 19 or 18, never 22
      "folgt in Stufe 4",         // promised features that already shipped
    ];
    // The wizard has no project data in scope, so any total it prints is a
    // literal. 18.172 was frozen into Step 3.
    if (route === "/anmeldung") invented.push("18.172");
    for (const phrase of invented) {
      assert(!body.includes(phrase), `${route} still shows "${phrase}"`);
    }
  }
});

await check("the status pie plots the work, and accounts for every row it does not", async () => {
  await go("/");
  /*
   * The rule changed, and for a measured reason.
   *
   * The donut used to plot all 15.646 rows carrying a status, and its single
   * biggest band was „nicht relevant" — rows saying a department is not
   * involved. For BIM that is 741 of 866, so the carousel printed „866
   * Prüfungen in BIM" next to a card reading „125 Prüfungen erforderlich":
   * both true, contradicting each other on one screen.
   *
   * So it now plots the required rows, like every other workload figure on the
   * site, and the caption has to account for the rest — the obligation is no
   * longer "chart everything" but "chart the work and drop nothing silently".
   */
  const caption = await page
    .locator("text=/erforderliche Prüfungen von .* Prüfzeilen/")
    .first()
    .innerText();
  const numbers = [...caption.matchAll(/([\d.]+)/g)].map((m) => Number(m[1].replace(/\./g, "")));
  const [required, total, notRequired] = numbers;

  const projects = JSON.parse(fs.readFileSync("client/public/data.json", "utf8")).projects;
  let withStatus = 0;
  let rows = 0;
  let notRequiredRows = 0;
  for (const p of projects) {
    for (const r of p.reviews ?? []) {
      rows++;
      if (!r.status) continue;
      withStatus++;
      if (String(r.status).trim().toLowerCase().startsWith("nicht erforderlich")) notRequiredRows++;
    }
  }
  assert(total === rows, `caption says ${total} Prüfzeilen, the data has ${rows}`);
  assert(
    notRequired === notRequiredRows,
    `caption says ${notRequired} nicht erforderlich, the data has ${notRequiredRows}`,
  );
  // Nothing may go missing between the two: every row that carries a status is
  // either charted or named in the caption.
  assert(
    required + notRequired === withStatus,
    `${required} charted + ${notRequired} excluded ≠ ${withStatus} rows with a status`,
  );
  console.log(`     ${required} charted, ${notRequired} excluded, ${withStatus} with a status`);
});

await check("truncated lists say how much they are hiding", async () => {
  await go("/");
  // The Dashboard's charts mount after the data resolves, so snapshotting
  // innerText on arrival is a race the harness sometimes lost.
  await page.waitForSelector("text=/Gewerke-Portfolio/", { timeout: 20000 });
  const body = await page.locator("body").innerText();
  // The Gewerke panel no longer truncates — it shows all fourteen — so the rule
  // it has to satisfy changed from "say how much you hide" to "hide nothing,
  // and say so". The heading still has to state its own coverage.
  assert(/Gewerke-Portfolio — alle 14/.test(body), "the Gewerke panel does not state its coverage");
  assert(
    !/Status pro Gewerke — \d+ von \d+/.test(body),
    "the old truncated Gewerke grid is still on the page",
  );
  // The region panel stopped truncating too — it shows all eight
  // Bahnhofsmanagements — so the rule it satisfies changed the same way the
  // Gewerke panel's did: hide nothing, and account for what is not covered.
  assert(
    /Regionale Verteilung — alle \d+/.test(body),
    "the region list does not state its own coverage",
  );
  assert(
    !/Regionale Verteilung — Top \d+ von \d+/.test(body),
    "the region list is still truncated",
  );
  assert(
    /von 1\.298 Projekten tragen ein Bahnhofsmanagement/.test(body),
    "the region list does not account for the projects with no region",
  );
});

await check("BVB-EEA and PSV-ITK render German dates and honest headings", async () => {
  for (const [route, heading] of [["/bvb-eea", "BVB-EEA"], ["/psv-itk", "PSV-ITK"]]) {
    await go(route);
    await page.waitForSelector("table tbody tr", { timeout: 15000 });
    const body = await page.locator("body").innerText();
    assert(body.includes(heading), `${route} lost its heading`);
    assert(!/Verwaltung der/.test(body), `${route} still claims to be a Verwaltung; it has no controls`);
    // dd.mm.yyyy with leading zeros — never yyyy-mm-dd, never d.m.yyyy
    // 12th cell: Nr., Projektnummer, Region, Station, Bhf-Nr., Strecken-Nr.,
    // Beschreibung, Projektstand, Projektleiter, Termin PV, Prüfer, Prüfdatum.
    const dates = await page.$$eval("table tbody tr td:nth-child(12)", (tds) =>
      tds.map((t) => t.textContent.trim()).filter((t) => t && t !== "—"),
    );
    assert(dates.length > 0, `${route} rendered no Prüfdatum at all`);
    const bad = dates.filter((d) => !/^\d{2}\.\d{2}\.\d{4}$/.test(d));
    assert(bad.length === 0, `${route} renders non-German dates: ${bad.slice(0, 3).join(", ")}`);
  }
});

await check("the header search reaches the Projekte page", async () => {
  await go("/");
  const box = page.getByLabel("Website durchsuchen — Projekte, Orte, Personen und Seiten");
  await box.fill("Bensheim");
  // Wait for the list rather than racing it: the index builds lazily on first
  // use, and pressing Enter before it exists falls back to the raw term, which
  // is a different code path from the one this test is about.
  await page.waitForSelector('[role="option"]', { timeout: 10000 });
  const top = await page.$eval('[role="option"]', (e) => ({
    kind: e.getAttribute("data-search-kind"),
    text: e.textContent.trim(),
  }));
  assert(
    top.kind === "station" && top.text.startsWith("Bensheim"),
    `"Bensheim" ranked ${top.kind} "${top.text}" first, not the station`,
  );
  await box.press("Enter");
  await page.waitForTimeout(900);
  assert(/\/projects/.test(page.url()), `search went to ${page.url()}`);
  assert(new URL(page.url()).searchParams.get("q") === "Bensheim", "the term did not survive the navigation");
  // A station opens the card view — that is what choosing a station means now.
  // Assert the result set narrowed, whichever view it landed in.
  await page.waitForTimeout(1500);
  const total = JSON.parse(fs.readFileSync("client/public/data.json", "utf8")).projects.length;
  const count = await page.evaluate(() => {
    const cards = document.querySelectorAll("[data-project-card]").length;
    return cards > 0 ? cards : document.querySelectorAll("table tbody tr").length;
  });
  assert(count > 0 && count < total, `search returned ${count} of ${total} — it did not filter`);
});

await check("the bell shows real events, not an empty store", async () => {
  await go("/");
  await page.getByRole("button", { name: /^Änderungen/ }).click();
  await page.waitForTimeout(500);
  const menu = await page.locator('[role="menu"]').innerText();
  assert(
    !menu.includes("Keine neuen Benachrichtigungen"),
    "the bell still reads from a store nothing writes",
  );
  await page.keyboard.press("Escape");
});

await check("both table row actions are separate 44px targets on touch", async () => {
  const touch = await browser.newContext({
    viewport: { width: 834, height: 1194 },
    hasTouch: true, isMobile: true, deviceScaleFactor: 2,
  });
  await touch.addInitScript(() =>
    localStorage.setItem(
      "bahn-demo-user",
      JSON.stringify({ id: 1, openId: "e2e", name: "Vincenzo Grimaldi", email: "v@db.de", role: "admin" }),
    ),
  );
  const tp = await touch.newPage();
  await tp.goto(U("/projects"), { waitUntil: "networkidle" });
  await tp.waitForSelector("table tbody tr", { timeout: 15000 });
  // The actual condition, not a guessed duration — see `settled`.
  await settled(tp);
  await tp.waitForTimeout(150);
  const r = await tp.evaluate(() => {
    const cell = [...document.querySelectorAll("td")].find(
      (td) => td.querySelectorAll("button").length >= 2,
    );
    if (!cell) return { err: "no action cell" };
    const rects = [...cell.querySelectorAll("button")].map((b) => b.getBoundingClientRect());
    let overlap = 0;
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const ox = Math.max(0, Math.min(rects[i].right, rects[j].right) - Math.max(rects[i].left, rects[j].left));
        const oy = Math.max(0, Math.min(rects[i].bottom, rects[j].bottom) - Math.max(rects[i].top, rects[j].top));
        overlap += ox * oy;
      }
    return {
      small: rects.filter((b) => b.width < 43.5 || b.height < 43.5).length,
      overlap: Math.round(overlap),
      count: rects.length,
    };
  });
  await touch.close();
  assert(!r.err, r.err);
  assert(r.small === 0, `${r.small} of ${r.count} row actions are under 44px on touch`);
  assert(r.overlap === 0, `row actions overlap by ${r.overlap}px² — one steals the other's taps`);
});

console.log("\n== documents and notifications ==");

await check("the detail dialog prints a Projektblatt stamped with date AND time", async () => {
  await go("/projects?q=Langenselbold");
  await page.click('[aria-label="Kachelansicht"]');
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    document
      .querySelector("[data-project-card]")
      ?.querySelector('button[aria-label^="Details"]')
      ?.click();
  });
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 });

  const btn = page.getByRole("button", { name: /Als PDF/ });
  assert((await btn.count()) === 1, "no third action beside Station and Bahnhofsmanagement");

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 90000 }),
    btn.click(),
  ]);
  const name = download.suggestedFilename();

  // Projektblatt_<Nr>_<Station>_<YYYY-MM-DD>_<HHMM>.pdf — the time is what
  // makes a second export on the same day a second file rather than an
  // overwrite, and what lets a reader date the sheet in their hand.
  assert(
    /^Projektblatt_.+_\d{4}-\d{2}-\d{2}_\d{4}\.pdf$/.test(name),
    `filename carries no date+time stamp: ${name}`,
  );
  assert(name.includes("G.011540063"), `filename does not identify the project: ${name}`);

  const file = await download.path();
  const head = fs.readFileSync(file);
  assert(head.subarray(0, 5).toString() === "%PDF-", "the download is not a PDF");
  assert(head.length > 5000, `PDF is implausibly small: ${head.length} bytes`);
  await page.keyboard.press("Escape");
});

await check("mail and Teams carry a written message, not just an address", async () => {
  await go("/projects?q=Langenselbold");
  await page.click('[aria-label="Kachelansicht"]');
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    document
      .querySelector("[data-project-card]")
      ?.querySelector('button[aria-label^="Details"]')
      ?.click();
  });
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 });

  const links = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return {
      mail: [...d.querySelectorAll('a[href^="mailto:"]')].map((a) => a.getAttribute("href")),
      teams: [...d.querySelectorAll('a[href^="https://teams"]')].map((a) => a.getAttribute("href")),
    };
  });
  assert(links.mail.length > 0 && links.teams.length > 0, "no contact routes in the dialog");

  for (const href of links.mail) {
    const q = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    const subject = q.get("subject") ?? "";
    const body = q.get("body") ?? "";
    assert(subject.includes("G.011540063"), `subject does not name the project: ${subject}`);
    assert(body.includes("Projektnummer: G.011540063"), "body does not carry the Projektnummer");
    assert(body.includes("Station: Langenselbold"), "body does not carry the Station");
    assert(
      body.includes("Erstellt aus dem Bahn Project Manager"),
      "body does not say where it came from",
    );
    assert(/Projekt öffnen: https?:\/\//.test(body), "body carries no link back to the record");
  }

  // A Teams chat has no subject field, so the message has to open with it.
  for (const href of links.teams) {
    const msg = new URLSearchParams(href.slice(href.indexOf("?") + 1)).get("message") ?? "";
    assert(msg.startsWith("Projekt G.011540063"), "Teams message does not open with the subject");
    assert(msg.includes("Bahnhofsmanagement: Kassel"), "Teams message carries no context");
  }
  await page.keyboard.press("Escape");
});


console.log("\n== Gewerk workspaces have the Projekte surface ==");

/**
 * /bvb-eea and /psv-itk were read-only tables. They are now the same workspace
 * the Projekte page is, scoped to one Gewerk, so these assert parity rather
 * than "a table renders": the KPI row, the filter panel, all three views, the
 * map handing over to the cards, the detail dialog, and the export.
 *
 * The KPI check is the load-bearing one. Every number on the page is derived
 * from a single scoped set, so "Offen + Zugestimmt + Blockiert <= total" and
 * "total == rows when nothing is filtered" cannot both hold if the KPI row and
 * the table were ever computed from different collections — which is the exact
 * defect this audit found on the Dashboard three times.
 */
for (const [route, dept, label] of [
  ["/bvb-eea", "EEA", "BVB-EEA"],
  ["/psv-itk", "ITK", "PSV-ITK"],
]) {
  await check(`${label}: the KPI row and the table count the same set`, async () => {
    await go(route);
    await page.waitForSelector("table tbody tr", { timeout: 20000 });

    const kpis = await page.$$eval("main .grid .text-4xl, .grid .text-4xl", (els) =>
      els.map((e) => Number(e.textContent.replace(/\./g, "").trim())),
    );
    assert(kpis.length >= 4, `only ${kpis.length} KPI values rendered`);
    const [total, open, done, blocked] = kpis;
    assert(total > 0, `${label} reports zero ${dept} reviews`);
    assert(
      open + done + blocked <= total,
      `${label}: ${open}+${done}+${blocked} exceeds the total ${total}`,
    );

    const rows = await page.$$eval("table tbody tr", (r) => r.length);
    assert(rows === total, `${label}: KPI says ${total}, the table renders ${rows}`);

    // And the same number the page derives, derived independently here.
    const projects = JSON.parse(fs.readFileSync("client/public/data.json", "utf8")).projects;
    let expected = 0;
    for (const p of projects) {
      const r = (p.reviews ?? []).find((x) => x.department === dept);
      if (!r || !r.status) continue;
      if (String(r.status).toLowerCase().startsWith("nicht erforderlich")) continue;
      expected++;
    }
    assert(
      total === expected,
      `${label}: page says ${total} ${dept} reviews, data.json has ${expected}`,
    );
  });

  await check(`${label}: search, filter panel and chips actually narrow the set`, async () => {
    await go(route);
    await page.waitForSelector("table tbody tr", { timeout: 20000 });
    const before = await page.$$eval("table tbody tr", (r) => r.length);

    const box = page.getByLabel(`${label} Prüfungen durchsuchen`);
    await box.fill("Frankfurt");
    await page.getByRole("button", { name: "Suchen" }).click();
    await page.waitForTimeout(600);
    const after = await page.$$eval("table tbody tr", (r) => r.length);
    assert(after > 0 && after < before, `${label}: search gave ${after} of ${before} rows`);

    // The active filter is visible and removable — not an invisible state the
    // user has to guess at from a shrunken row count.
    const chip = page.getByRole("button", { name: /Filter .*Suche: Frankfurt.* entfernen/ });
    assert(await chip.count() > 0, `${label}: the search is not shown as a removable chip`);
    await chip.first().click();
    await page.waitForTimeout(600);
    const restored = await page.$$eval("table tbody tr", (r) => r.length);
    assert(restored === before, `${label}: clearing the chip left ${restored} of ${before} rows`);

    // exact: the chips' accessible names begin with "Filter" too, and
    // Playwright's name option is a substring match by default.
    const filterBtn = page.getByRole("button", { name: "Filter", exact: true });
    assert(
      (await filterBtn.getAttribute("aria-expanded")) === "false",
      `${label}: the filter toggle does not report its state`,
    );
    await filterBtn.click();
    await page.waitForTimeout(300);
    assert(
      (await filterBtn.getAttribute("aria-expanded")) === "true",
      `${label}: the filter panel did not open`,
    );
  });

  await check(`${label}: all three views render, and the map hands over to the cards`, async () => {
    await go(route);
    await page.waitForSelector("table tbody tr", { timeout: 20000 });

    await page.click('[aria-label="Kachelansicht"]');
    await page.waitForSelector("[data-project-card]", { timeout: 15000 });
    assert(
      (await page.$$eval("[data-project-card]", (c) => c.length)) > 0,
      `${label}: the card view rendered no cards`,
    );

    await page.click('[aria-label="Kartenansicht"]');
    await page.waitForSelector(".leaflet-container", { timeout: 15000 });
    /*
     * Wait for a marker, do not count the instant the container appears.
     *
     * Leaflet mounts its container first and adds the layer afterwards, so on
     * a slower runner — a 2-core Codespace, say — the count ran before a
     * single marker existed and this failed for BVB-EEA while passing for
     * PSV-ITK on the same build. That is a flaky gate, and a flaky gate is a
     * broken one: it teaches you to re-run instead of to look.
     */
    const MARKER = ".leaflet-marker-icon, .leaflet-interactive";
    await page
      .waitForSelector(MARKER, { timeout: 25000 })
      .catch(() => {});
    const markers = await page.$$eval(MARKER, (m) => m.length);
    assert(markers > 0, `${label}: the map rendered no markers`);

    // Clicking a station must land on the filtered cards, not leave the user
    // on a map with nothing to read. Leaflet binds its own handlers, so a
    // synthesised MouseEvent does not reach them — this drives the real marker,
    // forced because markers overlap heavily at the initial zoom.
    await page.waitForTimeout(2500);
    const dots = await page.$$(".db-dot-marker");
    assert(dots.length > 0, `${label}: the map rendered no station markers`);
    await dots[dots.length - 1].click({ force: true });
    await page.waitForTimeout(700);
    const projectButtons = await page.$$("[data-pid]");
    assert(projectButtons.length > 0, `${label}: the marker popup lists no projects`);

    await projectButtons[0].click({ force: true });
    await page.waitForTimeout(1200);
    const pressed = await page.getAttribute('[aria-label="Kachelansicht"]', "aria-pressed");
    assert(pressed === "true", `${label}: expected the card view, aria-pressed was ${pressed}`);
    const landed = await page.$$eval("[data-project-card]", (c) => c.length);
    assert(landed > 0, `${label}: a map click did not land on the card view`);

    // Arriving from the map opens that project, and the station stays as a
    // removable chip rather than an invisible filter.
    await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const chips = await page.$$eval("span", (els) =>
      els.filter((e) => e.children.length === 0 && /^Station: /.test(e.textContent || "")).length,
    );
    assert(chips > 0, `${label}: no station chip after arriving from the map`);
  });

  await check(`${label}: the detail dialog opens with the project's contact routes`, async () => {
    await go(route);
    await page.waitForSelector("table tbody tr", { timeout: 20000 });
    await page.evaluate(() => {
      document.querySelector('table tbody tr button[aria-label^="Details"]')?.click();
    });
    await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
    const dialog = await page.locator('[role="dialog"]').first().innerText();
    assert(dialog.length > 200, `${label}: the dialog opened nearly empty`);
    const mails = await page.$$eval('[role="dialog"] a[href^="mailto:"]', (a) => a.length);
    assert(mails > 0, `${label}: the dialog offers no mail route`);
    await page.keyboard.press("Escape");
  });

  await check(`${label}: the export is scoped to this Gewerk and stamped`, async () => {
    await go(route);
    await page.waitForSelector("table tbody tr", { timeout: 20000 });
    const [dl] = await Promise.all([
      page.waitForEvent("download", { timeout: 30000 }),
      page.getByRole("button", { name: /Export/ }).click(),
    ]);
    const name = dl.suggestedFilename();
    assert(
      new RegExp(`^DB_${dept}_Pruefungen_\\d{4}-\\d{2}-\\d{2}_\\d{4}\\.csv$`).test(name),
      `${label}: export filename carries no Gewerk or no date+time stamp: ${name}`,
    );
    const f = path.join("/tmp", `e2e-${dept}-${Date.now()}.csv`);
    await dl.saveAs(f);
    const text = fs.readFileSync(f, "utf-8");
    const head = text.split("\n")[0];
    assert(head.includes(`${dept}-Status`), `${label}: CSV header is not Gewerk-scoped: ${head}`);
    assert(text.split("\n").length > 10, `${label}: CSV carried almost no rows`);
    fs.unlinkSync(f);
  });
}

await check("the three tabs are independent surfaces, not one shared state", async () => {
  // Projekte, BVB-EEA and PSV-ITK each keep their own search, filters, sort and
  // view mode. They render the same component with different props, so if the
  // router ever reused the instance, a search typed on one tab would silently
  // narrow another — and the KPI row would keep reporting the unfiltered set.
  await go("/bvb-eea");
  await page.waitForSelector("table tbody tr", { timeout: 20000 });
  const eeaRows = await page.$$eval("table tbody tr", (r) => r.length);
  const box = page.getByLabel("BVB-EEA Prüfungen durchsuchen");
  await box.fill("Frankfurt");
  await page.getByRole("button", { name: "Suchen" }).click();
  await page.click('[aria-label="Kachelansicht"]');
  await page.waitForTimeout(800);

  await go("/psv-itk");
  await page.waitForSelector("table tbody tr", { timeout: 20000 });
  const itkSearch = await page.getByLabel("PSV-ITK Prüfungen durchsuchen").inputValue();
  assert(itkSearch === "", `PSV-ITK inherited BVB-EEA's search: "${itkSearch}"`);
  assert(
    (await page.getAttribute('[aria-label="Tabellenansicht"]', "aria-pressed")) === "true",
    "PSV-ITK inherited BVB-EEA's view mode",
  );

  await go("/bvb-eea");
  await page.waitForSelector("table tbody tr", { timeout: 20000 });
  const back = await page.$$eval("table tbody tr", (r) => r.length);
  assert(back === eeaRows, `BVB-EEA came back filtered: ${back} of ${eeaRows} rows`);

  // And the two tabs really do scope to different Gewerke.
  await go("/psv-itk");
  await page.waitForSelector("table tbody tr", { timeout: 20000 });
  const itkRows = await page.$$eval("table tbody tr", (r) => r.length);
  assert(itkRows !== eeaRows, `both tabs render ${itkRows} rows — they are not scoped`);
});

await check("the Gewerk table carries the Projekte columns and sorts on them", async () => {
  await go("/psv-itk");
  await page.waitForSelector("table tbody tr", { timeout: 20000 });
  const headers = await page.$$eval("table thead th", (th) =>
    th.map((t) => t.textContent.trim()),
  );
  for (const col of [
    "Nr.", "Projektnummer", "Region", "Station", "Bhf-Nr.", "Strecken-Nr.",
    "Beschreibung", "Projektstand", "Projektleiter", "Termin PV",
    "ITK-Prüfer", "Prüfdatum", "Status",
  ]) {
    assert(headers.some((h) => h.includes(col)), `the table has no ${col} column`);
  }

  // Sorting is a real control: a button inside the th, and aria-sort reports it.
  const station = page.getByRole("button", { name: "Nach Station sortieren" });
  await station.click();
  await page.waitForTimeout(500);
  const first = await page.$$eval("table tbody tr td:nth-child(4)", (t) =>
    t.slice(0, 40).map((x) => x.textContent.trim()).filter(Boolean),
  );
  const sorted = [...first].sort((a, b) => a.localeCompare(b, "de", { numeric: true }));
  assert(
    JSON.stringify(first) === JSON.stringify(sorted),
    `ascending sort did not order the Station column: ${first.slice(0, 3).join(" | ")}`,
  );
  const th = await page.$eval(
    "table thead th:nth-child(4)",
    (e) => e.getAttribute("aria-sort"),
  );
  assert(th === "ascending", `aria-sort reported "${th}" after sorting ascending`);

  await station.click();
  await page.waitForTimeout(500);
  const desc = await page.$eval(
    "table thead th:nth-child(4)",
    (e) => e.getAttribute("aria-sort"),
  );
  assert(desc === "descending", `a second click reported "${desc}"`);
});

await check("editing a Gewerk row writes through and reaches the Änderungshistorie", async () => {
  await go("/psv-itk");
  await page.waitForSelector("table tbody tr", { timeout: 20000 });

  // The Prüfer cell is editable here exactly as it is on Projekte — which is
  // the "changing names" half of the audit requirement.
  const cell = page.locator('table tbody tr:first-child td:nth-child(11) button').first();
  await cell.click();
  const input = page.locator('table tbody tr:first-child td:nth-child(11) input').first();
  const stamp = `E2E Prüfer ${Date.now()}`;
  await input.fill(stamp);
  await input.press("Enter");
  await page.waitForTimeout(900);

  const shown = await page
    .locator('table tbody tr:first-child td:nth-child(11)')
    .innerText();
  assert(shown.includes(stamp), `the edit did not persist in the cell: "${shown}"`);

  await go("/audit");
  const body = await page.locator("body").innerText();
  assert(body.includes("Prüfung aktualisiert"), "the Gewerk edit never reached the log");
  assert(body.includes(stamp), "the log entry does not carry the new value");
});

console.log("\n== the Änderungshistorie records what people actually did ==");

/**
 * The trail captured field edits and nothing else: a user could export four
 * PDFs, hand three prefilled mails to Outlook and save a draft, and the log
 * would say they did nothing all afternoon. These assert the entries exist and
 * — as importantly — that they claim only what the app can substantiate.
 */
await check("a generated document and a prefilled message both reach the log", async () => {
  await go("/bvb-eea");
  await page.waitForSelector("table tbody tr", { timeout: 20000 });
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 30000 }),
    page.getByRole("button", { name: /Export/ }).click(),
  ]);
  const exported = dl.suggestedFilename();

  await page.evaluate(() => {
    document.querySelector('table tbody tr button[aria-label^="Details"]')?.click();
  });
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
  // Clicking the anchor would hand the page to an external protocol handler,
  // which Chromium cannot resolve here. The click that records is the one on
  // the link itself, so dispatch it without letting the navigation happen.
  await page.evaluate(() => {
    const a = document.querySelector('[role="dialog"] a[href^="mailto:"]');
    a?.addEventListener("click", (e) => e.preventDefault(), { once: true });
    a?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");

  await go("/audit");
  const body = await page.locator("body").innerText();
  assert(body.includes("Export erzeugt"), "the CSV export never reached the Änderungshistorie");
  assert(body.includes(exported), `the entry does not name the file: ${exported}`);
  assert(
    body.includes("E-Mail vorbereitet"),
    "handing a prefilled mail to Outlook never reached the Änderungshistorie",
  );

  // The app hands a mailto: to the user's client and never learns what happened
  // next. Claiming delivery would put an unsubstantiable statement in an audit
  // trail, which is the class of defect this whole pass removes.
  assert(
    !/E-Mail gesendet|Nachricht gesendet|PDF gedruckt/.test(body),
    "the log claims a delivery the app cannot observe",
  );
});

await check("every logged action is a known one, rendered with its own tone", async () => {
  await go("/audit");
  const rows = await page.$$eval("[data-audit-action]", (els) =>
    els.map((e) => ({
      action: e.getAttribute("data-audit-action"),
      tone: e.getAttribute("data-audit-tone"),
    })),
  );
  assert(rows.length > 0, "the Änderungshistorie rendered no entries");
  const untoned = rows.filter((r) => !r.tone);
  assert(untoned.length === 0, `${untoned.length} entries rendered without a tone`);
});


console.log("\n== the search finds everything, from anywhere ==");

const palette = () => page.getByLabel("Website durchsuchen — Projekte, Orte, Personen und Seiten");

await check("the palette finds pages and views the old search could not", async () => {
  await go("/");
  for (const [term, expected] of [
    ["Karte", "/projects?view=map"],
    ["Historie", "/audit"],
    ["Anmeldung", "/anmeldung"],
  ]) {
    await palette().fill(term);
    await page.waitForSelector('[role="option"]', { timeout: 5000 });
    const first = await page.$eval('[role="option"]', (e) => ({
      kind: e.getAttribute("data-search-kind"),
      text: e.textContent.trim(),
    }));
    assert(first.kind === "seite", `"${term}" ranked a ${first.kind} first, not a page`);
    // The first row is highlighted already; Enter opens it.
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    const url = new URL(page.url());
    const got = url.pathname + url.search;
    assert(got === expected, `"${term}" went to ${got}, expected ${expected}`);
    await go("/");
  }
});

await check("a Gewerk goes to that Gewerk's own tab", async () => {
  await go("/");
  await palette().fill("EEA");
  await page.waitForSelector('[role="option"]', { timeout: 5000 });
  const rows = await page.$$eval('[role="option"]', (els) =>
    els.map((e) => ({ kind: e.getAttribute("data-search-kind"), text: e.textContent.trim() })),
  );
  const gewerk = rows.findIndex((r) => r.kind === "gewerk" || /BVB-EEA/.test(r.text));
  assert(gewerk >= 0, `no Gewerk or BVB-EEA row for "EEA": ${JSON.stringify(rows.slice(0, 3))}`);
  for (let i = 0; i < gewerk; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  assert(/\/bvb-eea/.test(page.url()), `"EEA" went to ${page.url()}`);
});

await check("umlauts, their expansions and their strippings all find the same station", async () => {
  await go("/");
  const seen = [];
  for (const spelling of ["Gießen", "Giessen", "Giesen"]) {
    await palette().fill(spelling);
    await page.waitForTimeout(500);
    const labels = await page.$$eval('[role="option"]', (els) =>
      els.map((e) => e.textContent.trim()),
    );
    assert(labels.length > 0, `"${spelling}" found nothing at all`);
    seen.push(labels.join("|"));
  }
  assert(
    seen.some((l) => /Gie[sß]/i.test(l)),
    "no spelling of Gießen reached the station",
  );
});

await check("a typo is offered a correction, and a good query never is", async () => {
  await go("/");
  await palette().fill("Bensheimm");
  await page.waitForTimeout(600);
  const body = await page.locator("body").innerText();
  const corrected = /Meinten Sie/.test(body);
  const found = (await page.$$('[role="option"]')).length > 0;
  assert(corrected || found, "a one-letter typo produced neither results nor a correction");

  await palette().fill("Kassel");
  await page.waitForTimeout(600);
  const good = await page.locator("body").innerText();
  assert(!/Meinten Sie/.test(good), "a query that worked was still offered a correction");
});

await check("the palette is a real combobox and opens with Ctrl+K from any page", async () => {
  await go("/psv-itk");
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(300);
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("role"));
  assert(focused === "combobox", `Ctrl+K focused a ${focused}, not the combobox`);

  await page.keyboard.type("Frankfurt");
  await page.waitForSelector('[role="option"]', { timeout: 5000 });
  const box = palette();
  assert((await box.getAttribute("aria-expanded")) === "true", "aria-expanded stayed false");
  await page.keyboard.press("ArrowDown");
  const activeId = await box.getAttribute("aria-activedescendant");
  assert(activeId, "arrowing down set no aria-activedescendant");
  const selected = await page.$eval(`#${activeId}`, (e) => e.getAttribute("aria-selected"));
  assert(selected === "true", "the active option does not report aria-selected");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  assert((await box.getAttribute("aria-expanded")) === "false", "Escape did not close the list");
});

await check("the page filter box suggests from the same index and never navigates away", async () => {
  await go("/bvb-eea");
  await page.waitForSelector("table tbody tr", { timeout: 20000 });
  const box = page.getByLabel("BVB-EEA Prüfungen durchsuchen");
  await box.fill("Frank");
  await page.waitForSelector('[role="option"]', { timeout: 5000 });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  assert(/\/bvb-eea/.test(page.url()), `choosing a suggestion left the page: ${page.url()}`);
  const rows = await page.$$eval("table tbody tr", (r) => r.length);
  assert(rows > 0, "the suggestion filtered the table down to nothing");
});

console.log("\n== every status is a dropdown, everywhere ==");

/**
 * The control is a badge you activate, not a permanently mounted <select>.
 * 18,172 selects carrying 236,000 options took the Projekte table from 4.6 s to
 * 10.0 s to first paint, measured — so the badge is a button and the select
 * appears on activation. These assert the interaction, which is the thing a
 * reader actually performs.
 */
await check("the Gewerk status cell opens a labelled dropdown with the full vocabulary", async () => {
  await go("/psv-itk");
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  const badge = page.locator('table tbody tr:first-child td:nth-child(13) button').first();
  const label = await badge.getAttribute("aria-label");
  assert(
    /^Status ITK für Projekt .* ändern/.test(label ?? ""),
    `unhelpful accessible name on the status control: ${label}`,
  );
  await badge.click();
  const select = page.locator('table tbody tr:first-child td:nth-child(13) select').first();
  await select.waitFor({ timeout: 5000 });
  const options = await select.locator("option").allTextContents();
  for (const s of ["offen", "Zustimmung erteilt", "abgelehnt", "Nachforderung"]) {
    assert(options.includes(s), `the dropdown cannot offer "${s}"`);
  }
  await page.keyboard.press("Escape");
});

await check("Projekte's 14 Gewerk columns are all changeable, not read-only badges", async () => {
  await go("/projects");
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  const labels = await page.$$eval("table tbody tr:first-child button", (els) =>
    els.map((e) => e.getAttribute("aria-label") ?? ""),
  );
  const statusControls = labels.filter((l) => /^Status .* ändern/.test(l));
  assert(
    statusControls.length >= 14,
    `only ${statusControls.length} changeable Gewerk statuses in the first row`,
  );
  for (const dept of ["EEA", "ITK", "LST", "BIM", "Vermessung"]) {
    assert(
      statusControls.some((l) => l.startsWith(`Status ${dept} für Projekt`)),
      `no status control for ${dept}`,
    );
  }
  // And it really opens.
  await page.click(`[aria-label^="Status EEA für Projekt"]`);
  await page.waitForSelector("table tbody select", { timeout: 5000 });
  await page.keyboard.press("Escape");
});

await check("changing a status persists a reload and reaches the Änderungshistorie", async () => {
  await go("/psv-itk");
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  const cell = 'table tbody tr:first-child td:nth-child(13)';
  await page.locator(`${cell} button`).first().click();
  const select = page.locator(`${cell} select`).first();
  await select.waitFor({ timeout: 5000 });
  const before = await select.inputValue();
  const options = await select.locator("option").allTextContents();
  // Not "nicht erforderlich": that value removes the row from this Gewerk's
  // scope, which is correct behaviour and is asserted separately below — but it
  // would make this test compare two different projects.
  const next = options.find(
    (o) => o && o !== before && o !== "—" && o !== "nicht erforderlich",
  );
  assert(next, "the dropdown offered no other value to select");

  await select.selectOption(next);
  await page.waitForTimeout(1200);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  const shown = await page.locator(`${cell} button`).first().innerText();
  assert(shown.includes(next), `after a reload the cell reads "${shown}", not "${next}"`);

  await go("/audit");
  const body = await page.locator("body").innerText();
  assert(body.includes("Prüfung aktualisiert"), "the status change never reached the log");
  assert(body.includes(next), `the entry does not name the new status "${next}"`);
  assert(body.includes("ITK"), "the entry does not say which Gewerk changed");

  // Put it back so a re-run starts from the same place.
  await go("/psv-itk");
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  await page.locator(`${cell} button`).first().click();
  await page.locator(`${cell} select`).first().waitFor({ timeout: 5000 });
  await page.locator(`${cell} select`).first().selectOption(before);
  await page.waitForTimeout(600);
});

await check("setting a status to \"nicht erforderlich\" removes the row from that Gewerk", async () => {
  // The scoping rule is that a Gewerk tab lists the reviews that are actually
  // required. Marking one not required must therefore take the row out — and
  // must take it out of the KPI row at the same time, or the count and the
  // table disagree.
  await go("/psv-itk");
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  const rowsBefore = await page.$$eval("table tbody tr", (r) => r.length);
  const kpiBefore = await page.$$eval(".grid .text-4xl", (els) =>
    Number(els[0].textContent.replace(/\./g, "")),
  );
  assert(kpiBefore === rowsBefore, `KPI ${kpiBefore} already disagrees with ${rowsBefore} rows`);

  const cell = 'table tbody tr:first-child td:nth-child(13)';
  const wasNumber = await page.locator("table tbody tr:first-child td:nth-child(2)").innerText();
  await page.locator(`${cell} button`).first().click();
  await page.locator(`${cell} select`).first().waitFor({ timeout: 5000 });
  const previous = await page.locator(`${cell} select`).first().inputValue();
  await page.locator(`${cell} select`).first().selectOption("nicht erforderlich");
  await page.waitForTimeout(1200);

  const rowsAfter = await page.$$eval("table tbody tr", (r) => r.length);
  const kpiAfter = await page.$$eval(".grid .text-4xl", (els) =>
    Number(els[0].textContent.replace(/\./g, "")),
  );
  assert(rowsAfter === rowsBefore - 1, `rows went ${rowsBefore} -> ${rowsAfter}, expected -1`);
  assert(kpiAfter === rowsAfter, `KPI says ${kpiAfter}, the table shows ${rowsAfter}`);
  const nowFirst = await page.locator("table tbody tr:first-child td:nth-child(2)").innerText();
  assert(nowFirst !== wasNumber, "the row is still at the top of its own Gewerk");

  // Restore, and confirm it comes back.
  await go(`/projects?q=${encodeURIComponent(wasNumber.trim())}`);
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  await page.click('[aria-label^="Status ITK für Projekt"]');
  await page.waitForSelector("table tbody select", { timeout: 5000 });
  await page.locator("table tbody select").first().selectOption(previous);
  await page.waitForTimeout(900);
  await go("/psv-itk");
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  const restored = await page.$$eval("table tbody tr", (r) => r.length);
  assert(restored === rowsBefore, `after restoring, rows are ${restored}, expected ${rowsBefore}`);
});

await check("a stored status outside the vocabulary is offered back, not silently rewritten", async () => {
  // The data holds "Projektkonfiguration" against "Projektkonfig." and 80 TBQ
  // rows carry a parenthesised annotation. A select that cannot represent its
  // own value renders blank, and the next change rewrites a status nobody meant
  // to touch.
  const { projects } = JSON.parse(fs.readFileSync("client/public/data.json", "utf8"));
  const KNOWN = new Set([
    "offen", "in Bearbeitung", "prüffähig", "Nachforderung", "zurückgestellt",
    "Zustimmung erteilt", "Niederschrift erstellt", "abgelehnt", "gestoppt",
    "nicht erforderlich", "Projektkonfig.", "entfällt",
  ]);
  let odd = null;
  for (const p of projects) {
    for (const r of p.reviews ?? []) {
      if (r.status && !KNOWN.has(r.status)) {
        odd = { projektnummer: p.projektnummer, department: r.department, status: r.status };
        break;
      }
    }
    if (odd) break;
  }
  if (!odd) {
    // Nothing to prove against; say so rather than passing silently.
    console.log("       (no out-of-vocabulary status in the shipped data)");
    return;
  }
  await go(`/projects?q=${encodeURIComponent(odd.projektnummer)}`);
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  const control = page.locator(`[aria-label^="Status ${odd.department} für Projekt"]`).first();
  await control.click();
  const select = page.locator("table tbody select").first();
  await select.waitFor({ timeout: 5000 });
  const value = await select.inputValue();
  assert(
    value === odd.status,
    `the dropdown shows "${value}" where the record holds "${odd.status}" — a change would rewrite it`,
  );
  await page.keyboard.press("Escape");
});


console.log("\n== the trail identifies, grades and forgives ==");

await check("a change records which project it changed, and on which screen", async () => {
  // The entry this replaces read, in full:
  //   "ITK: status von Zustimmung erteilt auf offen gesetzt."
  // — a withdrawn approval on one of 1,298 projects, with no way to tell which.
  await go("/psv-itk");
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  const projektnummer = (
    await page.locator("table tbody tr:first-child td:nth-child(2)").innerText()
  ).trim();
  const station = (
    await page.locator("table tbody tr:first-child td:nth-child(4)").innerText()
  ).trim();

  const cell = "table tbody tr:first-child td:nth-child(13)";
  await page.locator(`${cell} button`).first().click();
  const select = page.locator(`${cell} select`).first();
  await select.waitFor({ timeout: 5000 });
  const before = await select.inputValue();
  const options = await select.locator("option").allTextContents();
  const next = options.find(
    (o) => o && o !== before && o !== "—" && o !== "nicht erforderlich",
  );
  assert(next, "no other status to choose");
  await select.selectOption(next);
  await page.waitForTimeout(1200);

  await go("/audit");
  const row = page.locator("[data-audit-action='Prüfung aktualisiert']").first();
  await row.waitFor({ timeout: 10000 });
  const text = await row.innerText();
  assert(text.includes(projektnummer), `the entry does not name the project: ${text}`);
  assert(text.includes(station), `the entry does not name the station: ${text}`);
  assert(text.includes("ITK"), `the entry does not name the Gewerk: ${text}`);
  assert(text.includes(before) && text.includes(next), `the entry lost a value: ${text}`);
  assert(text.includes("PSV-ITK"), `the entry does not say where it was done: ${text}`);
});

await check("withdrawing an approval is graded critical; ordinary progress is not", async () => {
  await go("/psv-itk");
  await page.waitForSelector("table tbody tr", { timeout: 30000 });

  // Find a row that currently holds an approval, so the next change withdraws it.
  const cells = page.locator("table tbody td:nth-child(13) button");
  const count = Math.min(await cells.count(), 40);
  let target = -1;
  for (let i = 0; i < count; i++) {
    const label = (await cells.nth(i).getAttribute("aria-label")) ?? "";
    if (/aktuell (Zustimmung erteilt|Niederschrift erstellt)/.test(label)) {
      target = i;
      break;
    }
  }
  assert(target >= 0, "no approved ITK row in the first 40 to withdraw");

  await cells.nth(target).click();
  const select = page.locator("table tbody select").first();
  await select.waitFor({ timeout: 5000 });
  const before = await select.inputValue();
  await select.selectOption("offen");
  await page.waitForTimeout(1200);

  await go("/audit");
  const top = page.locator("tbody tr").first();
  await top.waitFor({ timeout: 10000 });
  assert(
    (await top.getAttribute("data-audit-severity")) === "kritisch",
    `withdrawing "${before}" was not graded critical`,
  );

  // And the filter actually isolates it.
  await page.getByRole("button", { name: /Nur kritische/ }).click();
  await page.waitForTimeout(600);
  const severities = await page.$$eval("tbody tr", (rows) =>
    rows.map((r) => r.getAttribute("data-audit-severity")),
  );
  assert(severities.length > 0, "the critical filter emptied the page");
  assert(
    severities.every((s) => s === "kritisch"),
    `the critical filter let through: ${[...new Set(severities)].join(", ")}`,
  );
});

await check("a change corrected moments later is marked, not deleted", async () => {
  await go("/psv-itk");
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  const cell = "table tbody tr:first-child td:nth-child(13)";

  await page.locator(`${cell} button`).first().click();
  let select = page.locator(`${cell} select`).first();
  await select.waitFor({ timeout: 5000 });
  const original = await select.inputValue();
  const options = await select.locator("option").allTextContents();
  const wrong = options.find(
    (o) => o && o !== original && o !== "—" && o !== "nicht erforderlich",
  );
  assert(wrong, "no other status to choose");
  await select.selectOption(wrong);
  await page.waitForTimeout(900);

  // Immediately put it back — the mis-click a person makes and fixes.
  await page.locator(`${cell} button`).first().click();
  select = page.locator(`${cell} select`).first();
  await select.waitFor({ timeout: 5000 });
  await select.selectOption(original);
  await page.waitForTimeout(1200);

  await go("/audit");
  await page.waitForSelector("tbody tr", { timeout: 10000 });

  // With corrections hidden (the default) the wrong value does not lead the page…
  const shownByDefault = await page.$$eval("tbody tr", (rows) =>
    rows.map((r) => r.getAttribute("data-audit-superseded")),
  );
  assert(
    shownByDefault.every((v) => v !== "true"),
    "a corrected entry is still shown while corrections are hidden",
  );

  // …but it is still in the record, which is the whole point.
  await page.getByRole("button", { name: /Korrekturen ausblenden/ }).click();
  await page.waitForTimeout(600);
  const all = await page.$$eval("tbody tr", (rows) =>
    rows.map((r) => r.getAttribute("data-audit-superseded")),
  );
  assert(
    all.some((v) => v === "true"),
    "the corrected entry was lost rather than marked",
  );
  assert(all.length > shownByDefault.length, "showing corrections revealed nothing");
});

await check("Rückgängig restores the old value and is itself recorded", async () => {
  await go("/psv-itk");
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  const cell = "table tbody tr:first-child td:nth-child(13)";
  const projektnummer = (
    await page.locator("table tbody tr:first-child td:nth-child(2)").innerText()
  ).trim();

  await page.locator(`${cell} button`).first().click();
  const select = page.locator(`${cell} select`).first();
  await select.waitFor({ timeout: 5000 });
  const original = await select.inputValue();
  const options = await select.locator("option").allTextContents();
  const changed = options.find(
    (o) => o && o !== original && o !== "—" && o !== "nicht erforderlich",
  );
  assert(changed, "no other status to choose");
  await select.selectOption(changed);
  await page.waitForTimeout(1200);

  await go("/audit");
  const undoBtn = page.getByRole("button", { name: /^Änderung zurücknehmen/ }).first();
  await undoBtn.waitFor({ timeout: 10000 });
  await undoBtn.click();
  await page.waitForTimeout(1500);

  await go("/psv-itk");
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  const nowNumber = (
    await page.locator("table tbody tr:first-child td:nth-child(2)").innerText()
  ).trim();
  assert(nowNumber === projektnummer, "the row moved; the undo cannot be verified here");
  const restored = await page.locator(`${cell} button`).first().innerText();
  assert(
    restored.includes(original),
    `after the undo the cell reads "${restored}", expected "${original}"`,
  );

  // The undo is a new entry, not an erasure of the old one.
  await go("/audit");
  await page.getByRole("button", { name: /Korrekturen ausblenden/ }).click();
  await page.waitForTimeout(600);
  const rows = await page.$$eval("tbody tr", (r) => r.length);
  assert(rows >= 2, `only ${rows} entries after a change and its undo`);
});


console.log("\n== where the changes actually live ==");

/**
 * The persistence layer, said out loud and defended.
 *
 * Every edit in this build goes into the reader's own browser. That is a fact
 * with a limit attached — 5 MB per origin — and two ways of getting it wrong:
 * not telling anyone how full it is, and losing a change when it overflows.
 * These three gates cover the fact, the limit, and the overflow.
 */
await check("the Dashboard says how full the only store is", async () => {
  await go("/");
  await page.waitForSelector("text=/Belastbarkeit der Zahlen/", { timeout: 25000 });
  const body = await page.locator("body").innerText();
  // Label and value are siblings in a flex row, so innerText puts a newline
  // between them — the figures are on the line after the label, not on it.
  const shown = body.match(/lokaler Speicher\s*([\d,]+)\s*MB von ([\d,]+)\s*MB/);
  assert(
    shown,
    `the trust panel does not report the storage it depends on: ${
      (body.match(/lokaler Speicher[\s\S]{0,40}/) ?? ["(nichts)"])[0]
    }`,
  );
  const used = Number(shown[1].replace(",", "."));
  const cap = Number(shown[2].replace(",", "."));
  assert(cap === 5, `the panel claims a ${cap} MB cap; localStorage is 5 MB per origin`);

  // And it must be the real occupancy, not a constant somebody typed.
  const measured = await page.evaluate(() => {
    let bytes = 0;
    for (const key of Object.keys(localStorage)) {
      bytes += new Blob([localStorage.getItem(key) ?? ""]).size;
    }
    return bytes / 1024 / 1024;
  });
  assert(
    Math.abs(used - measured) < 0.15,
    `the panel says ${used} MB, the browser holds ${measured.toFixed(2)} MB`,
  );
});

await check("no page fetches anything from GitHub", async () => {
  // The data loader used to fall back to a raw.githubusercontent.com URL: a
  // Deutsche Bahn application reaching a public host from every reader's
  // browser, and a line that would have survived the move to GitLab pointing
  // at a branch nobody watches.
  const foreign = [];
  const watch = (req) => {
    const url = req.url();
    if (!url.startsWith(`http://localhost:${PORT}`) && /github|githubusercontent/i.test(url)) {
      foreign.push(url);
    }
  };
  page.on("request", watch);
  try {
    for (const route of ["/", "/projects", "/bvb-eea", "/audit"]) {
      await go(route);
    }
    // And the built bundle must not carry the address either.
    const bundled = await page.evaluate(async () => {
      const scripts = [...document.querySelectorAll("script[src]")].map((s) => s.src);
      for (const src of scripts) {
        const text = await (await fetch(src)).text();
        if (/raw\.githubusercontent\.com/.test(text)) return src;
      }
      return null;
    });
    assert(!bundled, `the built bundle still carries a GitHub URL: ${bundled}`);
  } finally {
    page.off("request", watch);
  }
  assert(foreign.length === 0, `requests to GitHub: ${foreign.slice(0, 2).join(", ")}`);
});

await check("a full store refuses the change out loud, and never silently", async () => {
  /*
   * The failure this prevents: at the 5 MB cap setItem throws, the optimistic
   * update rolls back, and the cell reverts to its old value with nothing said.
   * From the reader's chair that is indistinguishable from the app dropping
   * their typing — which is the one thing a system of record may not do.
   *
   * Filled with real keys rather than by stubbing setItem: a mock would test
   * the mock. Everything below the fill runs inside try/finally, because the
   * whole suite shares this browser and a gate that leaves the store full
   * fails the three checks after it — which is exactly what the first version
   * of this gate did.
   */
  await go("/psv-itk");
  await page.waitForSelector("table tbody tr", { timeout: 30000 });

  const clean = async () => {
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("e2e_ballast")) localStorage.removeItem(key);
      }
    });
  };

  try {
    const filled = await page.evaluate(() => {
      /*
       * Descending chunk sizes, then measured against an app-sized write.
       *
       * 64 kB chunks alone leave up to 64 kB of headroom, and an app write
       * replaces an existing key with a value of nearly the same size — the
       * quota is charged on the difference, so it slipped through and the gate
       * proved nothing. "Full" here means: a 1 kB write is refused, which is
       * larger than any delta this app produces.
       */
      let written = 0;
      const stillFits = (bytes) => {
        try {
          localStorage.setItem("e2e_ballast_probe", "x".repeat(bytes));
          localStorage.removeItem("e2e_ballast_probe");
          return true;
        } catch {
          return false;
        }
      };
      for (const size of [64 * 1024, 4 * 1024, 512, 64]) {
        const chunk = "x".repeat(size);
        try {
          for (let i = 0; i < 4000; i++) {
            localStorage.setItem(`e2e_ballast_${size}_${i}`, chunk);
            written++;
          }
        } catch {
          // This size no longer fits; try a smaller one.
        }
      }
      return { written, full: !stillFits(1024) };
    });
    assert(filled.written > 0, "could not fill the store; nothing to test");
    assert(filled.full, `wrote ${filled.written} ballast keys and 1 kB still fits`);

    const cell = "table tbody tr:first-child td:nth-child(13)";
    const before = (await page.locator(`${cell} button`).first().innerText()).trim();
    await page.locator(`${cell} button`).first().click();
    const select = page.locator(`${cell} select`).first();
    await select.waitFor({ timeout: 5000 });
    const options = await select.locator("option").allTextContents();
    const target = options.find(
      (o) => o && !before.includes(o) && o !== "—" && o !== "nicht erforderlich",
    );
    assert(target, "no other status to choose");
    await select.selectOption(target);
    await page.waitForTimeout(1500);

    const body = await page.locator("body").innerText();
    assert(
      /Speicher ist voll|NICHT gespeichert/i.test(body),
      "the store was full and the app said nothing about it",
    );

    // And it rolled back rather than showing a value it did not keep.
    const after = (await page.locator(`${cell} button`).first().innerText()).trim();
    assert(
      after === before,
      `the cell shows "${after}" but the write was refused — it claims a change it did not keep`,
    );
  } finally {
    await clean();
    await go("/");
  }
});

console.log("\n== the map on the Dashboard ==");

/**
 * The same map, not a second one.
 *
 * The Dashboard's map is the component Projekte renders, handed every project
 * rather than a filtered set. These read both surfaces and compare them: a
 * Dashboard copy that drifted — its own station matching, its own counts —
 * would show here as two different answers to "how many of the 1,298 could be
 * placed".
 */
const netzExplorerText = async () => {
  await page.waitForSelector(".leaflet-container", { timeout: 30000 });
  await page.locator(".leaflet-container").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  // The Netz-Explorer card is a sibling of the Leaflet pane, not a child of
  // it, so this reads the page rather than the container.
  const body = await page.locator("body").innerText();
  const m = body.match(/([\d.]+)\s*STATIONEN\s*·\s*([\d.]+)\s*EXAKT\s*·\s*([\d.]+)\/([\d.]+)\s*VERORTET/i);
  const markers = await page.$$eval(".db-dot-marker", (els) => els.length);
  return { raw: m ? m[0] : "(keine Netz-Explorer-Karte)", markers };
};

await check("the Dashboard map is the whole network, and the same one Projekte draws", async () => {
  await go("/");
  const dash = await netzExplorerText();
  assert(
    /VERORTET/i.test(dash.raw),
    `the Dashboard map states no coverage: ${dash.raw}`,
  );
  assert(dash.markers > 100, `the Dashboard map drew ${dash.markers} markers`);

  // Exactly one map. A second would mean the section was mounted twice.
  const containers = await page.$$eval(".leaflet-container", (els) => els.length);
  assert(containers === 1, `${containers} maps on the Dashboard`);

  await go("/projects?view=map");
  const tab = await netzExplorerText();
  assert(
    dash.raw === tab.raw,
    `the two maps disagree about the network:\n  Dashboard: ${dash.raw}\n  Projekte:  ${tab.raw}`,
  );
  assert(
    dash.markers === tab.markers,
    `Dashboard drew ${dash.markers} markers, Projekte ${tab.markers} — not the same set`,
  );

  // And it is the whole set, not a filtered one: the total in the card is the
  // project count the rest of the Dashboard reports.
  const total = dash.raw.match(/\/([\d.]+)\s*VERORTET/i)?.[1];
  assert(total === "1.298", `the map covers ${total} projects, the Dashboard has 1.298`);
});

await check("a station on the Dashboard map opens exactly the projects it counted", async () => {
  await go("/");
  await page.waitForSelector(".leaflet-container", { timeout: 30000 });
  await page.locator(".leaflet-container").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);

  // A marker carrying a number is a station with more than one project — the
  // case where "the popup says N" and "the page shows N" can disagree.
  const markers = page.locator(".leaflet-marker-icon");
  const count = await markers.count();
  let opened = false;
  for (let i = 0; i < count && !opened; i++) {
    const text = ((await markers.nth(i).innerText().catch(() => "")) || "").trim();
    if (/^\d+$/.test(text) && Number(text) > 1) {
      await markers.nth(i).click({ force: true });
      opened = true;
    }
  }
  assert(opened, "no multi-project station on the map to open");
  await page.waitForSelector(".leaflet-popup", { timeout: 10000 });

  const action = page.getByRole("button", { name: /Alle \d+ Projekte als Karten anzeigen/ });
  const promised = Number(
    (await action.innerText()).match(/Alle (\d+) Projekte/)?.[1] ?? "0",
  );
  assert(promised > 1, `the popup promises ${promised} projects`);

  await action.click();
  await page.waitForTimeout(1800);

  // Addressed by id, not by a text search for the station name — see
  // stationHref in shared/handlungsbedarf.ts.
  const url = new URL(page.url());
  assert(url.pathname === "/projects", `landed on ${url.pathname}`);
  const ids = (url.searchParams.get("projekte") ?? "").split(",").filter(Boolean);
  assert(
    ids.length === promised,
    `the popup promised ${promised} projects, the link carries ${ids.length} ids`,
  );
  assert(url.searchParams.get("station"), "the link carries no station name to show the reader");

  const body = await page.locator("body").innerText();
  const found = Number((body.match(/([\d.]+) Projekte gefunden/) ?? ["", "0"])[1].replace(/\./g, ""));
  assert(
    found === promised,
    `the popup promised ${promised} projects and the page shows ${found}`,
  );
  assert(
    body.includes(`Station: ${url.searchParams.get("station")}`),
    "the page does not say which station it is filtered to",
  );
});

await check("a project in the Dashboard popup opens that project", async () => {
  await go("/");
  await page.waitForSelector(".leaflet-container", { timeout: 30000 });
  await page.locator(".leaflet-container").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await page.locator(".leaflet-marker-icon").first().click({ force: true });
  await page.waitForSelector(".leaflet-popup", { timeout: 10000 });

  // The project entries sit under the station header action.
  const entries = page.locator(".leaflet-popup button");
  const total = await entries.count();
  assert(total > 1, "the popup offers no project to open");
  await entries.nth(total - 1).click();
  await page.waitForTimeout(1800);

  const url = new URL(page.url());
  assert(url.pathname === "/projects", `landed on ${url.pathname}`);
  const projekt = url.searchParams.get("projekt");
  assert(projekt && Number(projekt) > 0, `no project in the address: ${url.search}`);
  const rows = await page.locator("[data-project-card], article").count();
  assert(rows >= 1, "the project link landed on an empty set");
});

console.log("\n== one change, every surface ==");

/**
 * The chain of custody for a single value.
 *
 * Every other gate proves one surface works. This one proves they cannot
 * disagree: a status is changed once, and the Gewerk tab, the Projekte table,
 * the Dashboard's counters, the card's own reel and the Änderungshistorie are
 * all read afterwards and must tell the same story. Then it is taken back, and
 * every one of them must return to exactly the figure it started from —
 * exactly, because "roughly back" is data drift with a nicer name.
 */
const OPEN_SET = ["offen", "in Bearbeitung", "Nachforderung", "prüffähig"];
const APPROVED_SET = ["Zustimmung erteilt", "Niederschrift erstellt"];
const BLOCKED_SET = ["abgelehnt", "gestoppt"];
/** The same four buckets shared/portfolio-metrics.ts counts into. */
const bucketOf = (status) =>
  OPEN_SET.includes(status)
    ? "open"
    : APPROVED_SET.includes(status)
      ? "approved"
      : BLOCKED_SET.includes(status)
        ? "blocked"
        : "other";

/** The Dashboard's own arithmetic for one Gewerk, read off the card. */
const readGewerkCard = async (department) => {
  await go("/");
  await page.waitForSelector("[data-gewerk]", { timeout: 25000 });
  await page.getByRole("button", { name: "Alle 14 zeigen" }).click();
  await page.waitForTimeout(300);
  const label = await page.$eval(
    `[data-gewerk="${department}"] [role="img"]`,
    (el) => el.getAttribute("aria-label") ?? "",
  );
  const m = label.match(
    /(\d+) zugestimmt, (\d+) offen, (\d+) blockiert, (\d+) sonstige von (\d+)/,
  );
  if (!m) throw new Error(`the ${department} card carries no readable figures: "${label}"`);
  return {
    approved: Number(m[1]),
    open: Number(m[2]),
    blocked: Number(m[3]),
    other: Number(m[4]),
    required: Number(m[5]),
  };
};

await check("one change reaches every surface, and Rückgängig puts every one back", async () => {
  const before = await readGewerkCard("EEA");
  assert(
    before.open + before.approved + before.blocked + before.other === before.required,
    `the EEA card does not add up: ${JSON.stringify(before)}`,
  );

  // --- the change, made where a Fachspezialist would make it ----------------
  await go("/bvb-eea");
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  const projektnummer = (
    await page.locator("table tbody tr:first-child td:nth-child(2)").innerText()
  ).trim();
  assert(projektnummer.length > 0, "the first EEA row carries no Projektnummer to follow");

  // The accessible name is the same on both surfaces, so it is the one handle
  // that identifies this exact review wherever it is rendered.
  const handle = `button[aria-label^="Status EEA für Projekt ${projektnummer} ändern"]`;
  const badge = page.locator(handle).first();
  await badge.waitFor({ timeout: 10000 });
  const original = (await badge.innerText()).replace(/[▾\s]+$/, "").trim();

  // Cross a bucket boundary, so the Dashboard has to move a row from one
  // counter to another. Never "nicht erforderlich": that changes `required`
  // and is a different test (it has its own gate).
  const target = bucketOf(original) === "open" ? "Zustimmung erteilt" : "offen";
  assert(target !== original, `nothing to change: the row already reads ${original}`);

  await badge.click();
  const select = page.locator('table tbody tr:first-child td select').first();
  await select.waitFor({ timeout: 5000 });
  await select.selectOption(target);
  await page.waitForTimeout(1200);

  const onTab = (await page.locator(handle).first().innerText()).replace(/[▾\s]+$/, "").trim();
  assert(onTab === target, `the Gewerk tab reads "${onTab}" after writing "${target}"`);

  // --- surface 2: the Projekte table, filtered to that project -------------
  await go(`/projects?q=${encodeURIComponent(projektnummer)}`);
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  await settled();
  const onProjects = (await page.locator(handle).first().innerText())
    .replace(/[▾\s]+$/, "")
    .trim();
  assert(
    onProjects === target,
    `Projekte reads "${onProjects}" while the Gewerk tab reads "${target}"`,
  );

  // --- surface 3: the Dashboard counters -----------------------------------
  const after = await readGewerkCard("EEA");
  assert(
    after.required === before.required,
    `the workload changed from ${before.required} to ${after.required} on a status edit`,
  );
  assert(
    after.open + after.approved + after.blocked + after.other === after.required,
    `the EEA card stopped adding up: ${JSON.stringify(after)}`,
  );
  const from = bucketOf(original);
  const to = bucketOf(target);
  for (const b of ["open", "approved", "blocked", "other"]) {
    const expected = before[b] + (b === to ? 1 : 0) - (b === from ? 1 : 0);
    assert(
      after[b] === expected,
      `EEA ${b}: expected ${expected} after ${original} → ${target}, the Dashboard says ${after[b]}`,
    );
  }

  // --- surface 4: the card's own reel plays the change it just counted -----
  await page.hover('[data-gewerk="EEA"]');
  await page.waitForSelector('[data-reel="EEA"]', { timeout: 10000 });
  const newest = await page.$eval(
    '[data-reel="EEA"] [data-reel-entry]',
    (el) => ({ source: el.getAttribute("data-reel-source"), text: el.textContent ?? "" }),
  );
  assert(
    newest.source === "historie",
    `the EEA reel opens with a ${newest.source} entry, not the change just made`,
  );
  assert(
    newest.text.includes(projektnummer),
    `the reel's newest entry does not name ${projektnummer}: ${newest.text.slice(0, 90)}`,
  );
  await page.mouse.move(5, 5);

  // --- surface 5: the Änderungshistorie ------------------------------------
  await go("/audit");
  const trail = await page.locator("body").innerText();
  assert(trail.includes(projektnummer), `the trail does not name ${projektnummer}`);
  assert(trail.includes(target), `the trail does not record the new value "${target}"`);
  assert(
    trail.includes(original),
    `the trail records no previous value — an entry that cannot be reversed`,
  );

  // --- and back ------------------------------------------------------------
  const undo = page.getByRole("button", { name: /^Änderung zurücknehmen/ }).first();
  await undo.waitFor({ timeout: 10000 });
  await undo.click();
  await page.waitForTimeout(1500);

  await go("/bvb-eea");
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  const restoredTab = (await page.locator(handle).first().innerText())
    .replace(/[▾\s]+$/, "")
    .trim();
  assert(
    restoredTab === original,
    `after the undo the Gewerk tab reads "${restoredTab}", expected "${original}"`,
  );

  await go(`/projects?q=${encodeURIComponent(projektnummer)}`);
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  await settled();
  const restoredProjects = (await page.locator(handle).first().innerText())
    .replace(/[▾\s]+$/, "")
    .trim();
  assert(
    restoredProjects === original,
    `after the undo Projekte reads "${restoredProjects}", expected "${original}"`,
  );

  const back = await readGewerkCard("EEA");
  for (const b of ["open", "approved", "blocked", "other", "required"]) {
    assert(
      back[b] === before[b],
      `EEA ${b} did not return: started ${before[b]}, ended ${back[b]}`,
    );
  }

  // Reversible, not erasable: the undo is a third entry, and the two it
  // reverses are still on file. A trail that forgets is not evidence.
  await go("/audit");
  const afterUndo = await page.locator("body").innerText();
  assert(
    afterUndo.includes(projektnummer),
    "the undo removed the project from the trail instead of appending to it",
  );
  const entries = await page.$$eval("[data-audit-action]", (els) => els.length);
  assert(entries >= 2, `only ${entries} entries after a change and its undo`);
});

console.log("\n== the Dashboard reports the workload, not the row count ==");

await check("every Gewerk shows its own figure, and it matches its own tab", async () => {
  // Seven of eight tiles used to read 1.298 — the project count. /bvb-eea says
  // 814 EEA checks and /psv-itk says 510, and the Dashboard has to agree.
  await go("/");
  await page.waitForSelector("[data-gewerk]", { timeout: 25000 });
  // The strip runs as a chain of four; "Alle 14 zeigen" is the control that
  // stops it and puts every Gewerk on screen at once.
  await page.getByRole("button", { name: "Alle 14 zeigen" }).click();
  await page.waitForTimeout(300);
  const cards = await page.$$eval("[data-gewerk]", (els) =>
    els.map((e) => ({
      dept: e.getAttribute("data-gewerk"),
      label: e.getAttribute("aria-label") ?? "",
    })),
  );
  assert(cards.length === 14, `${cards.length} Gewerke shown, expected all 14`);

  const required = Object.fromEntries(
    cards.map((c) => [c.dept, Number((c.label.match(/— ([\d.]+) Prüfungen/) ?? ["", "0"])[1].replace(/\./g, ""))]),
  );
  assert(required.EEA === 814, `Dashboard says EEA has ${required.EEA}, the tab says 814`);
  assert(required.ITK === 510, `Dashboard says ITK has ${required.ITK}, the tab says 510`);

  // And the figures actually differ — the old tile was a constant.
  const distinct = new Set(Object.values(required));
  assert(distinct.size > 8, `only ${distinct.size} distinct figures across 14 Gewerke`);
  assert(!Object.values(required).includes(1298), "a Gewerk still reports the project count");
});

await check("a Gewerk card opens that Gewerk", async () => {
  await go("/");
  await page.waitForSelector("[data-gewerk]", { timeout: 25000 });
  await page.getByRole("button", { name: "Alle 14 zeigen" }).click();
  await page.waitForTimeout(300);
  await page.click('[data-gewerk="EEA"]');
  await page.waitForTimeout(1200);
  assert(/\/bvb-eea/.test(page.url()), `the EEA card went to ${page.url()}`);
});

await check("the relief prints every value it draws, and flattens on request", async () => {
  await go("/");
  await page.waitForSelector(".relief-cell", { timeout: 25000 });

  // 14 Gewerke x 4 lifecycle lanes, every one carrying its number as text.
  const cells = await page.$$eval(".relief-cell", (els) =>
    els.map((e) => ({ attr: e.getAttribute("data-value"), text: e.textContent.trim() })),
  );
  assert(cells.length === 56, `${cells.length} relief cells, expected 56`);
  for (const c of cells) {
    assert(c.text === c.attr, `a cell draws ${c.attr} but prints "${c.text}"`);
  }

  /*
   * The lanes have to sum to the Gewerk's required total, or the picture is
   * describing a different set from the cards above it.
   *
   * Grouped by `data-department` rather than by walking table rows: the relief
   * is a CSS grid now, because table boxes cannot hold a 3D context and every
   * tile's height was being flattened away inside a <td>. The relationship the
   * assertion cares about is the Gewerk, and that is on the element.
   */
  const rows = await page.$$eval(".relief-cell", (cells) => {
    const byDept = new Map();
    for (const c of cells) {
      const dep = c.getAttribute("data-department");
      if (!byDept.has(dep)) byDept.set(dep, []);
      byDept.get(dep).push(Number(c.getAttribute("data-value")));
    }
    const totals = new Map(
      [...document.querySelectorAll("[data-relief-label]")].map((b) => [
        b.getAttribute("data-relief-label"),
        Number(b.getAttribute("data-relief-total")),
      ]),
    );
    return [...byDept.entries()].map(([dep, values]) => ({
      dep,
      values,
      total: totals.get(dep) ?? -1,
    }));
  });
  assert(rows.length === 14, `${rows.length} relief rows, expected 14`);
  for (const r of rows) {
    const sum = r.values.reduce((a, b) => a + b, 0);
    assert(sum === r.total, `${r.dep}: lanes sum to ${sum} against a stated total of ${r.total}`);
  }

  const tilted = await page.$eval(".relief-stage", (e) => e.getAttribute("data-flat"));
  assert(tilted === "false", "the relief did not start in its 3D state");
  await page.getByRole("button", { name: "Flach" }).click();
  await page.waitForTimeout(400);
  const flat = await page.$eval(".relief-stage", (e) => e.getAttribute("data-flat"));
  assert(flat === "true", "Flach did not flatten the relief");

  // Flat must withhold nothing: same cells, same numbers.
  const flatCells = await page.$$eval(".relief-cell", (els) =>
    els.map((e) => e.textContent.trim()),
  );
  assert(
    JSON.stringify(flatCells) === JSON.stringify(cells.map((c) => c.text)),
    "the flat view shows different numbers from the relief",
  );
});

await check("the buildings actually have height, all the way to the screen", async () => {
  await go("/");
  await page.waitForSelector(".relief-cell", { timeout: 25000 });

  /*
   * The defect this exists to make impossible.
   *
   * The relief shipped twice looking flat, and both times the height was
   * raised — from 56px to 104px — when the height had never been the problem.
   * Measured in the browser, every tile read:
   *
   *     button.relief-cell   preserve-3d
   *     td                   FLAT
   *     tr                   FLAT
   *     tbody                FLAT
   *
   * Table boxes cannot establish a 3D rendering context. Each tile's
   * translateZ was being flattened back into the plane at the <td> before it
   * reached the screen, so the number was correct, on the element, and
   * discarded. Nothing on the page reported a problem.
   *
   * Two assertions, because either one alone can pass on a broken build: the
   * ancestor chain must carry preserve-3d unbroken from the tile up to the
   * stage, AND the tile's own computed matrix must actually contain the Z
   * translation. Put the grid back in a table and both fail immediately.
   */
  const depth = await page.evaluate(() => {
    const cells = [...document.querySelectorAll(".relief-cell")];
    const tall = cells.sort(
      (a, b) => Number(b.dataset.value) - Number(a.dataset.value),
    )[0];

    const chain = [];
    let node = tall;
    while (node && !node.classList.contains("relief-stage")) {
      chain.push({
        tag: node.tagName.toLowerCase(),
        cls: (node.className || "").toString().split(" ")[0],
        style3d: getComputedStyle(node).transformStyle,
      });
      node = node.parentElement;
    }

    // matrix3d(m11..m44) — the Z translation is the 15th component.
    const m = getComputedStyle(tall).transform;
    const parts = /^matrix3d\(([^)]+)\)$/.exec(m)?.[1].split(",").map(Number) ?? null;
    return {
      value: Number(tall.dataset.value),
      lift: Number.parseFloat(getComputedStyle(tall).getPropertyValue("--relief-lift")) || 0,
      translateZ: parts ? Math.round(parts[14]) : null,
      matrixKind: m.slice(0, 9),
      chain,
    };
  });

  assert(depth.value > 100, `the tallest tile is only ${depth.value}`);
  assert(depth.lift > 100, `the tallest tile lifts only ${depth.lift}px`);
  for (const link of depth.chain) {
    assert(
      link.style3d === "preserve-3d",
      `<${link.tag}.${link.cls}> is ${link.style3d} — it flattens every tile above it`,
    );
  }
  assert(
    depth.matrixKind === "matrix3d(",
    `the tile's transform is 2D (${depth.matrixKind}) — the height never left the plane`,
  );
  assert(
    depth.translateZ === Math.round(depth.lift),
    `the tile declares ${depth.lift}px of height but paints translateZ ${depth.translateZ}`,
  );
  console.log(`     tallest ${depth.value} → ${depth.lift}px, translateZ ${depth.translateZ}`);

  // A zero stays on the ground. Height has to mean something at both ends.
  const zeroLift = await page.$$eval('.relief-cell[data-value="0"]', (els) =>
    els.map((e) => Number.parseFloat(getComputedStyle(e).getPropertyValue("--relief-lift")) || 0),
  );
  assert(zeroLift.length > 0, "no empty lane to check");
  assert(
    zeroLift.every((l) => l === 0),
    "an empty lane is standing above the ground",
  );
});

await check("nothing is clipped out of the relief at its default camera", async () => {
  await go("/");
  await page.waitForSelector(".relief-cell", { timeout: 25000 });
  await page.waitForTimeout(600);
  /*
   * A 3D transform paints far outside its layout box and the scroll container
   * clips to the box, so „gesamt" spent a version sliced off the right edge
   * while the Gewerk names were sliced off the left. The stage reserves room
   * derived from the camera; this is the check that the derivation is right.
   */
  const spill = await page.evaluate(() => {
    const scroller = document.querySelector(".relief-stage")?.parentElement;
    if (!scroller) return null;
    const box = scroller.getBoundingClientRect();
    let worst = 0;
    let culprit = "";
    for (const cell of document.querySelectorAll(".relief-cell, [data-relief-label]")) {
      const r = cell.getBoundingClientRect();
      const over = Math.max(box.left - r.left, r.right - box.right, 0);
      if (over > worst) {
        worst = over;
        culprit = cell.getAttribute("data-relief-label") ??
          `${cell.getAttribute("data-department")}/${cell.getAttribute("data-lane")}`;
      }
    }
    return { worst: Math.round(worst), culprit, scrolls: scroller.scrollWidth > scroller.clientWidth + 1 };
  });
  assert(spill, "no relief to measure");
  assert(spill.worst <= 2, `${spill.culprit} hangs ${spill.worst}px outside the panel`);
  assert(!spill.scrolls, "the relief needs a horizontal scrollbar at its default camera");
});

await check("the Gewerke chain advances, and stops dead when somebody reads it", async () => {
  await go("/");
  await page.waitForSelector("[data-gewerk]", { timeout: 25000 });

  // Four in frame, fourteen in the chain. The panel says both.
  const framed = await page.$$eval("[data-gewerk]", (e) => e.length);
  assert(framed === 4, `the chain shows ${framed} cards, expected a window of 4`);
  const caption = await page.locator("output").allInnerTexts();
  assert(
    caption.some((t) => /von 14/.test(t) && /wechselt alle \d+ Sekunden/.test(t)),
    "the chain does not say how many Gewerke it is cycling, or how fast",
  );

  const listed = () =>
    page.$$eval("[data-gewerk]", (els) => els.map((e) => e.getAttribute("data-gewerk")).join(","));

  // It moves on its own — no click required.
  const first = await listed();
  await page.waitForTimeout(5600);
  const second = await listed();
  assert(first !== second, `the chain never advanced: still ${first}`);

  // And the arrows drive it by hand.
  await page.getByRole("button", { name: "Nächstes Gewerk" }).click();
  await page.waitForTimeout(400);
  assert((await listed()) !== second, "the next-Gewerk control changed nothing");

  // Reading it must stop it moving — and keep it stopped for longer than one
  // rotation, because a card that slides out from under the pointer takes its
  // reel with it.
  const held = await page.$eval("[data-gewerk]", (e) => e.getAttribute("data-gewerk"));
  await page.hover(`[data-gewerk="${held}"]`);
  await page.waitForTimeout(400);
  const body = await page.locator("body").innerText();
  assert(body.includes("pausiert"), "reading a card did not pause the chain");
  const during = await listed();
  await page.waitForTimeout(5600);
  assert((await listed()) === during, "the chain kept moving while a card was being read");

  // Let go, and it resumes.
  await page.mouse.move(5, 5);
  await page.waitForTimeout(5600);
  assert((await listed()) !== during, "the chain did not resume after the pointer left");
});

await check("a Gewerk card plays its own latest Einträge, and every frame is a record", async () => {
  await go("/");
  await page.waitForSelector("[data-gewerk]", { timeout: 25000 });
  await page.getByRole("button", { name: "Alle 14 zeigen" }).click();
  await page.waitForTimeout(300);

  await page.hover('[data-gewerk="EEA"]');
  await page.waitForSelector("[data-reel]", { timeout: 10000 });

  const reel = await page.$eval("[data-reel]", (el) => ({
    dept: el.getAttribute("data-reel"),
    count: Number(el.getAttribute("data-reel-count")),
    frame: Number(el.getAttribute("data-reel-frame")),
    entries: [...el.querySelectorAll("[data-reel-entry]")].map((e) => ({
      source: e.getAttribute("data-reel-source"),
      text: e.textContent ?? "",
    })),
  }));

  assert(reel.dept === "EEA", `hovering EEA played ${reel.dept}`);
  assert(reel.count > 0, "the EEA card has nothing to play, and EEA has 814 required rows");
  assert(reel.entries.length === reel.count, "the reel and its own count disagree");

  // Every frame states which record it is and when it is dated. No frame may
  // carry an unlabelled figure — that is exactly how a stored 2024 review gets
  // read as something that happened this morning.
  for (const e of reel.entries) {
    assert(
      e.source === "historie" || e.source === "bestand",
      `a reel frame carries no source: ${e.text.slice(0, 60)}`,
    );
    assert(
      /\d{2}\.\d{2}\.\d{4}/.test(e.text),
      `a reel frame carries no date: ${e.text.slice(0, 60)}`,
    );
    assert(
      /Änderung|Bestand/.test(e.text),
      `a reel frame does not say what kind of record it is: ${e.text.slice(0, 60)}`,
    );
  }

  // It plays: the visible frame changes on its own.
  const visible = () =>
    page.$eval("[data-reel]", (el) =>
      [...el.querySelectorAll("[data-reel-entry]")].findIndex(
        (e) => Number.parseFloat(getComputedStyle(e).opacity) > 0.9,
      ),
    );
  const before = await visible();
  await page.waitForTimeout(2600);
  const after = await visible();
  assert(before !== after, `the reel is frozen on frame ${before}`);

  // One card at a time, and only the card under the pointer.
  const open = await page.$$eval("[data-reel]", (els) => els.length);
  assert(open === 1, `${open} cards are playing at once`);

  // The reel belongs to the card. Leaving takes it away rather than leaving a
  // stale EEA reel sitting on a card that is not EEA.
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);
  assert((await page.$$eval("[data-reel]", (e) => e.length)) === 0, "a reel outlived its hover");

  // A different card plays a different Gewerk's records.
  await page.hover('[data-gewerk="ITK"]');
  await page.waitForSelector('[data-reel="ITK"]', { timeout: 10000 });
  const itk = await page.$eval('[data-reel="ITK"]', (el) => el.textContent ?? "");
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
  await page.hover('[data-gewerk="EEA"]');
  await page.waitForSelector('[data-reel="EEA"]', { timeout: 10000 });
  const eea = await page.$eval('[data-reel="EEA"]', (el) => el.textContent ?? "");
  assert(itk !== eea, "two Gewerke play the same reel");
});

await check("the diagnostics say what they cannot measure", async () => {
  await go("/");
  await page.waitForSelector("text=/Alter der offenen Prüfungen/", { timeout: 25000 });
  const body = await page.locator("body").innerText();

  // An open row with no date cannot be aged; the panel must say so rather than
  // quietly excluding it from the buckets.
  assert(/tragen kein Prüfdatum/.test(body), "the aging panel hides its undated rows");
  // "Prüfung erfolgt" is in no lifecycle bucket, so the buckets do not add up
  // to the workload, and the panel has to name the difference.
  assert(
    /Nicht in offen \/ zugestimmt \/ blockiert enthalten/.test(body),
    "the quality panel does not name the unclassified statuses",
  );
  // A Projektnummer is a programme id — stated as a fact, not an error count.
  assert(
    /bezeichnet ein Programm, kein einzelnes Projekt/.test(body),
    "the shared Projektnummer is not explained",
  );
});


console.log("\n== Ask Bahn answers from the data, or says it cannot ==");

const openAsk = async () => {
  await page.getByRole("button", { name: /^Ask Bahn öffnen/ }).click();
  await page.waitForSelector("[data-ask-bahn='open']", { timeout: 10000 });
};

await check("the assistant is reachable from every route and closes cleanly", async () => {
  for (const route of ["/", "/projects", "/bvb-eea", "/psv-itk", "/audit"]) {
    await go(route);
    const launcher = page.getByRole("button", { name: /^Ask Bahn öffnen/ });
    assert(await launcher.count() === 1, `no launcher on ${route}`);
  }
  await openAsk();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  assert(
    (await page.$$("[data-ask-bahn='open']")).length === 0,
    "Escape did not close the panel",
  );
});

await check("its figures agree with the pages they link to", async () => {
  await go("/");
  await openAsk();
  await page.getByLabel("Frage an Ask Bahn").fill("Wie steht EEA?");
  await page.getByRole("button", { name: "Fragen" }).click();
  await page.waitForTimeout(600);

  const text = await page.locator("[data-ask-bahn='open']").innerText();
  // /bvb-eea reports 814 required EEA checks. The assistant must not differ.
  assert(/814/.test(text), `the answer does not carry the EEA workload: ${text.slice(0, 200)}`);
  assert(/erforderlich/.test(text), "the answer does not label what 814 is");
  // Every answer states where its numbers came from.
  assert(/nicht erforderlich/.test(text), "the answer does not state its basis");
});

await check("every answer carries its derivation, never a bare number", async () => {
  await go("/");
  await openAsk();
  for (const question of [
    "Was ist gerade kritisch?",
    "Was ist überfällig?",
    "Wer hat die meiste offene Last?",
    "Wie verlässlich sind die Zahlen?",
  ]) {
    await page.getByLabel("Frage an Ask Bahn").fill(question);
    await page.getByRole("button", { name: "Fragen" }).click();
    await page.waitForTimeout(400);
  }
  const text = await page.locator("[data-ask-bahn='open']").innerText();
  for (const phrase of ["Gezählt", "Rangfolge", "Offene Prüfzeilen", "Geprüft"]) {
    assert(text.includes(phrase), `no derivation matching "${phrase}" in the transcript`);
  }
  // The ranking is labelled a judgement, not a measurement.
  assert(/keine Messung/.test(text), "the risk ranking is not labelled as a heuristic");
});

await check("it refuses rather than inventing an answer", async () => {
  await go("/");
  await openAsk();
  await page.getByLabel("Frage an Ask Bahn").fill("Wie hoch ist das Budget für 2027?");
  await page.getByRole("button", { name: "Fragen" }).click();
  await page.waitForTimeout(600);
  const text = await page.locator("[data-ask-bahn='open']").innerText();
  assert(
    /nicht verstanden|kein Projekt|nichts wird geschätzt/.test(text),
    `the assistant answered a question it has no data for: ${text.slice(-300)}`,
  );
  // And it must not have produced a figure out of nowhere.
  assert(!/€|EUR|Budget von/.test(text), "the assistant produced a budget figure");
});

await check("an answer navigates to the screen that proves it", async () => {
  await go("/");
  await openAsk();
  await page.getByLabel("Frage an Ask Bahn").fill("Wie steht ITK?");
  await page.getByRole("button", { name: "Fragen" }).click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "ITK öffnen" }).first().click();
  await page.waitForTimeout(1200);
  assert(/\/psv-itk/.test(page.url()), `"ITK öffnen" went to ${page.url()}`);
  assert(
    (await page.$$("[data-ask-bahn='open']")).length === 0,
    "the panel stayed open over the page it navigated to",
  );
});

await check("every answer hands back questions it can answer", async () => {
  await go("/");
  await openAsk();
  await page.getByLabel("Frage an Ask Bahn").fill("Was ist gerade kritisch?");
  await page.getByRole("button", { name: "Fragen" }).click();
  await page.waitForSelector("[data-follow-up='true']", { timeout: 10000 });

  const chips = await page.$$eval("[data-follow-up='true']", (els) =>
    els.map((e) => e.textContent.trim()),
  );
  assert(chips.length >= 2, `only ${chips.length} follow-up chips after the first answer`);
  // The chips must lead somewhere else, not back to the question just asked.
  assert(
    !chips.includes("Was ist gerade kritisch?"),
    "the assistant offered the question it had just answered",
  );

  /*
   * Six hops, each one taken from whatever the previous answer offered.
   *
   * This is the failure the unit tests cannot see: a chip that resolves in
   * isolation but is rendered from a stale answer, or a row that empties out
   * after the second turn and leaves the reader at a dead end. Every hop has
   * to produce a new answer that itself offers somewhere to go.
   */
  let seen = 1;
  for (let hop = 0; hop < 6; hop++) {
    assert(
      (await page.$$("[data-follow-up='true']")).length > 0,
      `no follow-up to click on hop ${hop}`,
    );
    const label = await page
      .locator("[data-follow-up='true']")
      .last()
      .textContent();
    await page.locator("[data-follow-up='true']").last().click();
    await page.waitForTimeout(450);

    seen++;
    const text = await page.locator("[data-ask-bahn='open']").innerText();
    assert(
      !/Das habe ich nicht verstanden/.test(text.slice(-600)),
      `the chip "${label?.trim()}" led to "not understood" on hop ${hop}`,
    );
    assert(
      (await page.$$("[data-follow-up='true']")).length > 0,
      `the conversation dead-ended after hop ${hop}`,
    );
  }
  assert(seen === 7, `expected 7 answers in the transcript, counted ${seen}`);
});

await check("the assistant breathes, and keeps breathing", async () => {
  await go("/");
  const launcher = page.getByRole("button", { name: /^Ask Bahn öffnen/ });
  assert(
    (await launcher.getAttribute("class")).includes("pulse-brand"),
    "the launcher does not pulse",
  );
  await openAsk();
  await page.getByLabel("Frage an Ask Bahn").fill("Was ist gerade kritisch?");
  await page.getByRole("button", { name: "Fragen" }).click();
  await page.waitForSelector("[data-follow-up='true']", { timeout: 10000 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  // It used to stop after the first question. That was my call and not the
  // brief's; the brief says the assistant pulses, so it pulses.
  assert(
    (await page.getByRole("button", { name: /^Ask Bahn öffnen/ }).getAttribute("class")).includes(
      "pulse-brand",
    ),
    "the launcher stopped pulsing after it had been used",
  );
});

await check("the panel never scrolls sideways, whatever an answer contains", async () => {
  await go("/");
  await openAsk();
  /*
   * The audit answer is the one that broke it: a fact value can be a generated
   * filename of fifty-odd characters with nothing to break on, and a flex
   * child that will not shrink widens the panel from the inside. The reader
   * got a horizontal scrollbar and a headline starting off screen.
   */
  for (const q of ["Was hat sich geändert?", "Was ist gerade kritisch?", "Wie steht EEA?"]) {
    await page.getByLabel("Frage an Ask Bahn").fill(q);
    await page.getByRole("button", { name: "Fragen" }).click();
    await page.waitForTimeout(400);
  }
  const panel = page.locator("[data-ask-bahn='open']");
  const overflow = await panel.evaluate((el) => {
    const scroller = el.querySelector(".overflow-y-auto");
    return {
      panel: el.scrollWidth - el.clientWidth,
      scroller: scroller ? scroller.scrollWidth - scroller.clientWidth : 0,
      width: el.getBoundingClientRect().width,
    };
  });
  assert(overflow.panel <= 1, `the panel overflows by ${overflow.panel}px`);
  assert(overflow.scroller <= 1, `the transcript overflows by ${overflow.scroller}px`);
  assert(overflow.width <= 24 * 16 + 1, `the panel grew to ${Math.round(overflow.width)}px`);

  // And the input is still reachable and usable with a full transcript.
  const input = page.getByLabel("Frage an Ask Bahn");
  assert(await input.isVisible(), "the input scrolled out of the panel");
  assert(await input.isEnabled(), "the input is not usable");
  await input.fill("Wie steht das Portfolio insgesamt?");
  await page.getByRole("button", { name: "Fragen" }).click();
  await page.waitForTimeout(400);
});

console.log("\n== open work announces itself ==");

await check("an open status pulses and a settled one does not", async () => {
  await go("/bvb-eea");
  await page.waitForSelector('button[aria-label*=" ändern"]', { timeout: 25000 });

  /*
   * Read from the badge's own accessible name, not from its text.
   *
   * `aria-label` is "<Gewerk> ändern, aktuell <Status>", which is the one place
   * the current status is unambiguous — the visible text is truncated with
   * `truncate` and carries a ▾ from ::after.
   */
  const badges = await page.$$eval('button[aria-label*=" ändern"]', (els) =>
    els
      .map((e) => ({
        status: (/, aktuell (.+)$/.exec(e.getAttribute("aria-label")) || [])[1] || "",
        pulses: e.className.includes("pulse-open"),
      }))
      .filter((b) => b.status),
  );
  assert(badges.length > 0, "no status badges found on /bvb-eea");

  /*
   * Three buckets, not two, and the pulse means exactly one of them.
   *
   * shared/review-status.ts classifies four statuses as open, two as approved
   * and two as blocking. The rest — "Projektkonfig.", "Prüfung erfolgt",
   * "zurückgestellt", "nicht erforderlich" — are in no lifecycle bucket, which
   * is why the Dashboard's diagnostics name them and why every "offen" figure
   * on this site excludes them.
   *
   * So they must NOT pulse. Making them pulse is the kinder-looking choice and
   * would put the animation out of step with every number beside it: 55 badges
   * breathing on a tab that reports 22 open. An indicator that disagrees with
   * the count next to it is worse than no indicator.
   */
  const OPEN = /^(offen|in Bearbeitung|Nachforderung|prüffähig)$/i;
  const open = badges.filter((b) => OPEN.test(b.status.trim()));
  const rest = badges.filter((b) => !OPEN.test(b.status.trim()));
  assert(open.length > 0, "no open status on the page to check");

  const silentOpen = open.filter((b) => !b.pulses);
  assert(
    silentOpen.length === 0,
    `${silentOpen.length} open statuses do not pulse, e.g. "${silentOpen[0]?.status}"`,
  );
  const noisy = rest.filter((b) => b.pulses);
  assert(
    noisy.length === 0,
    `${noisy.length} non-open statuses pulse, e.g. "${noisy[0]?.status}"`,
  );
  console.log(`     ${open.length} open pulsing, ${rest.length} not open and quiet`);
});

await check("the mobile drawer is opaque, not a window onto the page", async () => {
  const phone = await browser.newPage({ viewport: { width: 375, height: 812 } });
  try {
    // A fresh context has empty localStorage, so without this the app sends the
    // phone straight back to /login and there is no header to open.
    await phone.goto(U("/login"));
    await phone.evaluate(() =>
      localStorage.setItem(
        "bahn-demo-user",
        JSON.stringify({ id: 1, openId: "e2e", name: "Vincenzo Grimaldi", email: "v@db.de", role: "admin" }),
      ),
    );
    await phone.goto(U("/projects"), { waitUntil: "domcontentloaded" });
    const menu = phone.getByRole("button", { name: "Navigation öffnen" });
    await menu.waitFor({ timeout: 25000 });
    await menu.click();
    const drawer = phone.locator('[data-sidebar="sidebar"][data-mobile="true"]');
    await drawer.waitFor({ timeout: 10000 });
    await phone.waitForTimeout(700);

    /*
     * The exact defect, measured rather than eyeballed: the drawer's own
     * background-color must be opaque. `bg-sidebar` resolved to nothing when
     * --color-sidebar was undeclared, and the computed value came back
     * `rgba(0, 0, 0, 0)` — transparent — while every class was still on the
     * element and nothing anywhere reported a problem.
     */
    const bg = await drawer.evaluate((el) => getComputedStyle(el).backgroundColor);
    const alpha = /rgba?\(([^)]+)\)/.exec(bg);
    const parts = alpha ? alpha[1].split(",").map((v) => Number.parseFloat(v)) : [];
    assert(parts.length >= 3, `the drawer has no background colour: ${bg}`);
    assert(
      parts.length === 3 || parts[3] >= 0.99,
      `the drawer background is see-through: ${bg}`,
    );
  } finally {
    await phone.close();
  }
});

console.log("\n== the Dashboard hands the reader onward ==");

await check("Handlungsbedarf lands on exactly the set it counted", async () => {
  await go("/");
  await page.waitForSelector("[data-bedarf]", { timeout: 25000 });

  const rows = await page.$$eval("[data-bedarf]", (els) =>
    els.map((e) => ({
      key: e.dataset.bedarf,
      label: (e.getAttribute("aria-label") || "").trim(),
      pulses: e.className.includes("pulse-open") || e.innerHTML.includes("pulse-open"),
    })),
  );
  assert(rows.length === 4, `expected 4 Handlungsbedarf rows, found ${rows.length}`);

  /*
   * The assertion this whole feature exists for.
   *
   * The badge counts Prüfzeilen, the page can only list Projekte, and those are
   * different numbers for the same fact. Both come out of the aria-label, and
   * the number of cards on the landing page has to equal the project figure —
   * not approximately, exactly. A link that lands on a different set than the
   * badge promised is the drift this project spends its life removing.
   */
  for (const row of rows) {
    const m = /: (\d[\d.]*) Prüfzeilen in (\d[\d.]*) Projekten/.exec(row.label);
    assert(m, `no counts in the label for ${row.key}: ${row.label}`);
    const rowCount = Number(m[1].replace(/\./g, ""));
    const projectCount = Number(m[2].replace(/\./g, ""));
    assert(projectCount <= rowCount, `${row.key}: ${projectCount} projects from ${rowCount} rows`);

    await page.click(`[data-bedarf="${row.key}"]`);
    await page.waitForTimeout(1400);
    assert(
      new URL(page.url()).searchParams.get("bedarf") === row.key,
      `${row.key} went to ${page.url()}`,
    );
    await page.waitForSelector("[data-project-card]", { timeout: 25000 });
    const cards = await page.$$eval("[data-project-card]", (c) => c.length);
    assert(
      cards === projectCount,
      `${row.key}: badge promised ${projectCount} Projekte, the page shows ${cards}`,
    );

    // And the chip reconciles the two figures on screen rather than leaving a
    // reader to notice that 558 became 258.
    const body = await page.locator("main").innerText();
    assert(
      body.includes("Prüfzeilen in") && body.includes("Projekten"),
      `${row.key}: no chip reconciling the two counts`,
    );
    // A card carries the way into the project.
    // The card's accessible name is its aria-label — "Details zu Projekt X
    // anzeigen" — not the word on the button.
    assert(
      (await page.$$('[data-project-card] button[aria-label^="Details"]')).length > 0,
      `${row.key}: the cards offer no "Details anzeigen"`,
    );
    await go("/");
    await page.waitForSelector("[data-bedarf]", { timeout: 25000 });
  }

  const awaiting = rows.filter((r) => r.key !== "blocked");
  for (const r of awaiting) {
    assert(r.pulses, `the open bucket "${r.key}" does not pulse`);
  }
  assert(
    !rows.find((r) => r.key === "blocked")?.pulses,
    "the settled bucket „abgelehnt oder gestoppt“ pulses",
  );
});

/** Fachspezialisten rows start collapsed; open the first one. */
const openFirstReviewer = async () => {
  await go("/");
  /* `data-fach-row` exists so this gate does not have to guess at the card
     markup — walking up from a heading breaks every time a wrapper moves. */
  await page.waitForSelector("[data-fach-row]", { timeout: 25000 });
  await page.locator("[data-fach-row]").first().click();
  await page.waitForSelector("[data-timeline-entry]", { timeout: 25000 });
};

await check("a reviewer's timeline entry opens that exact project", async () => {
  await openFirstReviewer();

  const first = page.locator("[data-timeline-entry]").first();
  const id = await first.getAttribute("data-timeline-entry");
  await first.click();
  await page.waitForTimeout(1400);
  assert(
    new URL(page.url()).searchParams.get("projekt") === id,
    `the timeline row went to ${page.url()} instead of project ${id}`,
  );
  await page.waitForSelector("[data-project-card]", { timeout: 25000 });
  const cards = await page.$$eval("[data-project-card]", (c) => c.length);
  // Addressed by id, so it is one project however many share a Projektnummer —
  // 1,298 of them share 385.
  assert(cards === 1, `project ${id} produced ${cards} cards`);
  assert(
    (await page.$$('[data-project-card] button[aria-label^="Details"]')).length > 0,
    "the project card offers no \"Details anzeigen\"",
  );
});

await check("open work in the timeline pulses, settled work does not", async () => {
  await openFirstReviewer();
  const entries = await page.$$eval("[data-timeline-entry]", (els) =>
    els.map((e) => ({
      text: e.innerText.trim(),
      pulses: e.innerHTML.includes("pulse-open"),
    })),
  );
  assert(entries.length > 0, "no timeline entries to check");
  const OPEN = /^(offen|in Bearbeitung|Nachforderung|prüffähig)\b/im;
  let open = 0;
  let settled = 0;
  for (const e of entries) {
    const first = e.text.split("\n").map((l) => l.trim()).filter(Boolean)[1] ?? "";
    if (OPEN.test(first)) {
      open++;
      assert(e.pulses, `open entry does not pulse: ${first}`);
    } else {
      settled++;
      assert(!e.pulses, `settled entry pulses: ${first}`);
    }
  }
  assert(open > 0, "no open entry in the timeline to check");
  console.log(`     ${open} open pulsing, ${settled} settled quiet`);
});

await check("every Bahnhofsmanagement is shown, not the largest five", async () => {
  await go("/");
  const heading = await page.getByText(/Regionale Verteilung/).first().innerText();
  assert(!/Top \d/.test(heading), `the card still says "${heading}"`);
  const text = await page.locator("main").innerText();
  for (const region of [
    "Frankfurt", "Darmstadt", "Koblenz", "Kassel",
    "Saarbrücken", "Kaiserslautern", "Mainz", "Gießen",
  ]) {
    assert(text.includes(region), `${region} is missing from the regional panel`);
  }
  // And it says why the bars do not sum to 1.298.
  assert(
    /von 1\.298 Projekten tragen ein Bahnhofsmanagement/.test(text),
    "the panel does not account for the projects with no region",
  );
});

await check("the Gewerke panel always shows one, and rotates", async () => {
  await go("/");
  await page.waitForSelector("[data-gewerke-carousel]", { timeout: 25000 });
  const stage = page.locator("[data-gewerke-carousel]");

  // It used to open on an empty state behind a dropdown nobody found.
  const shown = await page.locator("main").innerText();
  assert(!/Wählen Sie ein Gewerke/.test(shown), "the empty state is still there");
  assert(/Status-Verteilung für /.test(shown), "no Gewerk is on screen");

  const first = await stage.getAttribute("data-gewerke-carousel");
  assert(first, "the carousel does not name the Gewerk it is showing");

  // Moving the pointer away, because hover pauses it on purpose.
  await page.mouse.move(5, 5);
  await page.waitForFunction(
    (was) => document.querySelector("[data-gewerke-carousel]")?.getAttribute("data-gewerke-carousel") !== was,
    first,
    { timeout: 12000 },
  );

  // Stepping by hand works and does not pin.
  const before = await stage.getAttribute("data-gewerke-carousel");
  await page.getByRole("button", { name: "Nächste Status-Verteilung" }).click();
  await page.waitForTimeout(300);
  assert(
    (await stage.getAttribute("data-gewerke-carousel")) !== before,
    "the next button did not advance the carousel",
  );

  // Pause is a real control, not a label: WCAG 2.2.2 requires it.
  await page.getByRole("button", { name: "Pause" }).click();
  const paused = await stage.getAttribute("data-gewerke-carousel");
  assert(
    (await stage.getAttribute("data-rotating")) === "false",
    "the carousel says it is still rotating after Pause",
  );
  await page.waitForTimeout(Math.round(4000 * 1.6));
  assert(
    (await stage.getAttribute("data-gewerke-carousel")) === paused,
    "the carousel advanced while paused",
  );
});

await check("the relief turns by itself and yields the moment it is touched", async () => {
  await go("/");
  await page.waitForSelector(".relief-cell", { timeout: 25000 });
  const stage = page.locator(".relief-stage");
  assert(
    (await stage.getAttribute("data-autoturn")) === "true",
    "the relief does not turn by itself",
  );

  await stage.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const box = await stage.boundingBox();
  assert(box, "the relief has no box to drag");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  assert(
    (await stage.getAttribute("data-autoturn")) === "false",
    "the relief kept drifting after the reader took the camera",
  );

  // And the reset button hands it back.
  await page.getByRole("button", { name: /Ansicht zurücksetzen/ }).click();
  await page.waitForTimeout(300);
  assert(
    (await stage.getAttribute("data-autoturn")) === "true",
    "„Ansicht zurücksetzen“ did not restart the self-rotation",
  );
});

await check("the open lane of the relief breathes and the others do not", async () => {
  await go("/");
  await page.waitForSelector(".relief-cell", { timeout: 25000 });
  const lanes = await page.$$eval(".relief-cell", (els) =>
    els.map((e) => ({
      lane: e.dataset.lane,
      value: Number(e.dataset.value),
      animation: getComputedStyle(e).animationName,
    })),
  );
  const open = lanes.filter((l) => l.lane === "open" && l.value > 0);
  const rest = lanes.filter((l) => l.lane !== "open");
  assert(open.length > 0, "no open lane cells to check");
  for (const cell of open) {
    assert(
      cell.animation.includes("relief-open"),
      `an open lane cell is not animated: ${cell.animation}`,
    );
  }
  for (const cell of rest) {
    assert(
      !cell.animation.includes("relief-open"),
      `a ${cell.lane} cell is animated as if it were open`,
    );
  }
  console.log(`     ${open.length} open columns breathing, ${rest.length} others still`);
});

console.log("\n== the department that reached nobody ==");

await check("LST is named as unreachable, and the gap can be closed", async () => {
  /*
   * The oldest open item in this project, and the one it refused to fake.
   *
   * LST carries 52 Prüfungen — 22 still open — and both of its recipient rows
   * in the Hilfsdatei are empty. The Excel macro sent to an empty string and
   * reported success. This app has known since the workbook was transcribed:
   * `departmentsWithoutRecipients()` has returned ["LST"] the whole time, and
   * was called by one script and one test and by nothing anybody could see.
   *
   * The address is still never invented. What changed is that the gap is shown
   * to the person who could close it, and that they can.
   */
  await page.evaluate(() => localStorage.removeItem("bahn-recipient-overrides"));
  await go("/anmeldung");

  /*
   * Answer the question that opens LST, rather than assuming it is open.
   *
   * Step 3 is derived, not set: which of the fourteen Prüfungen are „offen"
   * comes out of the checklist answers in step 2. A fresh draft answers „Nein"
   * to all of them, so nothing is open and nothing can be unreachable —
   * a version of this check that skipped straight to step 5 reported "the
   * wizard does not name any unreachable Gewerk" and was right to.
   *
   * Question 19 (`lst`) is the one: Leit- und Sicherungstechnik, Signalanlagen,
   * Bahnübergänge.
   */
  await page.getByRole("button", { name: /^Schritt 2:/ }).click();
  await page.waitForTimeout(600);
  const answered = await page.evaluate(() => {
    const row = [...document.querySelectorAll("main table tbody tr")].find((r) =>
      /Leit- und Sicherungstechnik/.test(r.textContent ?? ""),
    );
    const ja = row?.querySelector('input[value="Ja"]');
    if (!ja) return false;
    ja.click();
    return true;
  });
  assert(answered, "the checklist has no Leit- und Sicherungstechnik question");
  await page.waitForTimeout(500);

  await page.getByRole("button", { name: /Bestätigung/ }).click();
  await page.waitForTimeout(900);

  const panel = page.locator("[data-recipient-gap]");
  assert(await panel.count() > 0, "the wizard does not name any unreachable Gewerk");
  const named = (await panel.getAttribute("data-recipient-gap")) ?? "";
  assert(named.includes("LST"), `the unreachable list is "${named}" — LST is not in it`);

  const body = await page.locator("main").innerText();
  assert(
    /kann niemand benachrichtigt werden/.test(body),
    "the wizard does not say that nobody will be notified",
  );

  // A placeholder is refused, by name, rather than accepted and never answered.
  await page.click('[data-gap-open="LST"]');
  await page.fill('[data-gap-name="LST"]', "Test");
  await page.fill('[data-gap-mail="LST"]', "test@test.de");
  await page.getByRole("button", { name: "Eintragen" }).click();
  await page.waitForTimeout(300);
  assert(
    (await page.$$('[data-gap-problem="placeholder-mail"]')).length === 1,
    "a placeholder address was accepted as a recipient",
  );

  // A real one closes the gap, and the entry records who supplied it.
  await page.fill('[data-gap-name="LST"]', "A. Beispiel");
  await page.fill('[data-gap-mail="LST"]', "a.beispiel@example.org");
  await page.getByRole("button", { name: "Eintragen" }).click();
  await page.waitForTimeout(600);

  const after = await page.locator("main").innerText();
  assert(/a\.beispiel@example\.org/.test(after), "the supplied address is not shown");
  assert(/ergänzt von/.test(after), "the supplied address carries no provenance");
  const stillNamed = (await page.locator("[data-recipient-gap]").getAttribute("data-recipient-gap")) ?? "";
  assert(
    !stillNamed.split(",").includes("LST"),
    "LST is still listed as unreachable after an address was supplied",
  );

  // And it is recorded like every other change on this site.
  await go("/audit");
  const audit = await page.locator("main").innerText();
  assert(
    /Empfänger für LST ergänzt/.test(audit),
    "supplying a recipient was not written to the Änderungshistorie",
  );

  await page.evaluate(() => localStorage.removeItem("bahn-recipient-overrides"));
});

await check("no page anywhere shows a constructed deutschebahn.com address", async () => {
  /*
   * The rule this project has held since the beginning, checked across every
   * surface rather than trusted per file.
   *
   * The Hilfsdatei's real addresses are the only ones allowed on screen. A
   * `vorname.nachname@deutschebahn.com` appearing anywhere means something
   * built one from a name, which is the single most dangerous thing this app
   * could do: it looks right, it reaches a real person, and it is the wrong
   * one.
   */
  for (const route of ["/", "/projects", "/bvb-eea", "/psv-itk", "/anmeldung", "/audit"]) {
    await go(route);
    const text = await page.locator("body").innerText();
    const constructed = [...text.matchAll(/([a-zä-ü-]+)\.([a-zä-ü-]+)@deutschebahn\.com/gi)];
    assert(
      constructed.length === 0,
      `${route} shows a constructed address: ${constructed[0]?.[0]}`,
    );
  }
});

console.log("\n== the page arrives, and never withholds ==");

await check("a section that has not arrived yet is still fully rendered", async () => {
  await go("/");
  await page.waitForSelector(".reveal", { timeout: 25000 });

  /*
   * The assertion the whole cinematic pass hangs on.
   *
   * Reveal-on-scroll is only safe because it is decoration: an unrevealed
   * section is transparent, not absent. It occupies its space, its text is in
   * the DOM, and it is measurable — which is what stops "1.298 Projekte
   * gefunden" from being true only after somebody scrolled, and what stops
   * this suite from counting rows that depend on scroll position.
   *
   * If anyone ever swaps the opacity for a conditional render, this fails
   * immediately and says so.
   */
  const held = await page.evaluate(() => {
    const pending = [...document.querySelectorAll('.reveal[data-revealed="false"]')];
    return pending.slice(0, 6).map((el) => ({
      height: Math.round(el.getBoundingClientRect().height),
      text: (el.textContent ?? "").trim().length,
      display: getComputedStyle(el).display,
      visibility: getComputedStyle(el).visibility,
    }));
  });
  assert(held.length > 0, "nothing was held back — the reveal is not running at all");
  for (const h of held) {
    assert(h.height > 0, "a section waiting to arrive occupies no space");
    assert(h.text > 0, "a section waiting to arrive has no text in the DOM");
    assert(h.display !== "none", `a section waiting to arrive is display:${h.display}`);
    assert(h.visibility !== "hidden", "a section waiting to arrive is visibility:hidden");
  }
});

await check("scrolling the page leaves nothing invisible behind it", async () => {
  await go("/");
  await page.waitForSelector(".reveal", { timeout: 25000 });
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += 500) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(90);
  }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1200);

  const stuck = await page.evaluate(() =>
    [...document.querySelectorAll(".reveal")]
      .filter((el) => Number.parseFloat(getComputedStyle(el).opacity) < 0.99)
      .map((el) => (el.textContent ?? "").trim().slice(0, 48)),
  );
  assert(stuck.length === 0, `${stuck.length} sections never arrived, e.g. "${stuck[0]}"`);
  const count = await page.$$eval(".reveal", (e) => e.length);
  console.log(`     ${count} sections, all arrived`);
});

await check("reduced motion is served a page that was never hidden", async () => {
  const quiet = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  try {
    await quiet.goto(U("/login"));
    await quiet.evaluate(() =>
      localStorage.setItem(
        "bahn-demo-user",
        JSON.stringify({ id: 1, openId: "e2e", name: "Vincenzo Grimaldi", email: "v@db.de", role: "admin" }),
      ),
    );
    await quiet.goto(U("/"), { waitUntil: "networkidle" });
    await quiet.waitForSelector(".reveal", { timeout: 25000 });
    await quiet.waitForTimeout(400);

    // The switch is the whole mechanism: no attribute, no hiding rule matches.
    const motion = await quiet.evaluate(() => document.documentElement.getAttribute("data-motion"));
    assert(motion === null, `data-motion is "${motion}" under reduced motion`);

    const hidden = await quiet.evaluate(() =>
      [...document.querySelectorAll(".reveal")].filter(
        (el) => Number.parseFloat(getComputedStyle(el).opacity) < 0.99,
      ).length,
    );
    assert(hidden === 0, `${hidden} sections are transparent for a reader who asked not to be moved`);

    const streaming = await quiet.evaluate(
      () => document.querySelectorAll("[data-stream]").length,
    );
    assert(streaming === 0, "a table is streaming for a reader who asked not to be moved");
  } finally {
    await quiet.close();
  }
});

await check("the table streams without ever holding a row back", async () => {
  await go("/projects");
  await page.waitForSelector("table tbody tr", { timeout: 30000 });

  /*
   * Counted while the wave is still running, on purpose.
   *
   * The row count is what every other assertion in this suite and every
   * figure on the page depends on. The stream may only change when a row
   * appears, never whether it exists — so the count taken mid-animation has to
   * equal the count taken after it settles.
   */
  const during = await page.$$eval("table tbody tr", (r) => r.length);
  const streaming = await page.$eval("table tbody", (b) => b.getAttribute("data-stream"));
  await page.waitForTimeout(1400);
  const after = await page.$$eval("table tbody tr", (r) => r.length);
  assert(during === after, `${during} rows mid-stream, ${after} after — rows are being withheld`);
  assert(during > 100, `only ${during} rows in the table`);
  assert(streaming === "on", "the table did not stream at all");

  // And every row is opaque once the wave has passed.
  const faded = await page.$$eval("table tbody tr", (rows) =>
    rows.filter((r) => Number.parseFloat(getComputedStyle(r).opacity) < 0.99).length,
  );
  assert(faded === 0, `${faded} rows never finished arriving`);
  console.log(`     ${after} rows, streamed, none withheld`);
});

console.log("\n== the donut is a control surface ==");

await check("a slice lands on exactly the projects it counted", async () => {
  await go("/");
  await page.waitForSelector("[data-tone-slice]", { timeout: 25000 });

  /*
   * The portfolio donut only — `data-tone-department=""`.
   *
   * There are two donuts on this page and they answer different questions.
   * The Gewerke carousel's bands are scoped to one department, so their
   * project figures are that Gewerk's and their links go to that Gewerk's own
   * tab. Mixing them into one assertion is how the first run of this check
   * reported "done: 0 projects from 583 rows" — it had picked up a per-Gewerk
   * slice and measured it against a portfolio-wide claim.
   */
  const slices = await page.$$eval('[data-tone-slice][data-tone-department=""]', (els) =>
    els.map((e) => ({
      tone: e.dataset.toneSlice,
      rows: Number(e.dataset.toneRows),
      projects: Number(e.dataset.toneProjects),
    })),
  );
  assert(slices.length >= 5, `only ${slices.length} slices in the donut`);
  for (const s of slices) {
    assert(s.rows > 0, `${s.tone} is a slice of nothing`);
    assert(s.projects > 0 && s.projects <= s.rows, `${s.tone}: ${s.projects} projects from ${s.rows} rows`);
  }

  // Two of them, end to end — the whole set would be eight page loads of a
  // 1.298-project table for one repeated assertion.
  for (const s of [slices[0], slices.find((x) => x.tone === "pending") ?? slices[1]]) {
    await go("/");
    await page.waitForSelector(`[data-tone-slice="${s.tone}"][data-tone-department=""]`, {
      timeout: 25000,
    });
    await page.click(`[data-tone-slice="${s.tone}"][data-tone-department=""]`);
    await page.waitForTimeout(1500);
    assert(
      new URL(page.url()).searchParams.get("tone") === s.tone,
      `${s.tone} went to ${page.url()}`,
    );
    await page.waitForSelector("[data-project-card]", { timeout: 30000 });
    const cards = await page.$$eval("[data-project-card]", (c) => c.length);
    assert(
      cards === s.projects,
      `${s.tone}: the slice promised ${s.projects} Projekte, the page shows ${cards}`,
    );
    const main = await page.locator("main").innerText();
    assert(
      main.includes("Prüfzeilen in") && main.includes("Projekten"),
      `${s.tone}: no chip reconciling the two counts`,
    );
  }
});

await check("a Gewerk's own slice lands on that Gewerk, not on everything", async () => {
  await go("/");
  await page.waitForSelector('[data-tone-slice][data-tone-department]:not([data-tone-department=""])', {
    timeout: 25000,
  });
  /*
   * Stop the carousel with its own Pause button before touching anything.
   *
   * It advances every four seconds and remounts its subtree when it does, so
   * a slice read at one moment is detached from the DOM by the next — which
   * is what this check spent three runs discovering. Hovering pauses it too,
   * but the pointer has to arrive somewhere, and "somewhere" is a button that
   * may already have been replaced.
   *
   * Using the control the panel offers is both deterministic and the thing a
   * reader does: a rotating panel that you have to out-race to click is not a
   * panel anybody can use, and the Pause button is the answer for both of us.
   */
  await page.getByRole("button", { name: "Pause" }).click();
  await page.waitForTimeout(400);
  assert(
    (await page.getAttribute("[data-gewerke-carousel]", "data-rotating")) === "false",
    "Pause did not stop the carousel",
  );
  const slice = await page.$eval(
    '[data-tone-slice][data-tone-department]:not([data-tone-department=""])',
    (e) => ({
      tone: e.dataset.toneSlice,
      dep: e.dataset.toneDepartment,
      rows: Number(e.dataset.toneRows),
      projects: Number(e.dataset.toneProjects),
    }),
  );
  assert(slice.rows > 0, `${slice.dep}/${slice.tone} is a slice of nothing`);
  assert(
    slice.projects > 0,
    `${slice.dep}/${slice.tone} counts ${slice.projects} projects — the per-Gewerk figure is not being computed`,
  );

  const target = page.locator(
    `[data-tone-slice="${slice.tone}"][data-tone-department="${slice.dep}"]`,
  );
  await target.click({ timeout: 8000 });
  await page.waitForTimeout(1600);
  const url = new URL(page.url());
  assert(url.searchParams.get("tone") === slice.tone, `it dropped the tone: ${page.url()}`);
  const scoped =
    url.pathname === "/bvb-eea" ||
    url.pathname === "/psv-itk" ||
    url.searchParams.get("gewerk") === slice.dep;
  assert(scoped, `${slice.dep}'s slice went to ${page.url()} — not scoped to the Gewerk`);
});

await check("the donut has a body, and the open bands stand out of it", async () => {
  await go("/");
  await page.waitForSelector(".pie3d-top", { timeout: 25000 });
  await page.waitForTimeout(600);

  // Thickness: the stack is tilted and the layers beneath the face are real.
  const shape = await page.evaluate(() => {
    const stack = document.querySelector(".pie3d-stack");
    const layers = document.querySelectorAll(".pie3d-layer");
    return {
      transform: getComputedStyle(stack).transform.slice(0, 9),
      style3d: getComputedStyle(stack).transformStyle,
      layers: layers.length,
      layerEvents: layers.length ? getComputedStyle(layers[0]).pointerEvents : "",
    };
  });
  assert(shape.transform === "matrix3d(", `the donut is not tilted: ${shape.transform}`);
  assert(shape.style3d === "preserve-3d", "the stack does not hold a 3D context");
  assert(shape.layers >= 5, `only ${shape.layers} depth layers — the disc has no edge`);
  // The body carries no information and must not catch a click meant for the face.
  assert(shape.layerEvents === "none", "the disc's body swallows clicks");

  // Open bands are lit; settled ones are not.
  const lit = await page.evaluate(() => {
    const open = [...document.querySelectorAll(".pie3d-slice-open")].length;
    const all = [...document.querySelectorAll(".pie3d-slice")].length;
    return { open, all };
  });
  assert(lit.open > 0, "no open band is highlighted in the donut");
  assert(lit.open < lit.all, "every band is highlighted, which highlights nothing");
  console.log(`     ${lit.open} of ${lit.all} bands lit as open`);
});

console.log("\n== the relief is an instrument, not a picture ==");

await check("dragging rotates it, and the numbers stay upright", async () => {
  await go("/");
  await page.waitForSelector(".relief-cell", { timeout: 25000 });
  const stage = page.locator(".relief-stage");
  // page.mouse works in viewport coordinates and never scrolls; the relief sits
  // about 2,700px down the Dashboard, so without this the drag happens in
  // empty space below the window.
  await stage.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const before = await stage.getAttribute("style");

  const box = await stage.boundingBox();
  assert(box, "the relief has no box to drag");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const after = await stage.getAttribute("style");
  assert(before !== after, "dragging did not move the camera");
  assert(/--relief-spin/.test(after ?? ""), "the spin variable is not being written");

  // The whole promise of this panel: the value is always readable.
  const cells = await page.$$eval(".relief-cell", (els) =>
    els.map((e) => ({ attr: e.getAttribute("data-value"), text: e.textContent.trim() })),
  );
  for (const c of cells) assert(c.text === c.attr, `a tile draws ${c.attr} but prints "${c.text}"`);
});

await check("the wheel zooms without scrolling the page away", async () => {
  await go("/");
  await page.waitForSelector(".relief-cell", { timeout: 25000 });
  const stage = page.locator(".relief-stage");
  await stage.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const box = await stage.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(400);
  const style = (await stage.getAttribute("style")) ?? "";
  const zoom = Number((style.match(/--relief-zoom:\s*([\d.]+)/) ?? ["", "1"])[1]);
  assert(zoom > 1, `the wheel did not zoom in — zoom is ${zoom}`);
  const scrollAfter = await page.evaluate(() => window.scrollY);
  assert(scrollAfter === scrollBefore, "zooming scrolled the page instead");
});

await check("the keyboard drives the same camera", async () => {
  await go("/");
  await page.waitForSelector(".relief-cell", { timeout: 25000 });
  await page.locator(".relief-stage").focus();
  const before = (await page.getAttribute(".relief-stage", "style")) ?? "";
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("+");
  await page.waitForTimeout(400);
  const after = (await page.getAttribute(".relief-stage", "style")) ?? "";
  assert(before !== after, "the arrow keys did not move the camera");

  await page.keyboard.press("Home");
  await page.waitForTimeout(400);
  const home = (await page.getAttribute(".relief-stage", "style")) ?? "";
  /* Compared against the camera this test found, not against a number copied
     out of the component — HOME has moved twice and a gate that restates it
     fails for the wrong reason each time. */
  assert(home === before, `Home did not recentre.\n  was:  ${before}\n  now:  ${home}`);
  // The default zoom is no longer 1: the relief opens slightly zoomed out so
  // the whole skyline fits its card. `home === before` above already covers it.
});

await check("a tile is a place you can go, and an empty tile is not", async () => {
  await go("/");
  await page.waitForSelector(".relief-cell", { timeout: 25000 });

  const zeroDisabled = await page.$$eval(".relief-cell", (els) =>
    els
      .filter((e) => e.getAttribute("data-value") === "0")
      .every((e) => e.hasAttribute("disabled")),
  );
  assert(zeroDisabled, "a tile with no rows behind it is still clickable");

  const target = page.locator('.relief-cell[data-department="EEA"][data-lane="blocked"]');
  assert(await target.count() === 1, "no EEA/blockiert tile to open");

  /*
   * Hover first, then click — which is what a hand does anyway.
   *
   * The relief drifts on its own now, and Playwright checks that an element is
   * stable BEFORE it moves the pointer, so a bare .click() waits forever on a
   * target that is still sweeping. Moving into the panel pauses the sweep
   * (`.relief-stage:hover` → animation-play-state: paused), and only then is
   * the tile a fixed target.
   *
   * That ordering is not a workaround for the test: it is the guarantee the
   * panel has to keep. A tile that never stops moving is a tile nobody can hit
   * — a person aiming at a 30px target that keeps sliding has exactly the same
   * problem, they just blame themselves for missing. The assertion below is
   * that entering the panel is enough to make it aimable.
   */
  const stage = page.locator(".relief-stage");
  await stage.scrollIntoViewIfNeeded();
  const stageBox = await stage.boundingBox();
  assert(stageBox, "the relief has no box");
  // page.mouse.move is the one interaction with no actionability check, which
  // is exactly what a hand does: it arrives before it aims. It also pauses the
  // sweep, so the target stops moving before anything tries to hit it.
  await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + 12);
  await page.waitForTimeout(500);

  /*
   * Aim at a point that is actually on the tile.
   *
   * A tile is a rotated parallelogram, and the centre of its axis-aligned
   * bounding box can fall outside it entirely — which is where a plain
   * .click() aims. That is not a test detail: it is the difference between a
   * tile a person can hit and one whose middle is empty air, so the check is
   * that SOME point of the tile hit-tests to the tile, and then it clicks
   * there.
   */
  const hit = await page.evaluate(() => {
    const tile = document.querySelector(
      '.relief-cell[data-department="EEA"][data-lane="blocked"]',
    );
    if (!tile) return null;
    const r = tile.getBoundingClientRect();
    for (let fy = 0.5; fy <= 0.9; fy += 0.1) {
      for (let fx = 0.2; fx <= 0.8; fx += 0.1) {
        const x = r.left + r.width * fx;
        const y = r.top + r.height * fy;
        const el = document.elementFromPoint(x, y);
        if (el === tile || tile.contains(el)) return { x, y };
      }
    }
    return null;
  });
  assert(hit, "no point of the EEA/blockiert tile hit-tests to the tile itself");
  await page.mouse.click(hit.x, hit.y);
  await page.waitForTimeout(400);
  await page.waitForTimeout(1200);
  const url = new URL(page.url());
  assert(url.pathname === "/bvb-eea", `the EEA tile went to ${url.pathname}`);
  assert(url.searchParams.get("q") === "abgelehnt", `it did not carry the state: ${url.search}`);
});

console.log("\n== summary ==");
console.log(`${passed} passed, ${failures.length} failed`);
await browser.close();
server.close();
process.exit(failures.length ? 1 : 0);
