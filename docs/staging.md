# Staging data plane

**Status: NOT DEPLOYED.** This workspace has no Docker daemon, no second host, no DNS/TLS, no Microsoft Entra tenant
and no permission to create cloud infrastructure, so no staging environment exists and there is **no staging URL**. What
exists is everything needed to stand one up and to prove it once it is up:

| Piece | Where | Verified how |
|---|---|---|
| Production build of server + SPA (server mode) | `scripts/e2e/build-server-mode.sh`, `Dockerfile --build-arg VITE_SERVER_MODE=1` | built and run in the browser proof; Dockerfile itself **not built** (no daemon) |
| Runtime-image equivalent | `scripts/gate/container-sim.sh` | prod-only `pnpm install` into an empty dir boots the artifact: ready/health/SPA/CSP/metrics all 200, 0 missing-module errors |
| Relational DB + migrations | `node dist/migrate.js` | fresh MariaDB: 7 migrations, triggers + FULLTEXT present, idempotent (MySQL 8.4 **not** run) |
| Redis + realtime gateway + outbox relay | in the app process; `REDIS_URL` | two instances + Redis in the browser proof and chaos test |
| Real OIDC | `OIDC_ISSUER/OIDC_AUDIENCE(/OIDC_JWKS_URI)` | validated with a local test IdP (signature/iss/aud/exp/alg=none); **not** against Entra |
| HTTPS + SSE-safe proxy | `deploy/staging/Caddyfile` (auto TLS, unbuffered SSE) | config only; never run |
| Structured logs / metrics / tracing | `/api/metrics` (token), `x-trace-id` on every response, traceId in events+audit; logs are Caddy JSON + app `console` | metrics and trace ids verified; no log shipping or dashboards; Sentry not wired |
| Smoke test of a deployed environment | `scripts/gate/staging-smoke.mjs` | 15/15 against a local instance (`scripts/gate/local-smoke.ts`); **never run against staging** |

## To deploy (manual steps)

1. Create an Entra app registration for the API (audience) and define app roles `admin|editor|viewer`; add optional
   claims `workspaces` (list of Bahnhofsmanagement names, or `["ALL"]`) and `departments`. **Missing workspace claim = no
   access** by design.
2. `cp deploy/staging/.env.example deploy/staging/.env`, fill it, point DNS at the host, then
   `docker compose -f deploy/staging/docker-compose.yml --env-file deploy/staging/.env up -d --build`.
3. Seed data (`tsx scripts/e2e/seed-real.ts <db-url>` loads the real 1,298 projects) — staging only.
4. `STAGING_URL=https://… SMOKE_TOKEN=<token from the IdP> node scripts/gate/staging-smoke.mjs` and record the JSON.
5. From a **different host**: `BASE=https://… TOKEN=… node scripts/load/certify.mjs`, then `pnpm gate`.

Browser sign-in (MSAL) is not implemented: until it is, a person cannot obtain a token in the browser; the SPA reads it from
`sessionStorage['bahn.access_token']` (or a session cookie from the non-production demo login).
