#!/usr/bin/env node
/**
 * HTTP/tRPC load driver (closed-loop, C concurrent virtual users, keep-alive).
 * Protocol-level only: it measures the API + database, not the browser.
 *
 *   node scripts/load/api-bench.mjs --base http://127.0.0.1:3100 --cookie <session> \
 *        --scenario read|mixed|write-distinct|write-same --vus 500 --seconds 30
 *
 * Reports per-endpoint p50/p95/p99, error rate, and — for the write scenarios —
 * verifies consistency (lost mutations, duplicate side effects, conflict
 * accounting) against the database's own counters via /api/trpc reads.
 */

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("base", "http://127.0.0.1:3000"), COOKIE = arg("cookie", process.env.COOKIE);
const SCENARIO = arg("scenario", "mixed"), VUS = Number(arg("vus", 100)), SECONDS = Number(arg("seconds", 20));
const WRITE_BASE_ID = Number(arg("write-base-id", 150000));
if (!COOKIE) { console.error("--cookie required"); process.exit(2); }

const H = { cookie: `app_session_id=${COOKIE}`, "content-type": "application/json" };
const enc = v => encodeURIComponent(JSON.stringify({ json: v }));
const rnd = n => Math.floor(Math.random() * n);
// Realistic search terms: a station name word (selective) or a project-number prefix.
// (Common words like "bahnsteig" match most of a synthetic table and are an adversarial worst case, measured separately.)
const stations = ["Marburg", "Kassel", "Gießen", "Fulda", "Hanau", "Wetzlar", "Limburg", "Bebra", "Siegen", "Trier", "Worms", "Speyer"];
const lat = new Map(), errs = new Map(); let total = 0;
const rec = (name, ms, status) => {
  total++;
  (lat.get(name) ?? lat.set(name, []).get(name)).push(ms);
  if (status >= 400 || status === 0) errs.set(`${name}:${status}`, (errs.get(`${name}:${status}`) ?? 0) + 1);
};
async function call(name, method, path, body) {
  const t = performance.now();
  try {
    const r = await fetch(BASE + path, { method, headers: H, body });
    const text = await r.text();
    rec(name, performance.now() - t, r.status);
    return { status: r.status, body: text };
  } catch { rec(name, performance.now() - t, 0); return { status: 0, body: "" }; }
}
const q = (name, proc, input) => call(name, "GET", `/api/trpc/${proc}?input=${enc(input)}`);
const parse = t => { try { return JSON.parse(t).result?.data?.json ?? JSON.parse(t).error?.json; } catch { return null; } };

const reads = [
  [30, () => q("list", "projects.list", { limit: 50 })],
  [15, () => q("list+filter", "projects.list", { limit: 50, bahnhofsmanagement: ["Frankfurt", "Kassel", "Mainz"][rnd(3)], projektstand: "EP" })],
  [15, () => q("search", "projects.list", { limit: 50, search: Math.random() < 0.7 ? stations[rnd(stations.length)] : `P-${100000 + rnd(9000)}` })],
  [25, () => q("detail", "projects.get", { id: 1 + rnd(20000) })],
  [10, () => q("shellSummary", "projects.shellSummary", undefined)],
  [5, () => q("dashboard.stats", "dashboard.stats", undefined)],
];
const pickRead = () => { let r = rnd(100); for (const [w, f] of reads) { if ((r -= w) < 0) return f; } return reads[0][1]; };

// Each write VU owns one project, tracks its version, and uses a fresh idempotency key per action.
async function writeDistinct(vu, stop) {
  const id = WRITE_BASE_ID + vu;
  let version = parse((await q("detail", "projects.get", { id })).body)?.version ?? 1, ok = 0, conflicts = 0, other = 0;
  while (performance.now() < stop) {
    const r = await call("write", "POST", "/api/trpc/projects.update", JSON.stringify({ json: { id, expectedVersion: version, changes: { kommentar: `vu${vu}-${ok}` }, idempotencyKey: `bench-${vu}-${Date.now()}-${ok}-${rnd(1e9)}` } }));
    if (r.status === 200) { ok++; version++; } else if (r.status === 409) { conflicts++; version = parse(r.body)?.data?.conflict?.currentVersion ?? version; } else other++;
  }
  return { id, ok, conflicts, other, startVersionOk: true, endVersion: version };
}
// All VUs fight over ONE project with the version they last saw.
async function writeSame(vu, stop, id) {
  let version = parse((await q("detail", "projects.get", { id })).body)?.version ?? 1, ok = 0, conflicts = 0, other = 0;
  while (performance.now() < stop) {
    const r = await call("write(same)", "POST", "/api/trpc/projects.update", JSON.stringify({ json: { id, expectedVersion: version, changes: { kommentar: `vu${vu}-${ok}-${Date.now()}` }, idempotencyKey: `bench-${vu}-${Date.now()}-${rnd(1e9)}` } }));
    if (r.status === 200) { ok++; version++; }
    else if (r.status === 409) { conflicts++; version = parse(r.body)?.data?.conflict?.currentVersion ?? version; }
    else other++;
  }
  return { ok, conflicts, other };
}

const t0 = performance.now(), stop = t0 + SECONDS * 1000;
let extra = {};
if (SCENARIO === "read" || SCENARIO === "mixed") {
  const writers = SCENARIO === "mixed" ? Math.max(1, Math.floor(VUS * 0.1)) : 0;
  const results = await Promise.all([
    ...Array.from({ length: VUS - writers }, async () => { while (performance.now() < stop) await pickRead()(); }),
    ...Array.from({ length: writers }, (_, i) => writeDistinct(i, stop)),
  ]);
  const w = results.filter(Boolean);
  if (w.length) extra = { writes: { ok: w.reduce((a, x) => a + x.ok, 0), conflicts: w.reduce((a, x) => a + x.conflicts, 0), other: w.reduce((a, x) => a + x.other, 0) }, writers: w };
} else if (SCENARIO === "write-distinct") {
  const w = await Promise.all(Array.from({ length: VUS }, (_, i) => writeDistinct(i, stop)));
  extra = { writes: { ok: w.reduce((a, x) => a + x.ok, 0), conflicts: w.reduce((a, x) => a + x.conflicts, 0), other: w.reduce((a, x) => a + x.other, 0) }, writers: w };
} else if (SCENARIO === "write-same") {
  const id = WRITE_BASE_ID - 1;
  const before = parse((await q("detail", "projects.get", { id })).body)?.version ?? 1;
  const w = await Promise.all(Array.from({ length: VUS }, (_, i) => writeSame(i, stop, id)));
  const after = parse((await q("detail", "projects.get", { id })).body)?.version ?? 1;
  const ok = w.reduce((a, x) => a + x.ok, 0);
  extra = { sameProject: { id, versionBefore: before, versionAfter: after, clientSuccesses: ok, conflicts: w.reduce((a, x) => a + x.conflicts, 0), other: w.reduce((a, x) => a + x.other, 0),
    // every success must be exactly one version bump; anything else is a lost or duplicated write
    lostOrDuplicated: Math.abs((after - before) - ok) } };
}

const secs = (performance.now() - t0) / 1000;
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
const table = {};
for (const [name, a] of lat) { a.sort((x, y) => x - y); table[name] = { n: a.length, "p50 ms": +pct(a, .5).toFixed(1), "p95 ms": +pct(a, .95).toFixed(1), "p99 ms": +pct(a, .99).toFixed(1), "max ms": +a.at(-1).toFixed(1) }; }
const errorCount = [...errs.entries()].filter(([k]) => !k.endsWith(":409")).reduce((a, [, n]) => a + n, 0);
console.log(JSON.stringify({ scenario: SCENARIO, vus: VUS, seconds: +secs.toFixed(1), requests: total, rps: Math.round(total / secs), errorRate: +(errorCount / total * 100).toFixed(3) + "%", errors: Object.fromEntries(errs), ...extra, writers: undefined }, null, 1));
console.table(table);
