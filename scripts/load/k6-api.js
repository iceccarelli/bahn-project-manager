// k6 capacity suite (NOT run in the sandbox — k6 is not installed there; see docs/load-testing.md).
//   k6 run -e BASE=https://staging.example -e TOKEN=<oidc-bearer> -e STAGES=100,500,1000,2500,5000,10000 scripts/load/k6-api.js
// Each stage holds for HOLD seconds. Thresholds are the TARGETS from docs/scaling.md, not measurements.
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

const BASE = __ENV.BASE, TOKEN = __ENV.TOKEN, HOLD = Number(__ENV.HOLD || 120);
const stages = (__ENV.STAGES || "100,500,1000,2500,5000,10000").split(",").map(Number);
const conflicts = new Counter("mutation_conflicts"), lost = new Counter("lost_mutations");
const writeMs = new Trend("write_ms", true);

export const options = {
  scenarios: {
    browse: {
      executor: "ramping-vus",
      stages: stages.flatMap(v => [{ duration: "60s", target: v }, { duration: `${HOLD}s`, target: v }]),
      exec: "browse",
    },
    write_distinct: { executor: "constant-arrival-rate", rate: 20, timeUnit: "1s", duration: `${stages.length * (60 + HOLD)}s`, preAllocatedVUs: 50, exec: "writeDistinct" },
  },
  thresholds: {
    "http_req_duration{kind:read}": ["p(95)<250"],    // TARGET: API read p95 < 250 ms
    "http_req_duration{kind:write}": ["p(95)<400"],   // TARGET: mutation p95 < 400 ms
    http_req_failed: ["rate<0.001"],                  // TARGET: error rate < 0.1 %
    lost_mutations: ["count==0"],                     // TARGET: lost mutations = 0
  },
};

const H = { headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } };
const enc = v => encodeURIComponent(JSON.stringify({ json: v }));
const read = (proc, input) => http.get(`${BASE}/api/trpc/${proc}?input=${enc(input)}`, { ...H, tags: { kind: "read", name: proc } });

export function browse() {
  const r = Math.random();
  if (r < 0.45) read("projects.list", { limit: 50 });
  else if (r < 0.60) read("projects.list", { limit: 50, search: ["Marburg", "Kassel", "Fulda"][Math.floor(Math.random() * 3)] });
  else if (r < 0.90) read("projects.get", { id: 1 + Math.floor(Math.random() * 20000) });
  else if (r < 0.97) read("projects.shellSummary", undefined);
  else read("dashboard.stats", undefined);
  sleep(2 + Math.random() * 6); // think time: a human, not a loop
}

export function writeDistinct() {
  const id = 100000 + (__VU % 5000), key = `k6-${__VU}-${__ITER}-${Date.now()}`;
  const cur = read("projects.get", { id }).json("result.data.json");
  if (!cur) return;
  const res = http.post(`${BASE}/api/trpc/projects.update`, JSON.stringify({ json: { id, expectedVersion: cur.version, changes: { kommentar: key }, idempotencyKey: key } }), { ...H, tags: { kind: "write" } });
  writeMs.add(res.timings.duration);
  if (res.status === 409) conflicts.add(1);
  else if (!check(res, { "write ok": r => r.status === 200 })) lost.add(1);
}
