#!/usr/bin/env node
/**
 * Load certification driver. Runs the staged suite against a DEPLOYED environment and writes
 * artifacts/load-certification.json — the file scripts/gate/deploy-gate.mjs reads.
 *
 * It REFUSES to run when the generator and the server are the same host (loopback numbers are not
 * certification): the server advertises an opaque per-host id in the `X-Instance` header.
 *
 *   BASE=https://staging.example TOKEN=<oidc access token> node scripts/load/certify.mjs \
 *       [--stages-api 100,500,1000,2500,5000,10000] [--stages-rt 1000,2500,5000,10000] [--seconds 60]
 *
 * API stages use api-bench.mjs (zero think time — a harsher profile than users; the k6 suite adds think
 * time). Realtime stages use realtime-fanout.mjs. Unique-user burst uses unique-users.mjs and needs the
 * ability to mint tokens the server trusts (own IdP), so it is reported "not-run" when unavailable.
 * SLO thresholds are the TARGETS in docs/scaling.md; a stage that misses one FAILS the certification.
 */
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const BASE = (process.env.BASE ?? arg("base", "")).replace(/\/$/, ""), TOKEN = process.env.TOKEN;
if (!BASE) { console.error("BASE required"); process.exit(2); }
const SLO = { readP95: 250, writeP95: 400, errorPct: 0.1, rtP95: 500 };
const me = createHash("sha256").update(hostname()).digest("hex").slice(0, 8);
const head = await fetch(`${BASE}/api/health`).catch(e => { console.error("server unreachable:", e.message); process.exit(2); });
const serverId = head.headers.get("x-instance");
const out = { suite: "load-certification", base: BASE, startedAt: new Date().toISOString(), generator: { instance: me }, server: { instance: serverId },
  separateHosts: !!serverId && serverId !== me, slo: SLO, stages: [], verdict: "not-certified" };
if (!out.separateHosts) {
  out.refused = `generator host id ${me} equals server host id ${serverId ?? "(unknown)"}: loopback / same-host numbers are not certification`;
  mkdirSync("artifacts", { recursive: true }); writeFileSync("artifacts/load-certification.json", JSON.stringify(out, null, 2));
  console.error(out.refused); process.exit(3);
}
const run = (script, args, env = {}) => { const r = spawnSync("node", [script, ...args], { env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 1 << 28 }); return r.stdout + r.stderr; };
const firstJson = t => { const i = t.indexOf("{"); if (i < 0) return null; let d = 0; for (let j = i; j < t.length; j++) { if (t[j] === "{") d++; else if (t[j] === "}" && --d === 0) return JSON.parse(t.slice(i, j + 1)); } return null; };
const cred = TOKEN ? ["--token", TOKEN] : [];
const seconds = arg("seconds", "60");
const ids = arg("ids", "1:1298"), thinkMs = arg("think-ms", "0");
const METRICS_TOKEN = process.env.METRICS_TOKEN;
// Server-side evidence sampled around every stage (needs the metrics token; absent => recorded as unavailable, never guessed).
const scrape = async () => {
  if (!METRICS_TOKEN) return null;
  try {
    const t = await (await fetch(`${BASE}/api/metrics`, { headers: { authorization: `Bearer ${METRICS_TOKEN}` } })).text();
    const g = n => { const m = t.match(new RegExp(`^${n}(?:\\{[^}]*\\})? ([\\d.e+-]+)`, "m")); return m ? Number(m[1]) : null; };
    return { outboxBacklog: g("bahn_outbox_backlog"), deadLetters: g("bahn_outbox_dead_letters_total"), poolInUse: g("bahn_db_pool_connections_in_use"), poolQueued: g("bahn_db_pool_queued_requests"), shed: g("bahn_requests_shed_total"), rtDropped: g("bahn_realtime_events_dropped_total"), unhandled: g("bahn_unhandled_rejections_total") };
  } catch { return null; }
};
const ready = async () => { try { return (await fetch(`${BASE}/api/ready`)).status === 200; } catch { return false; } };

for (const vus of arg("stages-api", "100,500,1000,2500,5000,10000").split(",")) {
  const before = await scrape();
  const t = run("scripts/load/api-bench.mjs", ["--base", BASE, ...cred, "--ids", ids, "--think-ms", thinkMs, "--scenario", "mixed", "--vus", vus, "--seconds", seconds]);
  const after = await scrape();
  const j = firstJson(t); const rows = [...t.matchAll(/│ (list|list\+filter|search|detail|shellSummary|write)\s+│\s+(\d+)\s+│\s+([\d.]+)\s+│\s+([\d.]+)/g)];
  const p95 = name => Number(rows.find(r => r[1] === name)?.[4] ?? NaN);
  const readP95 = Math.max(...["list", "detail", "search"].map(p95).filter(Number.isFinite)), writeP95 = p95("write");
  const errorPct = j ? parseFloat(j.errorRate) : NaN;
  const pass = !!j && readP95 < SLO.readP95 && (Number.isNaN(writeP95) || writeP95 < SLO.writeP95) && errorPct < SLO.errorPct;
  out.stages.push({ kind: "api", scenario: "mixed", thinkMs: Number(thinkMs), ids, vus: Number(vus), readP95, writeP95, errorPct, rps: j?.rps, serverBefore: before, serverAfter: after, readyAfter: await ready(), pass });
}
for (const [name, scen, vus] of [["concurrent-writes", "write-distinct", 200], ["hot-project", "write-same", 200]]) {
  const before = await scrape();
  const t = run("scripts/load/api-bench.mjs", ["--base", BASE, ...cred, "--ids", ids, "--scenario", scen, "--vus", String(vus), "--seconds", seconds]);
  const after = await scrape(); const j = firstJson(t);
  const lost = j?.sameProject?.lostOrDuplicated ?? 0, other = j?.writes?.other ?? j?.sameProject?.other ?? null;
  out.stages.push({ kind: name, vus, lostOrDuplicated: lost, unexpectedErrors: other, serverBefore: before, serverAfter: after, pass: !!j && lost === 0 && (other === 0 || other === null) });
}
for (const n of arg("stages-rt", "1000,2500,5000,10000").split(",")) {
  const t = run("scripts/load/realtime-fanout.mjs", ["--base", BASE, ...cred, "--connections", n, "--project", "5", "--rounds", "3", "--ramp-per-sec", "1000"]);
  const rows = [...t.matchAll(/│ \d+\s+│ (\d+)\s+│ (\d+)\s+│ (\d+)\s+│ (\d+)\s+│ [\d.]+\s+│ ([\d.]+)\s+│ ([\d.]+)/g)];
  const worstP95 = Math.max(...rows.map(r => Number(r[6])));
  const missing = rows.reduce((a, r) => a + Number(r[4]), 0);
  out.stages.push({ kind: "realtime", connections: Number(n), rounds: rows.length, worstP95, missing, pass: rows.length > 0 && missing === 0 && worstP95 < SLO.rtP95 });
}
for (const f of ["reconnect-storm", "redis-restart", "app-instance-restart", "relay-interruption", "db-degradation", "soak"]) {
  out.stages.push({ kind: f, pass: false, status: "not-run", detail: f === "soak" ? "run api stage with --seconds >= 3600" : "fault injection needs orchestrator access to the staging stack (docker compose stop/start) — not reachable from a pure client; see docs/staging.md" });
}
out.stages.push({ kind: "unique-users", pass: false, status: "not-run", detail: "needs an IdP whose tokens the deployment trusts; run scripts/load/unique-users.mjs against staging with --base" });
const required = out.stages.filter(s => s.status !== "not-run");
out.verdict = required.length && required.every(s => s.pass) && !out.stages.some(s => s.status === "not-run") ? "certified-for-tested-stages" : "not-certified";
out.finishedAt = new Date().toISOString();
mkdirSync("artifacts", { recursive: true }); writeFileSync("artifacts/load-certification.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ verdict: out.verdict, stages: out.stages }, null, 1));
process.exit(out.verdict === "certified-for-tested-stages" ? 0 : 1);
