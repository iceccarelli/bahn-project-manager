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

## Testing commands (every status claim in `docs/` maps to one)

```
pnpm check && pnpm lint && pnpm test                                    # 305 pre-existing + new unit tests
TEST_DATABASE_URL=mysql://user:pass@127.0.0.1:3306 \
TEST_REDIS_URL=redis://127.0.0.1:6379 pnpm test                         # + real-DB / real-Redis / e2e realtime suites
node scripts/load/explain.mjs …   node scripts/load/realtime-fanout.mjs …   node scripts/load/api-bench.mjs …
pnpm build:client && PLAYWRIGHT_CHROMIUM_PATH=… pnpm e2e                # existing browser suite (local mode)
```
DB-backed suites **skip** (visibly) without `TEST_DATABASE_URL`; CI provides MySQL 8.4 + Redis (see `.github/workflows/ci.yml`).

## Known gaps

Not on the event pipeline: department reviews, checklists, bookings, BVB-EEA, PSV-ITK, Excel import (direct writes; audited
only for reviews). Not built: server presence, notification stream (Header bell still reads audit), viewport/cluster map
queries, read-model tables for dashboard aggregates, `@tanstack/react-virtual` tables, offline queue/IndexedDB,
MSAL browser login, server-side data-quality normalization of the *existing* rows (`data:normalize` script unchanged),
Postgres migration (not needed by evidence so far), web-vitals/Sentry wiring, WCAG/responsive test additions for the new
components, client-side conflict/connection UI is unit-tested only as pure logic (no component/E2E test in a browser).
