#!/usr/bin/env node
/**
 * Verifies a built client artifact is what it claims to be.
 *   node scripts/assert-build-target.mjs <dir> production|demo
 * production: build-info.json says serverMode=true AND no shipped asset contains the demo notice.
 * demo:       build-info.json says serverMode=false.
 * Exit 1 on any mismatch — CI fails a production build that contains SERVER_MODE=false.
 */
import fs from "node:fs";
import path from "node:path";

const [dir, want] = process.argv.slice(2);
if (!dir || !["production", "demo"].includes(want)) { console.error("usage: assert-build-target.mjs <dir> production|demo"); process.exit(2); }
const fail = (why) => { console.error(`build-target: FAIL (${want}): ${why}`); process.exit(1); };

const infoPath = path.join(dir, "build-info.json");
if (!fs.existsSync(infoPath)) fail(`${infoPath} missing — artifact was not built by build:${want}`);
const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
if (info.target !== want) fail(`build-info target is "${info.target}"`);
if (want === "production" && info.serverMode !== true) fail("SERVER_MODE=false in a production build");
if (want === "demo" && info.serverMode !== false) fail("demo build has the server data plane enabled");

if (want === "production") {
  for (const f of ["data.json", "schedule.json"]) if (fs.existsSync(path.join(dir, f))) fail(`${f} (browser-local dataset) is shipped in the production artifact`);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(dir).filter(f => /\.(js|html)$/.test(f))) {
    if (fs.readFileSync(f, "utf8").includes("Daten liegen nur in diesem Browser")) fail(`demo notice shipped in ${path.relative(dir, f)}`);
  }
}
console.log(`build-target: ok (${want}, serverMode=${info.serverMode}, v${info.version})`);
