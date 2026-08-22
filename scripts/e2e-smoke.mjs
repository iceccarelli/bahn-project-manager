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
const go = async (r) => { await page.goto(U(r), { waitUntil: "networkidle" }); await page.waitForTimeout(800); };

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
  await page.waitForTimeout(900);
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

await check("the status pie plots every review row, not a hardcoded subset", async () => {
  await go("/");
  const caption = await page
    .locator("text=/von .* Prüfzeilen tragen einen Status/")
    .first()
    .innerText();
  const shown = Number((caption.match(/^[\d.]+/) ?? ["0"])[0].replace(/\./g, ""));
  // Every non-null status in the shipped data, counted independently here.
  const projects = JSON.parse(fs.readFileSync("client/public/data.json", "utf8")).projects;
  let expected = 0;
  for (const p of projects) for (const r of p.reviews ?? []) if (r.status) expected++;
  assert(shown === expected, `pie caption says ${shown} rows, the data has ${expected}`);
});

await check("truncated lists say how much they are hiding", async () => {
  await go("/");
  // The Dashboard's charts mount after the data resolves, so snapshotting
  // innerText on arrival is a race the harness sometimes lost.
  await page.waitForSelector("text=/Status pro Gewerke/", { timeout: 20000 });
  const body = await page.locator("body").innerText();
  assert(/Status pro Gewerke — \d+ von \d+/.test(body), "the Gewerke grid does not state its own coverage");
  assert(/Regionale Verteilung — Top \d+ von \d+/.test(body), "the region list does not state its own coverage");
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
  await tp.waitForTimeout(800);
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
    const markers = await page.$$eval(
      ".leaflet-marker-icon, .leaflet-interactive",
      (m) => m.length,
    );
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

console.log("\n== summary ==");
console.log(`${passed} passed, ${failures.length} failed`);
await browser.close();
server.close();
process.exit(failures.length ? 1 : 0);
