#!/usr/bin/env node
/**
 * Architecture/documentation consistency gate. Fails when the repository contradicts itself:
 *  - a generic production-looking build (`build:client`, bare `vite build`) exists or is documented
 *  - the Dockerfile / compose / docs mention a build-arg the Dockerfile does not support
 *  - the demo notice or the browser dataset could end up in the production artifact path
 *  - the ruleset requires a check no CI job produces (or CI has a gate job the ruleset does not require)
 */
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(p, "utf8");
const problems = [];
const bad = (m) => problems.push(m);

const pkg = JSON.parse(read("package.json"));
const scripts = pkg.scripts ?? {};
if (scripts["build:client"]) bad("package.json still defines build:client (ambiguous build)");
for (const k of ["build", "build:production", "build:demo"]) if (!scripts[k]) bad(`package.json lacks ${k}`);
if (scripts.build !== "pnpm build:production") bad("`pnpm build` must be exactly `pnpm build:production`");
if (!/BUILD_TARGET=production/.test(scripts["build:production"] ?? "") || !/VITE_SERVER_MODE=1/.test(scripts["build:production"] ?? "")) bad("build:production must pin BUILD_TARGET=production and VITE_SERVER_MODE=1");
if (!/BUILD_TARGET=demo/.test(scripts["build:demo"] ?? "") || !/VITE_SERVER_MODE=0/.test(scripts["build:demo"] ?? "")) bad("build:demo must pin BUILD_TARGET=demo and VITE_SERVER_MODE=0");
if (!/assert-build-target/.test(scripts["build:production"] ?? "")) bad("build:production must run assert-build-target");

if (!/BUILD_TARGET must be/.test(read("vite.config.ts"))) bad("vite.config.ts must refuse a build without BUILD_TARGET");

const docker = read("Dockerfile");
if (/^\s*ARG\s+VITE_SERVER_MODE/m.test(docker)) bad("Dockerfile must not accept VITE_SERVER_MODE");
if (!/pnpm run build:production/.test(docker)) bad("Dockerfile must build with `pnpm run build:production`");

// nothing may reference removed/forbidden build entry points
const roots = [".github", "deploy", "docs", "scripts", "README.md", "Dockerfile", ".gitlab-ci.yml", "vercel.json", "package.json"];
const forbidden = [/pnpm (run )?build:client/, /build:parallel/, /--build-arg\s+VITE_SERVER_MODE/, /VITE_SERVER_MODE:\s*"1"/];
const self = path.normalize("scripts/check-consistency.mjs");
const walk = (p) => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).flatMap((f) => walk(path.join(p, f))) : [p]);
for (const r of roots) {
  if (!fs.existsSync(r)) continue;
  for (const f of walk(r)) {
    if (path.normalize(f) === self || /node_modules|\.json$/.test(f) && f !== "package.json" && f !== "vercel.json") continue;
    if (!/\.(md|ya?ml|sh|mjs|ts|json)$|Dockerfile$/.test(f)) continue;
    const t = read(f);
    for (const re of forbidden) if (re.test(t)) bad(`${f} references a removed build entry point (${re})`);
  }
}
if (!/"buildCommand":\s*"pnpm build:demo"/.test(read("vercel.json"))) bad("vercel.json must build the DEMO (pnpm build:demo)");

// compose files: server artifact is built from the Dockerfile target, no server-mode arg
for (const f of walk("deploy").filter((x) => /docker-compose\.ya?ml$/.test(x))) if (/VITE_SERVER_MODE/.test(read(f))) bad(`${f} passes VITE_SERVER_MODE`);

// ruleset <-> CI
const ci = read(".github/workflows/ci.yml");
const jobs = new Set([...ci.matchAll(/^ {2}([a-z0-9-]+):\s*$/gm)].map((m) => m[1]));
const ruleset = JSON.parse(read(".github/rulesets/main.json"));
const required = ruleset.rules.find((r) => r.type === "required_status_checks")?.parameters.required_status_checks.map((c) => c.context) ?? [];
for (const c of required) if (!jobs.has(c)) bad(`ruleset requires "${c}" but ci.yml has no such job`);
const MUST = ["lint-typecheck", "test", "build", "e2e", "e2e-server", "container", "migrations-mysql84", "image", "ui-perf"];
for (const c of MUST) if (!required.includes(c)) bad(`ruleset does not require "${c}"`);

if (problems.length) { console.error("consistency: FAIL\n - " + problems.join("\n - ")); process.exit(1); }
console.log(`consistency: ok (${required.length} required checks, all present in ci.yml)`);
