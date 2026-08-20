/**
 * Diagnose why Chromium will not start here.
 *
 *   pnpm e2e:doctor
 *
 * Exists because "Target page, context or browser has been closed" is the same
 * message for half a dozen different causes, and guessing across a round trip
 * is slower than measuring once.
 */
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

const line = (k, v) => console.log(`  ${String(k).padEnd(26)} ${v}`);
const tryExec = (cmd) => {
  try { return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return "(unavailable)"; }
};

console.log("\n== environment ==");
line("node", process.version);
line("platform", `${os.platform()} ${os.release()}`);
line("user", `uid=${typeof process.getuid === "function" ? process.getuid() : "?"}${
  typeof process.getuid === "function" && process.getuid() === 0 ? "  (root — Chrome's setuid sandbox cannot initialise)" : ""}`);
line("/dev/shm", tryExec("df -h /dev/shm | tail -1 | awk '{print $2\" total, \"$4\" free\"}'"));
line("PLAYWRIGHT_BROWSERS_PATH", process.env.PLAYWRIGHT_BROWSERS_PATH || "(unset — using the default cache)");
line("PLAYWRIGHT_CHROMIUM_PATH", process.env.PLAYWRIGHT_CHROMIUM_PATH || "(unset)");

console.log("\n== browser Playwright resolves ==");
let exe = "(could not resolve)";
try { exe = chromium.executablePath(); } catch (e) { exe = `(${e.message.split("\n")[0]})`; }
line("executablePath", exe);
line("exists", fs.existsSync(exe) ? "yes" : "NO");
if (fs.existsSync(exe)) {
  line("missing shared libs", tryExec(`ldd ${exe} 2>/dev/null | grep 'not found' | awk '{print $1}' | sort -u | tr '\\n' ' '`) || "none");
}

console.log("\n== launch attempts ==");
const attempts = [
  ["default (no args)", {}],
  ["with --no-sandbox", { args: ["--no-sandbox", "--disable-setuid-sandbox"] }],
  ["with --no-sandbox --disable-dev-shm-usage",
    { args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] }],
  ["channel: chromium + flags",
    { channel: "chromium", args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] }],
];
let worked = null;
for (const [label, opts] of attempts) {
  try {
    const b = await chromium.launch({ headless: true, ...opts });
    const p = await b.newPage();
    await p.setContent("<h1>ok</h1>");
    const text = await p.locator("h1").innerText();
    await b.close();
    console.log(`  PASS  ${label}  (rendered "${text}")`);
    if (!worked) worked = label;
  } catch (e) {
    console.log(`  FAIL  ${label}`);
    console.log(`        ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  }
}

console.log("\n== verdict ==");
if (worked) {
  console.log(`  Chromium runs here with: ${worked}`);
  console.log("  scripts/e2e-smoke.mjs already passes those flags, so `pnpm e2e` should work.");
} else {
  console.log("  No configuration launched a browser. The usual cause is missing");
  console.log("  system libraries — a plain `playwright install` downloads the binary");
  console.log("  but not its dependencies. Run:");
  console.log("    pnpm exec playwright install --with-deps chromium");
  console.log("  If that needs sudo and you do not have it, `sudo apt-get install -y \\");
  console.log("    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \\");
  console.log("    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \\");
  console.log("    libgbm1 libpango-1.0-0 libcairo2 libasound2` covers it.");
  console.log("  For the raw browser stderr:  DEBUG=pw:browser pnpm e2e");
}
console.log("");
