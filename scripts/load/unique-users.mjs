#!/usr/bin/env node
/**
 * Unique-identity connection burst. Every connection authenticates with its OWN
 * OIDC access token (distinct subject, RS256), so nothing is served from the
 * identity cache: each connection costs a real signature verification and a
 * real first-sighting provisioning. Measures the burst end to end.
 *
 *   node scripts/load/unique-users.mjs --users 10000 --burst-seconds 30 \
 *        [--base http://127.0.0.1:3100 --spawn] [--db mysql://…/bahn_load]
 *
 * With --spawn it starts dist/index.js itself (OIDC pointed at the JWKS this
 * script serves) so CPU/RSS can be sampled from /proc. Without it, pass --pid.
 * Reports: connect latency p50/p95/p99 (request → `hello` frame), failures by
 * status, server CPU/RSS over time, DB threads/queries/users written, pool
 * gauges, auth-verify and identity histograms, and fan-out of one event.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import http from "node:http";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import mysql from "mysql2/promise";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const flag = k => process.argv.includes(`--${k}`);
const USERS = Number(arg("users", 1000)), BURST = Number(arg("burst-seconds", 30));
const DB = arg("db", "mysql://bahn:bahn@127.0.0.1:3306/bahn_load");
const PORT = Number(arg("port", 3100));
let BASE = arg("base", `http://127.0.0.1:${PORT}`);
const SCOPE = "workspace:frankfurt";

const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "uu", alg: "RS256", use: "sig" };
const idp = createServer((_q, r) => { r.setHeader("content-type", "application/json"); r.end(JSON.stringify({ keys: [jwk] })); });
await new Promise(r => idp.listen(0, "127.0.0.1", r));
const ISS = `http://127.0.0.1:${idp.address().port}/`, AUD = "bahn-uu";

const t0 = performance.now();
const tokens = [];
for (let i = 0; i < USERS; i++) {
  tokens.push(await new SignJWT({ tid: "tenant-uu", oid: `user-${i}-${Math.random().toString(36).slice(2, 10)}`, name: `Load User ${i}`, roles: ["editor"], workspaces: [i % 2 === 0 ? "ALL" : "Frankfurt"] })
    .setProtectedHeader({ alg: "RS256", kid: "uu" }).setIssuer(ISS).setAudience(AUD).setIssuedAt().setExpirationTime("2h").sign(privateKey));
}
const adminToken = await new SignJWT({ tid: "tenant-uu", oid: "writer", name: "Writer", roles: ["admin"] }).setProtectedHeader({ alg: "RS256", kid: "uu" }).setIssuer(ISS).setAudience(AUD).setExpirationTime("2h").sign(privateKey);
console.log(JSON.stringify({ phase: "minted", users: USERS, seconds: +((performance.now() - t0) / 1000).toFixed(1) }));

let srv = null, pid = Number(arg("pid", 0));
if (flag("spawn")) {
  srv = spawn("node", ["--max-old-space-size=4096", "dist/index.js"], {
    env: { ...process.env, NODE_ENV: "production", PORT: String(PORT), DATABASE_URL: DB, JWT_SECRET: "u".repeat(48), OIDC_ISSUER: ISS, OIDC_AUDIENCE: AUD,
      OIDC_JWKS_URI: `${ISS}jwks`, DB_POOL_SIZE: arg("pool", "10"), RT_MAX_CONNECTIONS: "200000", RT_MAX_PER_PRINCIPAL: "5", METRICS_TOKEN: "uu", ...(arg("redis") ? { REDIS_URL: arg("redis") } : {}) },
    stdio: ["ignore", "ignore", "inherit"],
  });
  pid = srv.pid; BASE = `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 80; i++) { if ((await fetch(`${BASE}/api/ready`).catch(() => null))?.ok) break; await new Promise(r => setTimeout(r, 250)); }
}

const db = await mysql.createPool({ uri: DB, connectionLimit: 2 });
const dbStat = async () => {
  const [rows] = await db.query("SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Questions','Com_insert','Max_used_connections')");
  const o = Object.fromEntries(rows.map(r => [r.Variable_name, Number(r.Value)]));
  const [[u]] = await db.query("SELECT COUNT(*) n FROM users WHERE loginMethod='oidc'");
  return { ...o, oidcUsers: Number(u.n) };
};
const metrics = async () => Object.fromEntries((await (await fetch(`${BASE}/api/metrics`, { headers: { authorization: "Bearer uu" } })).text()).split("\n").filter(l => l && !l.startsWith("#")).map(l => { const i = l.lastIndexOf(" "); return [l.slice(0, i), Number(l.slice(i + 1))]; }));
const hist = (m, name) => { const c = m[`${name}_count`] ?? 0, s = m[`${name}_sum`] ?? 0; const b = Object.entries(m).filter(([k]) => k.startsWith(`${name}_bucket{le=`)).map(([k, v]) => [Number(k.match(/le="([^"]+)"/)[1]), v]).filter(([le]) => Number.isFinite(le)).sort((a, b) => a[0] - b[0]);
  const q = p => (b.find(([, v]) => v >= p * c) ?? [Infinity])[0]; return { count: c, meanMs: c ? +(s / c).toFixed(2) : null, p50: q(.5), p95: q(.95), p99: q(.99) }; };

// CPU / RSS sampler (Linux /proc)
const clk = 100, samples = [];
let lastCpu = null;
const cpuOf = p => { try { const f = readFileSync(`/proc/${p}/stat`, "utf8").split(") ")[1].split(" "); return (Number(f[11]) + Number(f[12])) / clk; } catch { return null; } };
const rssOf = p => { try { return Number(readFileSync(`/proc/${p}/status`, "utf8").match(/VmRSS:\s+(\d+)/)[1]) / 1024; } catch { return null; } };
const sampler = pid ? setInterval(() => { const c = cpuOf(pid); if (c === null) return; if (lastCpu !== null) samples.push({ t: Date.now(), cpuPct: (c - lastCpu) * 100, rssMB: rssOf(pid) }); lastCpu = c; }, 1000) : null;

const before = { db: await dbStat(), m: await metrics().catch(() => ({})) };
console.log(JSON.stringify({ phase: "before", ...before.db }));

// ---- the burst ----------------------------------------------------------------------------
const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity });
const lat = [], fails = new Map(), sockets = [];
let helloed = 0, gotEvent = 0, sentAt = 0; const evLat = [];
const open = (i, token) => new Promise(resolve => {
  const start = performance.now();
  const req = http.request({ host: new URL(BASE).hostname, port: new URL(BASE).port, path: `/api/realtime/stream?scopes=${encodeURIComponent(SCOPE)}`, agent, headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" } }, res => {
    if (res.statusCode !== 200) { fails.set(res.statusCode, (fails.get(res.statusCode) ?? 0) + 1); res.resume(); return resolve(false); }
    res.setEncoding("utf8"); let buf = "", ready = false, ev = false;
    res.on("data", c => {
      buf += c;
      if (!ready && buf.includes("event: hello")) { ready = true; helloed++; lat.push(performance.now() - start); resolve(true); }
      if (sentAt && !ev && buf.includes("event: domain")) { ev = true; gotEvent++; evLat.push(performance.now() - sentAt); }
      if (buf.length > 2048) buf = buf.slice(-512);
    });
  });
  req.on("error", e => { const k = e.code ?? e.message; fails.set(k, (fails.get(k) ?? 0) + 1); resolve(false); });
  req.end(); sockets.push(req);
});
const tStart = performance.now();
const perTick = Math.max(1, Math.ceil(USERS / (BURST * 10)));           // 10 ticks per second, uniformly spread
const pending = [];
for (let i = 0; i < USERS; i += perTick) {
  for (let k = i; k < Math.min(USERS, i + perTick); k++) pending.push(open(k, tokens[k]));
  await new Promise(r => setTimeout(r, 100));
}
await Promise.all(pending);
const burstSecs = (performance.now() - tStart) / 1000;
await new Promise(r => setTimeout(r, 2500));                              // let write-behind flush

const mid = { db: await dbStat(), m: await metrics() };
const lp = p => { const a = [...lat].sort((x, y) => x - y); return +(a[Math.min(a.length - 1, Math.floor(a.length * p))] ?? NaN).toFixed(1); };
console.log(JSON.stringify({ phase: "burst-done", requested: USERS, connected: helloed, failed: USERS - helloed, failures: Object.fromEntries(fails), burstSeconds: +burstSecs.toFixed(1),
  connect_ms: { p50: lp(.5), p95: lp(.95), p99: lp(.99), max: lp(1) } }));

// ---- one event to everyone ------------------------------------------------------------------
const tokenFor = t => ({ authorization: `Bearer ${t}`, "content-type": "application/json" });
const [{ id: pid1 }] = (await db.query("SELECT id FROM projects WHERE bahnhofsmanagement='Frankfurt' ORDER BY id LIMIT 1"))[0];
const cur = (await (await fetch(`${BASE}/api/trpc/projects.get?input=${encodeURIComponent(JSON.stringify({ json: { id: pid1 } }))}`, { headers: tokenFor(adminToken) })).json()).result.data.json.version;
sentAt = performance.now();
const w = await fetch(`${BASE}/api/trpc/projects.update`, { method: "POST", headers: tokenFor(adminToken), body: JSON.stringify({ json: { id: pid1, expectedVersion: cur, changes: { kommentar: `unique-users ${Date.now()}` }, idempotencyKey: `uu-${Date.now()}-${Math.random().toString(36).slice(2)}` } }) });
const deadline = performance.now() + 15000;
while (gotEvent < helloed && performance.now() < deadline) await new Promise(r => setTimeout(r, 25));
const ea = evLat.sort((a, b) => a - b), ep = p => +(ea[Math.min(ea.length - 1, Math.floor(ea.length * p))] ?? NaN).toFixed(1);
console.log(JSON.stringify({ phase: "fanout", writeStatus: w.status, delivered: gotEvent, expected: helloed, fanout_ms: { p50: ep(.5), p95: ep(.95), p99: ep(.99), max: ep(1) } }));

const end = { db: await dbStat(), m: await metrics() };
if (sampler) clearInterval(sampler);
const burstCpu = samples.filter(s => s.t >= Date.now() - (burstSecs + 60) * 1000);
const dm = (k) => (end.m[k] ?? 0) - (before.m[k] ?? 0);
console.log(JSON.stringify({
  phase: "report",
  serverCpuPct: samples.length ? { avg: +(burstCpu.reduce((a, s) => a + s.cpuPct, 0) / burstCpu.length).toFixed(0), max: +Math.max(...burstCpu.map(s => s.cpuPct)).toFixed(0), note: "100 = one core" } : "n/a (no --spawn/--pid)",
  serverRssMB: samples.length ? { start: +samples[0].rssMB.toFixed(0), max: +Math.max(...samples.map(s => s.rssMB)).toFixed(0) } : "n/a",
  auth_verify: hist(end.m, "bahn_auth_verify_ms"),
  identity_resolve: hist(end.m, "bahn_identity_resolve_ms"),
  db: { threadsConnectedMax: end.db.Max_used_connections, queriesDuringRun: end.db.Questions - before.db.Questions, insertsDuringRun: end.db.Com_insert - before.db.Com_insert,
        oidcUsersProvisionedDuringRun: end.db.oidcUsers - before.db.oidcUsers, provisionFailures: dm("bahn_user_provision_failures_total") },
  pool: { inUse: end.m.bahn_db_pool_connections_in_use, queued: end.m.bahn_db_pool_queued_requests, shed429: end.m.bahn_requests_shed_total ?? 0 },
  realtime: { connections: end.m.bahn_realtime_connections, dropped: end.m.bahn_realtime_events_dropped_total ?? 0, gatewayErrors: end.m.bahn_realtime_gateway_errors_total ?? 0 },
}, null, 1));
for (const s of sockets) s.destroy();
srv?.kill("SIGTERM"); idp.close(); await db.end();
process.exit(0);
