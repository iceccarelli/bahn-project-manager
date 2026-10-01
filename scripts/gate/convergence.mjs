#!/usr/bin/env node
/**
 * Final integrated convergence gate: ONE command that runs every locally provable layer in order and prints a ledger.
 * It fails on the first red layer's exit code at the end (all layers still run, so the report is complete).
 * It never fabricates: a layer that needs infrastructure this host lacks is reported SKIPPED with the reason, not passed.
 *
 *   build · data · auth+mutations (unit/DB) · realtime+UI (server-mode browser e2e) · performance thresholds · operations · deployment
 *
 * Needs MySQL 8.4 + Redis 7 for the DB/e2e layers: TEST_DATABASE_URL, TEST_REDIS_URL, E2E_DB_BASE, E2E_REDIS, E2E_REDIS_CONTAINER.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const env = process.env;
const haveDb = !!(env.TEST_DATABASE_URL && env.TEST_REDIS_URL);
const haveE2e = !!(env.E2E_DB_BASE && env.E2E_REDIS && env.E2E_REDIS_CONTAINER);
const layers = [
  { layer: "build", name: "typecheck", cmd: "pnpm check" },
  { layer: "build", name: "lint", cmd: "pnpm lint" },
  { layer: "build", name: "contradictions (build/CI/ruleset/alerts/docs)", cmd: "pnpm check:consistency" },
  { layer: "build", name: "production artifact is production", cmd: "pnpm build:production"  /* asserts its own target (scripts/assert-build-target.mjs) */ },
  { layer: "data", name: "public data verified", cmd: "pnpm verify:data" },
  { layer: "auth+mutations", name: "unit + real MySQL/Redis suites (one mutation plane, grants, audit, outbox)", cmd: "pnpm test", needs: haveDb, why: "TEST_DATABASE_URL / TEST_REDIS_URL not set" },
  { layer: "realtime+UI", name: "server-mode browser e2e (2 instances, drawer, drill-down, chaos)", cmd: "bash scripts/e2e/build-server-mode.sh && pnpm exec tsx scripts/e2e/server-mode.e2e.ts", needs: haveE2e, why: "E2E_DB_BASE / E2E_REDIS / E2E_REDIS_CONTAINER not set" },
  { layer: "performance", name: "UI performance thresholds", cmd: "scripts/e2e/build-server-mode.sh && DATABASE_URL=$E2E_DB_BASE/bahn_perf node dist-e2e/migrate.js && pnpm exec tsx scripts/e2e/seed-real.ts $E2E_DB_BASE/bahn_perf && PERF_DATABASE_URL=$E2E_DB_BASE/bahn_perf pnpm exec tsx scripts/perf/browser-perf.ts --label gate && node scripts/perf/check-thresholds.mjs artifacts/browser-perf-gate.json", needs: haveE2e, why: "needs the same MySQL/Redis as the e2e" },
  { layer: "deployment", name: "deployment gate (machine-readable)", cmd: "pnpm gate" },
];

const rows = [];
for (const l of layers) {
  if (l.needs === false) { rows.push({ ...l, result: "SKIPPED", detail: l.why }); console.log(`SKIP ${l.layer}: ${l.name} (${l.why})`); continue; }
  const t0 = Date.now();
  console.log(`\n>>> ${l.layer}: ${l.name}\n    ${l.cmd}`);
  const r = spawnSync("bash", ["-c", l.cmd], { stdio: "inherit", env });
  rows.push({ ...l, result: r.status === 0 ? "PASS" : "FAIL", seconds: Math.round((Date.now() - t0) / 1000) });
}
console.log("\n== convergence ledger ==");
for (const r of rows) console.log(`${r.result.padEnd(7)} ${r.layer.padEnd(16)} ${r.name}${r.detail ? `  [${r.detail}]` : ""}${r.seconds != null ? `  (${r.seconds}s)` : ""}`);
console.log("\nNOT COVERED HERE (infrastructure-dependent): real Entra tenant, public HTTPS staging with 2 instances, separate-host load 100…10,000, history rewrite, GitHub ruleset import.");
mkdirSync("docs/measurements", { recursive: true });
writeFileSync("docs/measurements/convergence-last-run.json", JSON.stringify({ at: new Date().toISOString(), rows: rows.map(({ cmd, needs, why, ...r }) => r) }, null, 2));
process.exit(rows.some(r => r.result === "FAIL") ? 1 : 0);
