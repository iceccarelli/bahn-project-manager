#!/usr/bin/env node
/**
 * Fanout topology benchmark: how many event deliveries does the SAME write workload cost under each
 * subscription topology, for a population of users who all have the global Projects page open?
 *
 *   before   every client subscribes to all nine workspace channels (every edit of every project reaches everyone)
 *   after    every client subscribes to `collection:all` (membership feed) + `project:<id>` for the rows on its screen
 *
 *   node scripts/load/fanout-topology.mjs --base http://127.0.0.1:3100 --token <oidc access token> \
 *        [--clients 1000] [--events 200] [--visible 40] [--topology before|after|both] [--ids 1:1298]
 *
 * Reports deliveries (frames received across all clients), bytes, deliveries per event, and the ideal
 * ("relevant recipients": clients that actually hold the edited row) so the ratio shows how close the topology is
 * to fanout ≈ relevant recipients. Edits are plain field updates (no membership change).
 */
import http from "node:http";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const BASE = new URL(arg("base", "http://127.0.0.1:3100")), TOKEN = arg("token", process.env.TOKEN);
const CLIENTS = Number(arg("clients", 1000)), EVENTS = Number(arg("events", 200)), VISIBLE = Number(arg("visible", 40));
const TOPOLOGY = arg("topology", "both"), [ID_MIN, ID_MAX] = arg("ids", "1:1298").split(":").map(Number);
if (!TOKEN) { console.error("--token (OIDC bearer access token) required"); process.exit(2); }
const WORKSPACES = ["darmstadt", "frankfurt", "giessen", "kaiserslautern", "kassel", "koblenz", "mainz", "saarbrucken", "ubergreifend"]; // slug form (shared/bahnhofsmanagement.ts) // slug form
const rnd = n => Math.floor(Math.random() * n);
const H = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity });

async function trpc(proc, input, method = "GET") {
  const url = new URL(method === "GET" ? `/api/trpc/${proc}?input=${encodeURIComponent(JSON.stringify({ json: input }))}` : `/api/trpc/${proc}`, BASE);
  const r = await fetch(url, { method, headers: H, ...(method === "POST" ? { body: JSON.stringify({ json: input }) } : {}) });
  const j = await r.json(); if (r.status !== 200) throw new Error(`${proc} ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
  return j.result.data.json;
}
const metric = async name => { const t = await (await fetch(new URL("/api/metrics", BASE), { headers: { authorization: `Bearer ${process.env.METRICS_TOKEN ?? "lt"}` } })).text(); const m = new RegExp(`^${name}(?:\\{[^}]*\\})? ([\\d.e+-]+)`, "m").exec(t); return m ? Number(m[1]) : null; };

async function run(topology) {
  const held = []; // per client: Set of project ids on its "screen"
  const stats = { deliveries: 0, bytes: 0, connected: 0, failed: 0 };
  const reqs = [];
  const open = i => new Promise(resolve => {
    const rows = new Set(); while (rows.size < VISIBLE) rows.add(ID_MIN + rnd(ID_MAX - ID_MIN + 1));
    held[i] = rows;
    const scopes = topology === "before" ? WORKSPACES.map(w => `workspace:${w}`) : ["collection:all", ...[...rows].map(id => `project:${id}`)];
    const req = http.request({ host: BASE.hostname, port: BASE.port, path: `/api/realtime/stream?scopes=${encodeURIComponent(scopes.join(","))}`, agent, headers: { authorization: `Bearer ${TOKEN}`, accept: "text/event-stream" } }, res => {
      if (res.statusCode !== 200) { stats.failed++; res.resume(); return resolve(false); }
      res.setEncoding("utf8"); let ready = false;
      res.on("data", chunk => {
        if (!ready && chunk.includes("event: hello")) { ready = true; stats.connected++; resolve(true); }
        stats.bytes += Buffer.byteLength(chunk);
        let at = 0; for (;;) { const k = chunk.indexOf("event: domain", at); if (k < 0) break; stats.deliveries++; at = k + 13; }
      });
    });
    req.on("error", () => { stats.failed++; resolve(false); });
    req.end(); reqs.push(req);
  });
  for (let i = 0; i < CLIENTS; i += 500) await Promise.all(Array.from({ length: Math.min(500, CLIENTS - i) }, (_, k) => open(i + k)));
  await new Promise(r => setTimeout(r, 500));
  const before = { d: stats.deliveries, b: stats.bytes };
  const m0 = await metric("bahn_realtime_events_delivered_total");
  const cpu0 = process.cpuUsage();
  let relevant = 0;
  for (let e = 0; e < EVENTS; e++) {
    const id = ID_MIN + rnd(ID_MAX - ID_MIN + 1);
    const cur = await trpc("projects.get", { id });
    await trpc("projects.update", { id, expectedVersion: cur.version, changes: { kommentar: `topo-${topology}-${e}` }, idempotencyKey: `topo-${Date.now()}-${e}-${Math.random().toString(36).slice(2)}` }, "POST");
    relevant += held.filter(s => s?.has(id)).length;
  }
  await new Promise(r => setTimeout(r, 2500)); // let the relay publish and the sockets drain
  const m1 = await metric("bahn_realtime_events_delivered_total");
  const out = {
    topology, clients: stats.connected, failed: stats.failed, events: EVENTS, visibleRowsPerClient: topology === "before" ? "all (9 workspace channels)" : VISIBLE,
    deliveries: stats.deliveries - before.d, deliveredPerEvent: +((stats.deliveries - before.d) / EVENTS).toFixed(1),
    idealRelevantDeliveries: relevant, deliveriesPerRelevantRecipient: relevant ? +(((stats.deliveries - before.d)) / relevant).toFixed(2) : null,
    bytesReceived: stats.bytes - before.b, bytesPerEvent: Math.round((stats.bytes - before.b) / EVENTS),
    serverCounterDelta: m0 != null && m1 != null ? m1 - m0 : null,
  };
  for (const r of reqs) r.destroy();
  await new Promise(r => setTimeout(r, 500));
  return out;
}

const results = [];
for (const t of TOPOLOGY === "both" ? ["before", "after"] : [TOPOLOGY]) results.push(await run(t));
console.log(JSON.stringify(results, null, 2));
if (results.length === 2) {
  const [b, a] = results;
  console.log(JSON.stringify({ comparison: { deliveriesBefore: b.deliveries, deliveriesAfter: a.deliveries, reduction: `${(100 * (1 - a.deliveries / b.deliveries)).toFixed(1)} %`, bytesReduction: `${(100 * (1 - a.bytesReceived / b.bytesReceived)).toFixed(1)} %` } }));
}
process.exit(0);
