# Production readiness — status by phase (honest ledger)

Branch `claude/amazing-carson-q1ae16`, continued from `736c1de`. "Done" means implemented **and** verified with the evidence
named; anything that needs infrastructure, credentials or an owner decision this environment does not have is listed as a gap,
not as a pass.

## Artifacts

| Artifact | Command | Where it runs |
|---|---|---|
| **Production** (server data plane, `VITE_SERVER_MODE=1`) | `pnpm build:production` / the `Dockerfile` (no `VITE_SERVER_MODE` build-arg exists) | the container stack (Caddy → 2× Node → MySQL 8.4 + Redis 7), `deploy/staging/docker-compose.yml` |
| **Demo** (browser-local, `VITE_SERVER_MODE=0`) | `pnpm build:demo` | Vercel preview/demo only (`vercel.json`) |

`build:production` refuses to run with SERVER_MODE off, stamps `build-info.json`, and `scripts/assert-build-target.mjs` fails CI
if a production artifact says `serverMode:false`, ships the demo notice, or contains `data.json`/`schedule.json`. The container
gate re-checks the *image* (`/build-info.json`, `/data.json` → 404).

## Phase ledger

| # | Phase | State | Evidence / what is missing |
|---|---|---|---|
| 1 | Remove demo/production split | **Done** | build separation + guards above; CI `build` job proves a demo build is rejected as production |
| 2 | CI container gate | **Done** (CI-proven) | `container` job: real image, MySQL 8.4 + Redis 7 services, CI-only config; asserts the image still refuses to boot without it, migrations ×2, `/api/health`, `/api/ready` (DB + Redis), production client in image, SIGTERM → exit 0. Production config now *requires* `REDIS_URL` and `OIDC_AUDIENCE`. |
| 3 | Mainline convergence | **In progress** | PR #2; required checks listed in `.github/rulesets/main.json` (`container` added). **Branch protection is not applied** — the ruleset file must be imported by a repo admin (no API access here). |
| 4 | Authoritative data plane | **Done in code**, browser-proven | Dashboard (`dashboard.portfolio`/`reel`), Audit (`audit.page`, keyset, workspace-scoped, new `audit_log.workspace`), Search (`search.query`) are server-backed; legacy snapshot removed from the server artifact. Server-mode e2e covers scope per identity, paging, direct links. **Gaps:** Dashboard figures are a per-scope TTL-cached scan (30 s), not incrementally maintained counters (date-dependent figures cannot be); Ask Bahn is not offered in the server build; audit undo is not available in the server build; Projects page does not yet apply `bedarf`/`tone` chips server-side (Dashboard click-throughs for those land on an unfiltered list). |
| 5 | Domain unification audit | **Audited, partly fixed** | Fixed: direct-write Excel import removed; export workspace-scoped; unscoped `audit.list`, `searchSuggestions` removed, `shellSummary` scoped; booking→project link authorized; review department/status validated; operator seed scripts refuse production; unknown `/api/*` → 404. **Open (documented, not fixed):** server-side recording of client-side document actions (PDF/CSV/mail) in `audit_log` (still local only); delete audit rows carry no field snapshot; checklist-submit reviews are not individually audited/evented; users-table role sync is not audited; `ALLOW_DEMO_LOGIN` still accepted in production config. |
| 6 | Realtime topology | **Preserved, tested** | collection/row fan-out untouched. Browser e2e: create, delete, move-in/out, off-screen edit, scroll-into-view subscription, reconnect/recovery (PROOFS 1–5, TOPOLOGY); unit/DB: Redis bus (multi-instance), subscribe barrier race, feed recovery. |
| 7 | Projects UI performance | **Gated** | `scripts/perf/thresholds.json` + `ui-perf` CI job. Latest local run: DOM 1409, rows in DOM 20, heap 9.9 MB, scroll p95 66.6 ms, INP 96 ms (loaded dev box), first marker 512 ms. The job is **not yet in the required-checks list** until it has been seen green on CI. |
| 8 | Persistent detail drawer | **Not done** | |
| 9 | Global command search | **Partly done** | server-side typed search (projects, numbers, stations, leaders, reviewers, regions, audit, bookings, own notifications), Enter opens the exact project; `/` and Ctrl-K palette exist. Not done: dedicated reviewer/department filters in the palette, keyboard-first polish. |
| 10 | Map data plane | **Unchanged (already server-backed)** | `map.query` by bbox/zoom/authorization; Dashboard now uses `ServerMap` in the server build. |
| 11 | Presence + notifications | **Unchanged (already implemented)** | Redis presence, durable SQL notifications; covered by e2e (PRESENCE, NOTIFICATIONS). |
| 12 | Real Entra OIDC | **Not done — needs a tenant** | Server and browser sign-in are proven against a *mock* IdP (`oidc-browser.e2e.ts`: valid/forged/tampered/wrong-audience/expired tokens, no claim, restricted, logout). No Microsoft Entra evidence exists. |
| 13 | Production topology | **Specified** | `docs/topology.md`, `deploy/staging/`; stateless app verified by the two-instance e2e. |
| 14 | Public data governance | **Prepared, not executed** | exact paths/commits in `docs/data-governance.md`; `scripts/data/verify-history-clean.sh`. History rewrite needs the owner. |
| 15 | Staging | **Not done — needs hosts/DNS/Entra** | `deploy/staging` + `scripts/gate/staging-smoke.mjs` (27 checks) exist and have not been run against a public HTTPS environment. |
| 16 | External load certification | **Not done — needs a separate host** | Nothing here may be quoted as 10k certification. |
| 17 | UX polish | **Not done** | |
| 18 | Observability | **Partly** | metrics endpoint (latency, pool, outbox backlog, unhandled), UI budgets in CI. Not done: LCP/INP/CLS field collection, dead-letter and reconnect dashboards. |

## Known intermittent
`server/realtime/e2e.db.test.ts` "B disconnects, A changes 3×, B reconnects" failed once in four full local runs
(`lastSyncedChanges` was 2 instead of 3: the "N Änderungen synchronisiert" badge mixes feed events and changed aggregates).
Convergence assertions passed; the count is cosmetic. Not yet root-caused.
