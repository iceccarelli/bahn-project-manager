#!/usr/bin/env node
/**
 * Machine-readable deployment gate. Runs (or verifies evidence for) every check that must pass
 * before the server-mode application may be called deployable, and writes
 * artifacts/deployment-gate.json. Exit 0 ONLY when every check passed — including the two that
 * cannot pass from a development machine:
 *
 *   staging-smoke        needs STAGING_URL (https) + SMOKE_TOKEN of a REAL deployed environment
 *   load-certification   needs artifacts/load-certification.json written by scripts/load/certify.mjs
 *                        from a generator host that is NOT the server host
 *
 * A check is one of: pass | fail | not-run. `not-run` is never a pass.
 *
 *   TEST_DATABASE_URL=mysql://… TEST_REDIS_URL=redis://… node scripts/gate/deploy-gate.mjs [--skip e2e-local,server-mode-browser]
 *
 * "readyToDeploy" is true only if EVERY check passes. Nothing here says "production ready": that is a
 * human decision taken with this report in hand.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";

const skip = new Set((process.argv.includes("--skip") ? process.argv[process.argv.indexOf("--skip") + 1] : "").split(",").filter(Boolean));
const sh = (cmd, env = {}, timeout = 1_800_000) => { const t0 = Date.now(); const r = spawnSync("bash", ["-lc", cmd], { env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 1 << 28, timeout }); return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? ""), ms: Date.now() - t0 }; };
const tests = out => /Tests\s+(?:(\d+) failed \| )?(\d+) passed(?: \| (\d+) skipped)?/.exec(out);
const checks = [];
const add = (id, title, run) => checks.push({ id, title, run });
const commit = sh("git rev-parse HEAD").out.trim();

add("typecheck", "tsc --noEmit", async () => { const r = sh("pnpm check"); return { ok: r.code === 0, evidence: r.code === 0 ? "clean" : r.out.slice(-600), ms: r.ms }; });
add("lint", "biome check (errors fail; warnings are counted)", async () => { const r = sh("pnpm lint"); const w = /Found (\d+) warnings/.exec(r.out)?.[1]; return { ok: r.code === 0, evidence: `exit ${r.code}, ${w ?? "?"} warnings`, ms: r.ms }; });
add("unit", "unit tests (no external services)", async () => { const r = sh("pnpm vitest run", { TEST_DATABASE_URL: "", TEST_REDIS_URL: "" }); const m = tests(r.out); return { ok: r.code === 0, evidence: m ? `${m[2]} passed, ${m[3] ?? 0} skipped (DB/Redis suites skip here)` : r.out.slice(-400), ms: r.ms }; });
add("db-integration", "real-database + real-Redis + realtime integration suites", async () => {
  if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL) return { ok: null, evidence: "TEST_DATABASE_URL / TEST_REDIS_URL not set" };
  const r = sh("pnpm vitest run"); const m = tests(r.out);
  return { ok: r.code === 0 && !!m && Number(m[3] ?? 0) === 0, evidence: m ? `${m[2]} passed, ${m[1] ?? 0} failed, ${m[3] ?? 0} skipped (must be 0 skipped)` : r.out.slice(-400), ms: r.ms };
});
add("mysql-version", "the database under test is the intended production engine (MySQL 8.4, not MariaDB)", async () => {
  if (!process.env.TEST_DATABASE_URL) return { ok: null, evidence: "TEST_DATABASE_URL not set" };
  const r = sh(`node -e 'const m=require("mysql2/promise");(async()=>{const c=await m.createConnection(process.env.TEST_DATABASE_URL);const[[v]]=await c.query("SELECT VERSION() v,@@version_comment c");console.log(JSON.stringify(v));await c.end()})()'`);
  let v; try { v = JSON.parse(r.out.trim().split("\n").pop()); } catch { return { ok: false, evidence: `could not read version: ${r.out.slice(-200)}`, ms: r.ms }; }
  const want = process.env.REQUIRE_MYSQL_PREFIX ?? "8.4.";
  return { ok: v.v.startsWith(want) && !/mariadb/i.test(v.v + v.c), evidence: `${v.v} (${v.c}); required prefix ${want}`, ms: r.ms };
});
add("security", "authorization, recipient-safe events, OIDC validation, CSRF, production guards", async () => {
  if (!process.env.TEST_DATABASE_URL) return { ok: null, evidence: "needs TEST_DATABASE_URL (leak regressions run against the real DB)" };
  const r = sh('pnpm vitest run server/domain/permissions.test.ts server/_core server/domain/notificationPolicy.test.ts server/realtime/presence.test.ts server/realtime/e2e.db.test.ts server/realtime/gateway.test.ts server/routers.db.test.ts'); const m = tests(r.out);
  return { ok: r.code === 0 && !!m && Number(m[3] ?? 0) === 0, evidence: m ? `${m[2]} passed` : r.out.slice(-300), ms: r.ms };
});
add("build-client", "vite build (static SPA)", async () => { const r = sh("pnpm build:client"); return { ok: r.code === 0 && existsSync("dist/public/index.html"), evidence: r.code === 0 ? "dist/public built" : r.out.slice(-400), ms: r.ms }; });
add("build-server-mode", "server bundle + SPA built with VITE_SERVER_MODE=1", async () => { const r = sh("scripts/e2e/build-server-mode.sh"); return { ok: r.code === 0 && existsSync("dist-e2e/index.js") && existsSync("dist-e2e/public/index.html"), evidence: r.code === 0 ? "dist-e2e built" : r.out.slice(-400), ms: r.ms }; });
add("bundle-inspection", "server entry chunk: no demo credentials, no devDependency imports, migrations present", async () => {
  if (!existsSync("dist-e2e/index.js")) return { ok: null, evidence: "no bundle (build-server-mode skipped or failed)" };
  const js = readFileSync("dist-e2e/index.js", "utf8"); const problems = [];
  if (/password:\s*"admin"|admin@bahn\.de/.test(js)) problems.push("demo credentials in entry chunk");
  for (const f of ["data.json", "schedule.json"]) if (existsSync(`dist-e2e/public/${f}`)) problems.push(`${f} is in the PUBLIC directory of the server-mode build (unauthenticated dataset download)`);
  if (/from ["'](vite|@vitejs|vitest|tsx|playwright|esbuild)["']/.test(js)) problems.push("devDependency imported by entry chunk");
  if (!/domain_events/.test(js)) problems.push("event pipeline missing from bundle");
  const mig = ["0004_event_pipeline.sql", "0005_change_feed.sql", "0006_notifications.sql"].filter(f => !existsSync(`drizzle/${f}`));
  if (mig.length) problems.push(`migrations missing: ${mig}`);
  const doc = sh("node scripts/doctor.mjs"); if (doc.code !== 0) problems.push("scripts/doctor.mjs reported errors");
  return { ok: problems.length === 0, evidence: problems.length ? problems.join("; ") : `entry chunk ${(statSync("dist-e2e/index.js").size / 1024).toFixed(0)} kB, clean`, ms: doc.ms };
});
add("container-sim", "production-only dependency install boots the artifact (stand-in for the image; no Docker daemon needed)", async () => {
  if (!process.env.SIM_DATABASE_URL) return { ok: null, evidence: "SIM_DATABASE_URL not set" };
  const r = sh("scripts/gate/container-sim.sh dist-e2e"); return { ok: r.code === 0, evidence: r.out.trim().split("\n").pop(), ms: r.ms };
});
add("e2e-local", "existing Playwright suite (static/local mode) — the product still works", async () => {
  if (skip.has("e2e-local")) return { ok: null, evidence: "skipped by flag" };
  const r = sh("pnpm build:client && pnpm e2e", {}, 3_000_000); const m = /(\d+) passed, (\d+) failed/.exec(r.out);
  return { ok: r.code === 0 && !!m && m[2] === "0", evidence: m ? `${m[1]} passed, ${m[2]} failed` : r.out.slice(-300), ms: r.ms };
});
add("server-mode-browser", "two-browser proof against two instances + Redis + real DB (realtime, conflict, move, recovery, presence, notifications)", async () => {
  if (skip.has("server-mode-browser")) return { ok: null, evidence: "skipped by flag" };
  const r = sh("pnpm exec tsx scripts/e2e/server-mode.e2e.ts", {}, 1_200_000); const m = /(\d+) passed, (\d+) failed/.exec(r.out);
  return { ok: r.code === 0 && !!m && m[2] === "0", evidence: m ? `${m[1]} passed, ${m[2]} failed (artifacts/e2e-server-mode.json)` : r.out.slice(-300), ms: r.ms };
});
add("oidc-browser", "real browser sign-in (code + PKCE), storage audit, logout, token refusal, legacy-snapshot protection — mock authority, NOT Entra", async () => {
  if (skip.has("oidc-browser")) return { ok: null, evidence: "skipped by flag" };
  if (!process.env.E2E_DB_BASE) return { ok: null, evidence: "E2E_DB_BASE not set" };
  const b = sh("OUT=dist-oidc VITE_OIDC_AUTHORITY=http://127.0.0.1:3290/ VITE_OIDC_CLIENT_ID=bahn-spa VITE_OIDC_SCOPE='openid profile' scripts/e2e/build-server-mode.sh");
  if (b.code !== 0) return { ok: false, evidence: b.out.slice(-300), ms: b.ms };
  const r = sh("OUT=dist-oidc pnpm exec tsx scripts/e2e/oidc-browser.e2e.ts", {}, 900_000); const m = /(\d+)\/(\d+) passed/.exec(r.out);
  return { ok: r.code === 0 && !!m && m[1] === m[2], evidence: m ? `${m[1]}/${m[2]} passed (artifacts/e2e-oidc-browser.json)` : r.out.slice(-300), ms: r.ms };
});
add("chaos-local", "fault-injection convergence (instance/Redis/DB faults, reconnect storm) — single host", async () => {
  if (skip.has("chaos-local")) return { ok: null, evidence: "skipped by flag" };
  const r = sh("pnpm exec tsx scripts/load/chaos.ts --clients 300", {}, 1_200_000); return { ok: r.code === 0, evidence: r.out.trim().split("\n").pop(), ms: r.ms };
});
add("staging-smoke", "smoke test of a DEPLOYED https environment", async () => {
  if (!process.env.STAGING_URL || !process.env.SMOKE_TOKEN || !process.env.SMOKE_TOKEN_RESTRICTED || !process.env.SMOKE_TOKEN_NOCLAIM) return { ok: null, evidence: "STAGING_URL / SMOKE_TOKEN / SMOKE_TOKEN_RESTRICTED / SMOKE_TOKEN_NOCLAIM not all set — no staging environment was exercised" };
  if (!process.env.STAGING_URL.startsWith("https://")) return { ok: false, evidence: "staging must be https" };
  const r = sh("node scripts/gate/staging-smoke.mjs"); return { ok: r.code === 0, evidence: `exit ${r.code}`, ms: r.ms };
});
add("load-certification", "staged API + realtime load from a generator host that is not the server host", async () => {
  const f = "artifacts/load-certification.json";
  if (!existsSync(f)) return { ok: null, evidence: "no artifacts/load-certification.json (scripts/load/certify.mjs has not run against a deployed environment)" };
  const j = JSON.parse(readFileSync(f, "utf8"));
  return { ok: j.separateHosts === true && j.verdict === "certified-for-tested-stages", evidence: `verdict=${j.verdict} separateHosts=${j.separateHosts}${j.refused ? ` refused: ${j.refused}` : ""}` };
});

// --only a,b : run just these checks and merge them into the existing report (same commit only), so a
// long gate can be run in pieces. Checks never run stay "not-run": the merged report is still all-or-nothing.
const only = new Set((process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : "").split(",").filter(Boolean));
let prior = [];
if (only.size && existsSync("artifacts/deployment-gate.json")) { try { const old = JSON.parse(readFileSync("artifacts/deployment-gate.json", "utf8")); if (old.commit === commit) prior = old.results; } catch { /* start fresh */ } }
const results = [];
for (const c of checks) {
  if (only.size && !only.has(c.id)) { const p = prior.find(x => x.id === c.id); results.push(p ?? { id: c.id, title: c.title, status: "not-run", evidence: "not selected (--only)", ms: null }); continue; }
  process.stderr.write(`[gate] ${c.id} … `);
  const r = await c.run().catch(e => ({ ok: false, evidence: String(e) }));
  const status = r.ok === true ? "pass" : r.ok === false ? "fail" : "not-run";
  results.push({ id: c.id, title: c.title, status, evidence: r.evidence, ms: r.ms ?? null });
  process.stderr.write(`${status}\n`);
}
const failed = results.filter(r => r.status === "fail").map(r => r.id), notRun = results.filter(r => r.status === "not-run").map(r => r.id);
const report = { gate: "deployment", commit, at: new Date().toISOString(), readyToDeploy: failed.length === 0 && notRun.length === 0, failed, notRun, results };
mkdirSync("artifacts", { recursive: true }); writeFileSync("artifacts/deployment-gate.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ readyToDeploy: report.readyToDeploy, failed, notRun }, null, 1));
process.exit(report.readyToDeploy ? 0 : 1);
