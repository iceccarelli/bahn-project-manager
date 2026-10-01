# Scaling

## Targets (engineering goals — **not** measurements)

| Target | Value |
|---|---|
| API read p95 | < 250 ms |
| Mutation p95 | < 400 ms |
| Realtime propagation p95 | < 500 ms |
| Error rate | < 0.1 % |
| Lost mutations / duplicate side effects | 0 / 0 |
| Conflict detection | 100 % |
| INP / LCP / CLS | < 200 ms / < 2.5 s / < 0.1 (**not measured** — no browser RUM yet) |

## Measured single-instance capacity (this sandbox: 4 vCPU shared by Node, MariaDB **and** the load generator)

| What | Result |
|---|---|
| Realtime connections, 1 instance | 10,000 held, 0 failed; RSS 552 MB; delivery 100 % |
| Read API, closed-loop 100 VUs, no think time | ~480 rps ceiling; **Node CPU-bound (≈110 % of one core)**, MariaDB ≈50 %, generator ≈30 % |
| Read API, 20 VUs | p95 28–65 ms |
| Writes | ~260 writes/s ceiling; p95 27 ms @5 VUs, 91 ms @20 VUs, 449 ms @100 VUs (saturated → queueing) |

Consequence: **one Node process ≈ 500 read rps / 260 write rps on this hardware.** The API is stateless, so capacity is
horizontal: N instances behind a load balancer + Redis for realtime fan-out.

## Measured: 10,000 UNIQUE authenticated users (`scripts/load/unique-users.mjs`, same sandbox, co-located generator)

Each connection carries its own RS256 OIDC token (distinct subject); nothing is served from the identity cache.

| Burst | connected | connect p50/p95/p99 | server CPU avg/max (100 = 1 core) | RSS max | DB statements during run | fan-out of one event (p95) |
|---|---|---|---|---|---|---|
| 10,000 users over 60 s | 10,000 / 0 failed | 11 / 22 / 31 ms | 20 % / 79 % | 343 MB | 4,237 (≈ head reads + 20 batched user upserts) | 419 ms, 100 % delivered |
| 10,000 users over 10 s | 10,000 / 0 failed | 54 / 125 / 157 ms | 61 % / 109 % | 352 MB | 2,942 | 388 ms, 100 % delivered |

`auth_verify` mean 3.4 ms (60 s) / 9.2 ms (10 s) — dominated by event-loop queueing during the burst, not by RS256; DB
pool `inUse 0 / queued 0`, 0 shed. Before the redesign (2 queries per first sighting, one feed-head query per connect)
the same burst showed `pool inUse 10, queued 71` and ~11,000 statements. **This is one machine with the generator on
the same host — not a certification.**

## Capacity model for 10,000 *users* (assumption, not a measurement)

If a user issues one request every ~5–10 s, 10,000 users ≈ 1,000–2,000 rps. At ~500 rps/instance that is **3–5
instances** plus a database sized for it (MariaDB used ~0.5 core per 500 rps of this mix here). 10,000 simultaneous
realtime connections fit on **one** instance (552 MB); spread across instances they need Redis (verified with 2). The
single MySQL primary is the shared bottleneck: writes serialize on `domain_events`/`audit_log` inserts, reads should move
to a replica before that matters. **This has not been demonstrated at 10k VUs** — see load-testing.md.

## Knobs

| Env | Default | Meaning |
|---|---|---|
| `DB_POOL_SIZE` / `DB_QUEUE_LIMIT` | 10 / 200 | per-instance request pool; total conns = instances × size, keep < server `max_connections` |
| `RELAY_POOL_SIZE` | 3 | outbox relay pool (isolated from request traffic) |
| `REDIS_URL` | unset | set to enable multi-instance realtime fan-out |
| `RT_MAX_CONNECTIONS` / `RT_MAX_PER_PRINCIPAL` | 50000 / 20 | gateway admission limits |
| `HEAP_MB` | node default | `--max-old-space-size` |

## Deployment options for server mode (decision needed — not made here)

* **Container (existing `Dockerfile`/compose path)** on any orchestrator: simplest for SSE + Redis + MySQL; recommended
  first target. Needs `REDIS_URL`, `DATABASE_URL`, OIDC env, `JWT_SECRET`, `METRICS_TOKEN`.
* **Vercel**: serving `/api/trpc` + long-lived SSE needs Fluid/Node functions with long `maxDuration`, a managed
  MySQL-compatible DB reachable from functions (connection limits!), and Redis (Upstash/Vercel KV) — the in-process
  outbox relay and `GET_LOCK` leader model assume long-lived processes, so a scheduled/worker relay would be needed.
  Not attempted.

## Known scaling limits / next levers

1. Node CPU: per-request cost is flat framework overhead (tRPC/superjson/zod/drizzle; profile in load-testing.md) —
   scale out, or trim (skip superjson for pure-JSON procedures, batch reads).
2. DB: `COUNT(*)` for the shell is O(rows) (23 ms @200k, cached 5 s) → maintain a counter beyond ~2M rows.
3. Very common search terms cost ~150 ms (they match most rows) — needs relevance caps / stop-terms.
4. `dashboard.stats` recomputes with GROUP BYs over `department_reviews` (3 s @280k reviews) — cached now; a
   maintained aggregate table fed by review events is the durable fix (reviews are not evented yet).
5. Single relay leader = single publisher throughput ceiling (batch 200/250 ms poll; nudged on commit).
