# Staging data plane

**Status: NOT DEPLOYED. There is no staging URL and the system is NOT certified for deployment.** This workspace has no
public ingress, no second host, no Microsoft Entra tenant and no permission to create cloud infrastructure. Nothing below
is a staging result; it is the list of what exists, what was proven on the development host, and exactly what is missing.

Topology: see [topology.md](topology.md) (containers + Caddy; Vercel is a static demo only).

## What was proven on the development host (labelled as such — not staging, not external)

| Claim | Evidence | Where it runs |
|---|---|---|
| Migrations, FULLTEXT, audit triggers, `GET_LOCK`, `LOCK IN SHARE MODE` idempotency, deadlock retry, outbox, audit immutability work on **MySQL 8.4.11** under the default strict `sql_mode` | `node dist/migrate.js` ×2 (idempotent), full suite **432 passed / 0 skipped** with `TEST_DATABASE_URL` → `mysql:8.4` container, 2 triggers + `projects_search_ft` present | local container on the dev host |
| Real browser sign-in (OIDC code + PKCE) → bearer on tRPC **and** SSE, token only in `sessionStorage`, logout clears it and ends the IdP session, forged/expired/wrong-audience tokens → 401, no claim → no data | `scripts/e2e/oidc-browser.e2e.ts` (10 steps) | local, **mock authority — not Entra** |
| Legacy snapshot (`/data.json`, `/schedule.json`) is not a public file in server builds: 401 anonymous, 403 workspace-restricted, 200 only for all-workspace principals | same e2e + smoke check; found and fixed during this work (it was an unauthenticated download of all 1,298 projects) | local |
| Smoke suite covers identity, list/search/filter/sort/cursor, create, optimistic versioning + idempotent replay, audit, outbox→feed, live propagation to a second user, workspace-move leak + access, reconnect recovery, notification path, presence, delete, no-claim, snapshot protection | `scripts/gate/staging-smoke.mjs`, run by `scripts/gate/local-smoke.ts` against one local instance on MySQL 8.4 with the real 1,298-row dataset: 27/27 checks | local, single instance (the "≥ 2 instances" check is *expected to fail* there) |
| Load harness addresses the real dataset (ids 1..1,298, no artificial 404s), think time, hot-project and concurrent-write scenarios, server-side backlog/pool/dead-letter sampling | `scripts/load/api-bench.mjs --ids 1:1298`, `certify.mjs` | local smoke runs only |

## What is NOT done (each is a blocker for "certified")

1. **No public HTTPS staging** with ≥ 2 app instances, real MySQL, real Redis. → `staging-smoke` is `not-run`.
2. **The `Dockerfile` has not been built successfully.** A build was attempted on the dev host; it stopped at
   `corepack prepare pnpm` because the Docker build network could not reach `registry.npmjs.org`. The image is therefore unverified.
3. **No external load run.** `certify.mjs` refuses same-host runs (`X-Instance`), so `load-certification` stays failed/not-run.
   Fault scenarios (Redis restart, instance restart, relay interruption, DB degradation) and soak need orchestrator access to the
   staging stack and are reported `not-run` by `certify.mjs`.
4. **No real Entra tenant.** The browser flow, the claim mapping (`roles`, `workspaces`, `departments`) and token audience are
   unproven against Entra.
5. Remaining pages are not server-authoritative yet (Dashboard, BVB-EEA, PSV-ITK, Anmeldung, Audit, Gewerk workspaces): they
   read the legacy snapshot, read-only in server mode. Per the plan they are migrated only after staging certification.

## External prerequisites (exact)

* A Linux host (or two) with Docker, a public DNS name and ports 80/443 → `PUBLIC_HOST`, `PUBLIC_ORIGIN`.
* Docker Hub (or a mirror) and the npm registry reachable from the image build.
* A **separate** load-generator host (different machine; not the app host) with network access to `PUBLIC_HOST`, ≥ 8 vCPU for 10k connections.
* Microsoft Entra ID:
  * API app registration: expose scope `access_as_user`; app roles `admin|editor|viewer`; optional claims `workspaces`
    (Bahnhofsmanagement names, or the literal list `["ALL"]`), `departments`; set `accessTokenAcceptedVersion: 2`.
    `OIDC_ISSUER=https://login.microsoftonline.com/<tenant>/v2.0`, `OIDC_AUDIENCE=<api client id>`.
  * SPA app registration: platform *Single-page application*, redirect URI `https://<PUBLIC_HOST>/auth/callback`,
    post-logout URI `https://<PUBLIC_HOST>/login`; `VITE_OIDC_AUTHORITY`, `VITE_OIDC_CLIENT_ID`, `VITE_OIDC_SCOPE=openid profile api://<api client id>/access_as_user`.
  * Three test users → tokens: `SMOKE_TOKEN` (admin, `["ALL"]`), `SMOKE_TOKEN_RESTRICTED` (editor, exactly one workspace =
    `SMOKE_WORKSPACE`), `SMOKE_TOKEN_NOCLAIM` (no workspace claim).
* The CSP `connect-src` is derived from `OIDC_ISSUER`'s origin (Entra: `https://login.microsoftonline.com`); add
  `CSP_CONNECT_EXTRA` if the IdP's token endpoint lives on another origin.

## To deploy (manual steps)

1. Create an Entra app registration for the API (audience) and define app roles `admin|editor|viewer`; add optional
   claims `workspaces` (list of Bahnhofsmanagement names, or `["ALL"]`) and `departments`. **Missing workspace claim = no
   access** by design.
2. `cp deploy/staging/.env.example deploy/staging/.env`, fill it, point DNS at the host, then
   `docker compose -f deploy/staging/docker-compose.yml --env-file deploy/staging/.env up -d --build`.
3. Seed data (`tsx scripts/e2e/seed-real.ts <db-url>` loads the real 1,298 projects) — staging only.
4. `STAGING_URL=https://… SMOKE_TOKEN=… SMOKE_TOKEN_RESTRICTED=… SMOKE_TOKEN_NOCLAIM=… SMOKE_WORKSPACE=<ws> SMOKE_WORKSPACE_OTHER=<ws2> METRICS_TOKEN=… node scripts/gate/staging-smoke.mjs > artifacts/staging-smoke.json` and keep the JSON.
5. From a **different host**: `BASE=https://… COOKIE|TOKEN=… METRICS_TOKEN=… node scripts/load/certify.mjs --ids 1:1298`, then `pnpm gate` (with the smoke variables set).

Browser sign-in is implemented as OIDC code + PKCE (`client/src/realtime/oidcClient.ts`), no client secret, no refresh token and
no id token stored; the access token lives in memory/`sessionStorage` only and is gone on logout/tab close.
