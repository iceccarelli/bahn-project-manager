# Load testing

**Rule:** the system is not called "10k capable" until the agreed SLOs are demonstrated at 10,000 VUs, against a
production-shaped deployment, with the generator on separate hosts. **It has not been.** What exists is a harness plus
single-box measurements that found and fixed real defects.

## Harness (`scripts/load/`)

| Script | Purpose | Ran here? |
|---|---|---|
| `setup-db.mjs` | migrations + N synthetic projects (200k), reviews for 20k, load users | yes |
| `explain.mjs` | plan + median/p95 for the list/search/outbox queries, with/without each index | yes |
| `run-server.sh` | starts the **built** bundle `dist/index.js` (`REDIS_URL`, ports, pools via env) | yes |
| `mint-session.mjs` | signed session cookie for the seeded users | yes |
| `api-bench.mjs` | closed-loop HTTP/tRPC driver: `read`, `mixed`, `write-distinct`, `write-same` (hot project) + consistency check. `--ids MIN:MAX` (default **1:1298**, the real dataset, so no artificial 404s; use `--ids 1:200000` for the synthetic DB) and `--think-ms N` (per-VU think time) | yes (≤100 VUs; 50-VU run on the real 1,298-row dataset on MySQL 8.4: 0 % errors, hot-project run 0 lost/duplicated writes) |
| `realtime-fanout.mjs` | N SSE connections, one mutation, per-connection propagation latency; multi-instance via comma list | yes (≤10,000 conn) |
| `k6-api.js` | ramping 100→10,000 VU suite with think time and SLO thresholds | **no — k6 not installable here** |

Reproduce: `node scripts/load/setup-db.mjs mysql://u:p@127.0.0.1:3306 bahn_load 200000 && pnpm build:server &&
JWT_SECRET=… scripts/load/run-server.sh && node scripts/load/realtime-fanout.mjs --base http://127.0.0.1:3100
--cookie "$(JWT_SECRET=… node scripts/load/mint-session.mjs)" --connections 10000 --project 5`.

## `certify.mjs` stages (external host only)

`BASE=https://… COOKIE|TOKEN=… METRICS_TOKEN=… node scripts/load/certify.mjs --ids 1:1298 [--think-ms 1000] [--stages-api 100,500,1000,2500,5000,10000]`

mixed read/write API stages (each samples the server's outbox backlog, dead letters, pool in-use/queued, shed and unhandled
counters before/after, and `/api/ready` afterwards) → `concurrent-writes` (200 VUs, distinct + shared projects) → `hot-project`
(200 VUs on one row; every success must be exactly one version bump) → realtime stages 1,000…10,000 → **not-run** entries for
unique-users, reconnect-storm, redis-restart, app-instance-restart, relay-interruption, db-degradation and soak, because those
need an IdP the deployment trusts or orchestrator access to the stack. Any `not-run` keeps the verdict `not-certified`.
CPU/RSS of the server are read from the host's own monitoring (not visible to a remote client) and must be attached by the operator.

## Results (sandbox: 4 vCPU/16 GB, MariaDB 10.11, Node 22, generator co-located, loopback)

**Realtime fan-out** (re-measured on the final build, with per-recipient event filtering active: 10,000 → p95 319–370 ms single instance, 241–413 ms over two instances; 5,000 → 142–158 ms; 1,000 → 46–125 ms) — one event → N connections on one project scope; 3 rounds each; latency = mutation sent → frame
read by client (includes HTTP write, DB commit, relay, bus, socket):

| Connections | delivered | p50 | p95 | p99 | server RSS |
|---|---|---|---|---|---|
| 1,000 | 100 % ×3 | 45–83 ms | 51–116 ms | 52–117 ms | — |
| 2,500 | 100 % ×3 | 64–95 ms | 78–112 ms | 79–115 ms | — |
| 5,000 | 100 % ×3 | 109–153 ms | 144–207 ms | 146–211 ms | 341 MB |
| **10,000** (1 instance, in-process bus) | **100 % ×3** | 224–282 ms | **319–370 ms** | 324–376 ms | 552 MB (earlier build) |
| **10,000** (2 instances + Redis, 5,000 each; event written via instance 1) | **100 % ×3** | 168–327 ms | **241–413 ms** | 246–422 ms | — |

Instance counters after the 2-instance run: each instance delivered 15,000 = 3×5,000; only one instance relayed
(`outbox_published_total` 3 vs 0). Caveats: one scope, one event at a time, one cached principal, loopback, shared CPU;
propagation grows with fan-out because a single Node thread writes 10k sockets.

**API (closed loop, zero think time = far harsher than real users):**

| Scenario | Result |
|---|---|
| read mix, 100 VUs | 463–500 rps, 0 % errors, list p50 ≈180 ms / p95 ≈235–260 ms — **saturated**, Node at 110 % CPU |
| mixed 20 VUs (90 % read/10 % write) | 533 rps, 0 % errors; read p95 28–64 ms; write p95 180 ms |
| write-distinct 5 / 20 / 100 VUs | p95 27 / 91 / **449 ms** (400 ms target missed only when saturated) |
| write-same, 50 VUs → ONE project, 15 s | 72 successes, **3,492 conflicts**, version 1→73, **lost or duplicated = 0** |
| DB after the runs | `domain_events` 3,943 = `audit_log` 3,943 = `idempotency_keys` 3,943; unpublished 0; dead-lettered 0 |

At 500 VUs (before the fixes below) the service returned 81 % errors — see "Defects found".

## Defects the load work found (all fixed, each with a regression test or re-measurement)

1. **Server crash**: 1,000 simultaneous SSE connects → per-connect DB lookups exhausted the pool → unhandled rejection
   in an async Express handler killed the process. Fixed: boundary `try/catch` → 503 + `Retry-After`; no DB lookup for
   unrestricted principals; single-flight identity resolution; process-level rejection counter.
2. **Relay starved by request traffic** (shared pool) → realtime stalls under load. Fixed: dedicated relay pool.
3. **Pool exhaustion surfaced as opaque 500** → explicit 429 backpressure.
4. **Poison outbox row blocked all events** → dead-letter (`failedAt`).
5. **Outbox index** `(processedAt,createdAt,id)` filesorted the whole backlog per poll (26 ms @100k backlog; 210 ms
   without any index) → `(processedAt,id)` (0.8 ms).
6. `dashboard.stats`: 3.1 s per request, monopolising the pool → single-flight SWR cache.
7. `slugify("Gießen")` → `gie-en` (workspace routing bug) → fixed, tested.
8. Client believed it was offline in Node (`navigator.onLine` undefined) → fixed.
9. 10 concurrent retries of one idempotency key deadlocked (S→X lock upgrade) → shared-mode read + bounded deadlock retry.

## Stage 2 additions (same sandbox, same caveats)

| Script | Purpose | Ran here? |
|---|---|---|
| `unique-users.mjs` | N distinct tokens, ramped burst, fan-out, CPU/RSS/DB/pool | yes: 1,000 and 10,000 (60 s and 10 s bursts) |
| `chaos.ts` | 300 real clients (production `RealtimeConnection` + `ProjectSyncEngine`) across 2 instances while a writer commits; faults: instance SIGKILL+restart, Redis restart (4 s), DB stall (SIGSTOP 6 s), both-instance restart (reconnect storm) | yes — **all scenarios converge**, outbox drained, 0 dead letters, feed gapless |
| `certify.mjs` | staged API/realtime suite against a DEPLOYED environment; **refuses to run from the server's own host** (`X-Instance` header) and writes `artifacts/load-certification.json` | refusal verified locally; **not run against a deployment** |
| `k6-api.js` | ramping 100→10,000 VUs with think time and SLO thresholds | no (k6 not available) |

Fault-injection (chaos.ts) found a real client defect the earlier tests could not: a `catchUp` that skipped events it had
"seen" left aggregates permanently behind after a failed recovery; the reconcile now decides by version, with a regression
test. Local resilience evidence only — instance restarts here are `SIGKILL` + restart on the same ports.

## Load certification status (item 12 of the brief): **NOT DONE**

Required: API 100/500/1000/2500/5000/10000 VUs, realtime 1000/2500/5000/10000, unique users with think time, mixed
reads/writes, simultaneous writes, reconnect storm, relay/Redis restart, DB degradation, burst, soak — **generator on a
separate host, against a deployed staging environment**. No such environment or second host exists in this workspace, so
none of it was run as certification. The harness above is ready; `scripts/gate/deploy-gate.mjs` reports
`load-certification` as `not-run` until `artifacts/load-certification.json` exists with `separateHosts: true`.

## Not yet tested — **NOT DONE**

API stages above 100 VUs; soak; the generator on separate hosts; INP/LCP/CLS; a MySQL 8.4 run (local runs used
MariaDB); CI has never executed the new suites (see the CI note in docs/runbook.md).