# Runbook

## Start / configure

```
NODE_ENV=production PORT=3000 \
DATABASE_URL=mysql://… JWT_SECRET=<≥32 random chars> \
OIDC_ISSUER=https://login.microsoftonline.com/<tenant>/v2.0 OIDC_AUDIENCE=<api client id> \
REDIS_URL=redis://… METRICS_TOKEN=<token> node dist/index.js
```
`GET /api/health` liveness · `GET /api/ready` readiness (`SELECT 1`) · `GET /api/metrics` (token).
Migrations: `pnpm db:push` (`drizzle/0004_event_pipeline.sql` adds `domain_events`, `idempotency_keys`, audit columns,
`projects_updatedAt_id_idx`, FULLTEXT index, append-only audit triggers). The FULLTEXT build and index creation lock/scan
a large table — run off-peak.
Client: build with `VITE_SERVER_MODE=1` to enable server mode (default off = static local mode).

## Failure modes

| Symptom | Likely cause | Action |
|---|---|---|
| Clients show "Verbindung wird wiederhergestellt" | instance restarting / LB idle timeout < 15 s heartbeat | raise LB idle timeout > 60 s; clients auto-recover |
| Edits saved but others don't see them | relay not publishing | `bahn_outbox_backlog`; check log `[outbox]`; DB reachable from **relay pool**; only one leader holds `GET_LOCK('bahn:outbox-relay')` |
| Events published, other instance's users don't get them | Redis down/unset | `REDIS_URL`; fan-out is per-instance without it. Clients self-heal on next event via gap → `projects.sync` |
| `bahn_outbox_dead_letters_total` > 0 | schema-invalid envelope (`failedAt`, `failureReason`) | inspect row; clients heal via version-gap recovery; fix producer |
| 429 `Server ausgelastet` | DB pool queue full | scale instances/pool; check slow queries; `bahn_requests_shed_total` |
| 503 on `/api/realtime/stream` | gateway lookup/auth backend failure | transient; client backs off with jitter |
| Conflicts spike | many editors on same project | expected; check `bahn_conflicts_total`; UI offers rebase |
| Boot error "Unsafe production configuration" | missing/weak `JWT_SECRET`, `DATABASE_URL`, IdP | fix env |

## Recovering a lost realtime layer

Realtime is derived state. After any Redis/relay/bus outage: restart, done. Clients reconnect, call `projects.sync` with
their held versions, and receive missed events or snapshots. No data repair needed. Verify with
`bahn_outbox_backlog → 0`.

## Rollback

Server mode is opt-in per build/deploy; the static deployment is untouched. Migration 0004 is additive
(new tables/columns/indexes/triggers). To roll back the app, redeploy the previous image; leave the tables.

## Migrations

`node dist/migrate.js` (also `pnpm db:migrate:prod`) applies `drizzle/*.sql` with drizzle's own migrator (no
drizzle-kit in the image), under a named lock, idempotently — verified on a fresh MariaDB (7 migrations, append-only
audit triggers and FULLTEXT index present, second run a no-op). 0004 event pipeline · 0005 change feed · 0006
notifications. The staging compose file runs it as a one-shot `migrate` service before the app.

## Deployment gate (machine-readable)

`pnpm gate` → `artifacts/deployment-gate.json` (`readyToDeploy` true only if **every** check passes): typecheck, lint,
unit, DB+Redis integration (0 skipped), security suites, client build, server-mode build, bundle inspection, container
simulation (prod-only dependency install boots the artifact), existing Playwright suite, two-browser server-mode proof,
fault-injection convergence, **staging smoke** (needs `STAGING_URL` https + `SMOKE_TOKEN`) and **load certification**
(needs `artifacts/load-certification.json` from a separate generator host). The last two are `not-run` unless a real
deployed environment exists — the gate then reports `readyToDeploy: false`. That is the intended state today.

## Testing commands (every status claim in `docs/` maps to one)

```
pnpm check && pnpm lint && pnpm test
TEST_DATABASE_URL=mysql://user:pass@127.0.0.1:3306 TEST_REDIS_URL=redis://127.0.0.1:6379 pnpm test   # real-DB/Redis suites
scripts/e2e/build-server-mode.sh && pnpm exec tsx scripts/e2e/server-mode.e2e.ts                      # two real browsers, two instances, Redis
pnpm exec tsx scripts/load/chaos.ts --clients 300                                                     # fault injection
node scripts/load/unique-users.mjs --users 10000 --burst-seconds 60 --spawn                          # unique-identity burst
scripts/gate/container-sim.sh dist-e2e   |   pnpm exec tsx scripts/gate/local-smoke.ts                # artifact / smoke script self-checks
pnpm gate                                                                                             # the whole gate
```
DB-backed suites **skip** (visibly) without `TEST_DATABASE_URL`. **CI note:** `.github/workflows/ci.yml` provides MySQL 8.4 +
Redis to the unit job, but the new suites have only been run against MariaDB 10.11 locally; CI has not yet executed
them, and the browser/chaos/gate suites are not in CI.

## Known gaps

Not on the event pipeline: `reviews.create`, checklists, bookings, BVB-EEA, PSV-ITK, Excel import. The Dashboard,
BVB-EEA, PSV-ITK, Projektanmeldung, Audit and the Gewerk workspaces still read the static snapshot in server mode (they are
labelled "lokaler Datenbestand, nicht live" and their writes are disabled). Header search / Ask Bahn have no server
search yet in server mode. The map shows the loaded rows only (no viewport/cluster queries). Handlungsbedarf/tone chips
need the whole dataset and are not offered in server mode. Not built: read-model tables for dashboard aggregates,
`@tanstack/react-virtual` tables, offline queue/IndexedDB, web-vitals/Sentry wiring,
notification email/push, mention/system/deadline-reminder producers, presence rate limiting, a Postgres migration (no
evidence it is needed). Staging and load certification: see docs/staging.md and docs/load-testing.md.
