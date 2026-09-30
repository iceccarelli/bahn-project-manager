#!/usr/bin/env node
/**
 * Realtime capacity probe: open N SSE connections, trigger ONE mutation, and
 * measure how long each connection takes to receive it.
 *
 *   node scripts/load/realtime-fanout.mjs --base http://127.0.0.1:3100 --cookie <session> \
 *        --connections 10000 --project 1 [--rounds 3] [--ramp-per-sec 1000]
 *
 * Latency = time from just before the mutation request is sent until the event
 * frame is fully read by the client. Includes the HTTP write, the DB commit, the
 * outbox relay, the bus and the socket write. Run the generator on a different
 * host than the server for a real number: on one machine they share CPU.
 */
import http from "node:http";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
// --base may list several instances (comma separated): connections are spread
// round-robin across them, the mutation goes to the FIRST — so delivery to the
// others proves the cross-instance bus (Redis) works.
const BASES = arg("base", "http://127.0.0.1:3000").split(",").map(u => new URL(u)), BASE = BASES[0], COOKIE = arg("cookie", process.env.COOKIE);
const N = Number(arg("connections", 1000)), PROJECT = Number(arg("project", 1)), ROUNDS = Number(arg("rounds", 3));
const RAMP = Number(arg("ramp-per-sec", 2000)), SCOPE = arg("scope", `project:${PROJECT}`);
if (!COOKIE) { console.error("--cookie required"); process.exit(2); }

const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity });
let connected = 0, failed = 0, closed = 0, sentAt = 0;
let hits = new Map(); // conn idx -> receive time for current round
const sockets = [];
const failures = new Map();

function open(i) {
  return new Promise(resolve => {
    const req = http.request({ host: BASES[i % BASES.length].hostname, port: BASES[i % BASES.length].port, path: `/api/realtime/stream?scopes=${encodeURIComponent(SCOPE)}`, agent, headers: { cookie: `app_session_id=${COOKIE}`, accept: "text/event-stream" } }, res => {
      if (res.statusCode !== 200) { failed++; failures.set(res.statusCode, (failures.get(res.statusCode) ?? 0) + 1); res.resume(); return resolve(false); }
      res.setEncoding("utf8");
      let buf = "", ready = false;
      res.on("data", chunk => {
        buf += chunk;
        if (!ready && buf.includes("event: hello")) { ready = true; connected++; resolve(true); }
        if (sentAt && buf.includes("event: domain")) { if (!hits.has(i)) hits.set(i, performance.now()); }
        if (buf.length > 4096) buf = buf.slice(-1024);
      });
      res.on("close", () => { closed++; });
    });
    req.on("error", e => { failed++; failures.set(e.code ?? e.message, (failures.get(e.code ?? e.message) ?? 0) + 1); resolve(false); });
    req.end();
    sockets.push(req);
  });
}

async function mutate(version, tag) {
  const r = await fetch(new URL("/api/trpc/projects.update", BASE), {
    method: "POST", headers: { cookie: `app_session_id=${COOKIE}`, "content-type": "application/json" },
    body: JSON.stringify({ json: { id: PROJECT, expectedVersion: version, changes: { kommentar: `fanout-${tag}` }, idempotencyKey: `fanout-${Date.now()}-${tag}-${Math.random().toString(36).slice(2)}` } }),
  });
  const j = await r.json();
  if (r.status !== 200) throw new Error(`mutation failed ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j.result.data.json.project.version;
}
const current = async () => (await (await fetch(new URL(`/api/trpc/projects.get?input=${encodeURIComponent(JSON.stringify({ json: { id: PROJECT } }))}`, BASE), { headers: { cookie: `app_session_id=${COOKIE}` } })).json()).result.data.json.version;

const t0 = performance.now();
for (let i = 0; i < N; i += RAMP) {
  await Promise.all(Array.from({ length: Math.min(RAMP, N - i) }, (_, k) => open(i + k)));
  if (i + RAMP < N) await new Promise(r => setTimeout(r, 1000));
}
const connectSecs = (performance.now() - t0) / 1000;
console.log(JSON.stringify({ phase: "connected", requested: N, connected, failed, failures: Object.fromEntries(failures), connectSeconds: +connectSecs.toFixed(1), clientRssMB: Math.round(process.memoryUsage().rss / 1048576) }));

const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
const results = [];
let version = await current();
for (let round = 1; round <= ROUNDS; round++) {
  hits = new Map(); sentAt = 0;
  await new Promise(r => setTimeout(r, 500));
  sentAt = performance.now();
  const t = sentAt;
  version = await mutate(version, round);
  const ackMs = performance.now() - t;
  const deadline = performance.now() + 15_000;
  while (hits.size < connected && performance.now() < deadline) await new Promise(r => setTimeout(r, 20));
  const lat = [...hits.values()].map(x => x - t).sort((a, b) => a - b);
  results.push({ round, delivered: hits.size, expected: connected, missing: connected - hits.size, mutationAckMs: +ackMs.toFixed(1), "p50 ms": +pct(lat, .5).toFixed(1), "p95 ms": +pct(lat, .95).toFixed(1), "p99 ms": +pct(lat, .99).toFixed(1), "max ms": +(lat.at(-1) ?? NaN).toFixed(1) });
  sentAt = 0;
}
console.table(results);
console.log(JSON.stringify({ phase: "done", stillOpen: connected - closed, closedByServer: closed }));
for (const r of sockets) r.destroy();
process.exit(0);
