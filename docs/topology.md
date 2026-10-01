# Production topology — the one authoritative decision

**Decision: the production system is the container stack in `deploy/staging/` (same shape for production): Caddy (TLS,
unbuffered SSE) → 2+ identical Node app containers → MySQL 8.4 + Redis 7. Vercel is NOT the production host.**

Why Vercel cannot be the backend for this architecture (not an opinion about Vercel in general, a property of this design):

| Requirement | Why serverless functions do not fit |
|---|---|
| Long-lived SSE streams (10k concurrent) | A function invocation is bounded in time and billed per duration; the gateway holds each stream for up to `RT_MAX_AGE_MS`. |
| Single leader outbox relay (`GET_LOCK`) + dedicated DB pool | Needs a process that lives; a cold function cannot be the relay. |
| In-process LocalHub / Redis subscriber per instance | Needs long-lived connections to Redis and the DB. |
| Connection-pool sizing (`DB_POOL_SIZE`) | Per-instance pool arithmetic breaks when instance count is elastic and short-lived. |

Nothing in this repository proves the backend running on Vercel, so nothing claims it. `vercel.json` stays what it is: a
**static demo build** (`pnpm build:demo`, rewrites to `index.html`, no functions). That deployment is the browser-local
demo: its data lives in the visitor's browser, its login is the demo login, it has no server and no multi-user
synchronisation. The demo artifact says so on every page; the production artifact cannot contain that notice or the dataset
(`scripts/assert-build-target.mjs`). It must not be the URL anyone treats as "the system".

## What "production" means here

| Layer | Component | Evidence required before it may be called deployed |
|---|---|---|
| Edge | Caddy, automatic TLS, `flush_interval -1` for SSE | public HTTPS URL answering `staging-smoke.mjs` |
| App | ≥ 2 containers from one image (`Dockerfile` = `pnpm build:production`; the only build-args are the public `VITE_OIDC_*` values) | smoke check "at least two app instances serve this URL" |
| DB | MySQL **8.4** (not MariaDB) | gate check `mysql-version`; the full suite green on that server |
| Cache/bus | Redis 7, `noeviction` | realtime across both instances (smoke: second user receives the update live) |
| Identity | OIDC IdP (Microsoft Entra ID), bearer access tokens | smoke tokens issued by the real IdP |
| Static legacy data | not shipped: the server artifact contains no `data.json` / `schedule.json` (removed at build, 404 at runtime) | build-target assertion, container gate, e2e "no dataset side door" |

If the team decides on another container host (ECS, Cloud Run with min-instances + CPU always allocated, a VM with
Compose, Kubernetes) the app image and the environment contract are unchanged; only `deploy/staging/` is replaced. If the
decision ever becomes "Vercel", the SSE gateway, the relay and the pool model must be redesigned and re-certified first;
that is a different project from the one in this repository.
