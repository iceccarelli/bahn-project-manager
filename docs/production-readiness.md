# Production readiness — status by phase (honest ledger)

Convergence branch `claude/amazing-carson-q1ae16`, based on `main` `6c14bd9`. "Done" means implemented **and** verified with the evidence
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

## Convergence ledger

One command runs every layer that can be proven on one machine: `pnpm gate:convergence` (build, data, auth+mutations,
realtime+UI browser e2e, performance thresholds, deployment gate). It prints PASS / FAIL / SKIPPED per layer and never
reports a layer it could not run as passed. CI runs the same layers as separate required jobs.

| Area | State | Evidence |
|---|---|---|
| Build artifacts | **Verified** | `pnpm check:consistency` (scripts, Dockerfile, vercel, compose, ruleset ↔ ci.yml, alerts ↔ metrics, runbook anchors); `build:production` asserts its own target; bare `vite build` refused; CI `build` + `container` jobs. |
| Production security gaps | **Verified** | `ALLOW_DEMO_LOGIN`, legacy workspaces and legacy OAuth refused at boot; document actions recorded server-side (`audit.record`); delete rows carry a snapshot; checklist submissions audited/evented; role/grant changes audited (`users.grantSnapshot`). `securityAudit.db.test.ts`, `oidc.test.ts`, server-mode step "AUTH (production)". |
| One mutation plane | **Verified** | `server/mutationPlane.test.ts` fails if any module outside the domain services writes project tables. |
| Dashboard / Audit / Search | **Verified (local)** | server read models, per-scope 30 s cache, keyset audit, typed search; every Dashboard number lands on the exact projects it counted (`drill`, server-evaluated). Browser steps DASHBOARD+AUDIT, COMMAND SEARCH, DRILL-DOWN. Date-dependent figures are a TTL-cached scan, not incremental counters. |
| Operations UX | **Verified (local browser)** | persistent non-modal detail drawer (`?detail=<id>`, list position kept, live remote activity, versioned inline edit; step DRAWER); conflict diff with base / current / attempted values and the clashing field marked (PROOF 3a/3b); `/` and Ctrl-K command search, `?projekt=` opens the drawer; phone-width default card view. Demo-build layout gates (`check:responsive`, `check:ui`) run in CI job `e2e`. |
| Realtime convergence | **Verified (local)** | create/delete/move-in/move-out/off-screen/scroll-into-view/reconnect (PROOFS 1–5, TOPOLOGY), Redis outage and app restart chaos steps, two instances, presence (now also leaves on `pagehide`), notifications. The "N Projekte aktualisiert" badge counts distinct changed projects (`projectSyncEngine.test.ts`); the former "known intermittent" is closed. |
| Observability | **Partly** | metrics + `deploy/observability/alerts.yml` (12 rules, checked against exported metrics) + runbook playbooks. **Not exercised against a live Prometheus.** No field web-vitals collection exists (no collection path), so none is claimed. |
| Mainline protection | **NOT APPLIED** | ruleset is code (`.github/rulesets/main.json`); an admin must import it — `docs/mainline-protection.md`. |
| Data governance | **Prepared, not executed** | `docs/data-governance.md`, `scripts/data/verify-history-clean.sh`; the history rewrite needs the data owner and is not part of an application PR. |

## Infrastructure-dependent — no evidence exists yet

| Item | What is missing |
|---|---|
| Real Microsoft Entra sign-in | a tenant; proven only against the mock IdP (`oidc-browser.e2e.ts`) |
| Public HTTPS staging, 2 instances | hosts, DNS, TLS, Entra; `deploy/staging` + `scripts/gate/staging-smoke.mjs` exist, never run publicly |
| Separate-host load certification 100…10,000 | a load host separate from the system under test; `docs/load-testing.md` |
| History rewrite | owner decision and a coordinated force-push |
| Ruleset import | repository admin |
