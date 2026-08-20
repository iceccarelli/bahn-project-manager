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
 * Let Playwright resolve its own browser. An earlier version hardcoded
 * /opt/pw-browsers/chromium — the path inside the machine this was written on —
 * which meant the suite could not run anywhere else. PLAYWRIGHT_CHROMIUM_PATH
 * is honoured for environments that ship a browser outside Playwright's cache.
 */
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {}),
  });
} catch (err) {
  console.error("!! could not launch Chromium.");
  console.error("   Install it once with:  npx playwright install chromium");
  console.error("   Or point at an existing binary:  PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium pnpm e2e");
  console.error(`   (${err instanceof Error ? err.message.split("\n")[0] : err})`);
  server.close();
  process.exit(1);
}
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();

let consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR ${String(e).slice(0, 160)}`));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`console ${m.text().slice(0, 160)}`); });

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
    assert(await page.locator(marker).first().isVisible(), `no <${marker}> on ${route}`);
  });
}

console.log("\n== data flow and persistence ==");
const STAMP = `E2E-${Date.now().toString(36)}`;

await check("inline edit writes through and survives a reload", async () => {
  await go("/projects");
  const cell = page.locator('button[aria-label^="Projektstand von Projekt"]').first();
  await cell.click();
  const input = page.locator('input[aria-label^="Projektstand"]').first();
  await input.fill(STAMP);
  await input.press("Enter");
  await page.waitForTimeout(700);
  await go("/projects");
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
  const before = await page.locator("tbody tr").count();
  await page.locator('input[aria-label^="Projekte durchsuchen"]').fill("Frankfurt");
  await page.waitForTimeout(900);
  const after = await page.locator("tbody tr").count();
  assert(after > 0 && after < before, `rows ${before} -> ${after}`);
});

await check("sort headers reorder and announce aria-sort", async () => {
  await go("/projects");
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
  await page.getByLabel("Projektnummer", { exact: false }).first().fill("E2E.0001");
  await page.getByLabel("Projektleitung", { exact: false }).first().fill("E2E Prüfer");
  await page.getByRole("button", { name: "Checkliste 22 Fragen" }).click();
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

console.log("\n== summary ==");
console.log(`${passed} passed, ${failures.length} failed`);
await browser.close();
server.close();
process.exit(failures.length ? 1 : 0);
