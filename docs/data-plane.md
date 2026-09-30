# Data plane (Project vertical slice)

## Write path (`ProjectService.update`)

One database transaction, in this order:

1. **Claim the idempotency key** (`INSERT IGNORE` into `idempotency_keys`). Same key + same request hash → return the
   stored response (`replayed: true`, no side effects). Same key + different body → `UNPROCESSABLE_CONTENT`.
2. **Lock the row** (`SELECT … FOR UPDATE`). Missing *or invisible* → `NOT_FOUND` (no existence oracle / IDOR).
3. **Authorize**: `canEditProject` on the current workspace, and again on the target workspace if it changes.
4. **Normalize** (`normalizePatch`, the single canonicalization layer): whitespace, placeholder tokens (`???`,
   `Bitte auswählen`, …), canonical Bahnhofsmanagement (unknown → `VALIDATION`), dates → `yyyy-mm-dd`/ISO.
5. **Diff** against the locked row; a no-op writes nothing (no version bump, no event, no audit noise).
6. **Version check**: `syncVersion !== expectedVersion` → `ConflictError` (structured, see below).
7. `UPDATE … WHERE id=? AND syncVersion=?` sets `syncVersion = expected+1`; zero rows → conflict (defence in depth).
8. **Audit**: one `audit_log` row per changed field, carrying `eventId`, `aggregateVersion`, `traceId`.
9. **Outbox**: one `domain_events` row with the full wire envelope.
10. Store the idempotent response; **COMMIT**. Only then is the relay nudged.

A failure anywhere rolls back everything, including the idempotency claim (asserted by test: forcing the outbox insert
to fail leaves project, audit and key untouched). Deadlock victims are retried (≤3) as whole transactions.

`audit_log` is append-only **in the database**: `BEFORE UPDATE/DELETE` triggers raise (`drizzle/0004`).

## Conflict contract

`tRPC CONFLICT (409)`; the payload is on `error.data.conflict` (`ConflictInfo`):
`expectedVersion, currentVersion, serverValues, localValues, conflictingFields, changedSince, lastChange{actor,at},
disjoint, current`. The server **never merges silently**. `disjoint: true` (none of my fields were touched) lets the UI
offer "apply my change on top" (`useEditProject().rebase`); an overlap makes the overwrite explicit
(`ConflictDialog`).

## Read path

* `projects.list`: **cursor** (keyset) pagination on `(updatedAt,id)` or `id`; `limit ≤ 100` (validation, not
  clamping); sort/direction from closed enums; **column projection** (9 summary columns; no `fullRowData`, no
  reviews); `total` only when `includeTotal`. `showAll` no longer exists on the API.
* `projects.get`: detail incl. reviews (the only place reviews are attached).
* Search: `MATCH … AGAINST (+term*)` in BOOLEAN MODE on a FULLTEXT index; input stripped of operators; tokens < 3
  chars fall back to an index-usable **prefix** `LIKE 'x%'`. Never `%term%`.
* OData facade compiles `$filter` to SQL, caps `$top` at 100 and `$skip` at 10 000 (station is a **prefix** match now).
* `projects.shellSummary` (`{projectCount,lastUpdatedAt}`, 5 s cache) replaces `useAllProjects()` in the shell.
* `dashboard.stats` / `filters.options`: single-flight, stale-while-revalidate read models (30 s / 60 s).

## Indexes — kept or dropped on evidence

`node scripts/load/explain.mjs <url>` on 200 000 projects / 600 020 events (MariaDB 10.11, 4 vCPU shared):

| Query | With | Without |
|---|---|---|
| list page 1 `ORDER BY updatedAt,id` | **0.85 ms** (`projects_updatedAt_id_idx`) | 47.3 ms (filesort of 197k rows) |
| keyset page mid-table | **0.84 ms** | 75.1 ms |
| `OFFSET 100000` (old style) | — | 234.6 ms |
| region filter + order | **1.50 ms** | 43.0 ms |
| search, selective 2-term | **29.6 ms** FULLTEXT | 298 ms `%term%` full scan (rare needle) |
| search, one *very common* term | 146 ms (matches ~all rows; inherent) | — |
| outbox scan, backlog 100k | **0.8 ms** `(processedAt,id)` | 26 ms with `(processedAt,createdAt,id)`; **210 ms** with PK scan |
| `COUNT(*)+MAX(updatedAt)` | 23 ms (hence the 5 s cache) | — |

Indexes from the brief **not** added because no measured query needed them: `projects(bahnhofsmanagement,updatedAt,id)`,
`(projektleiter,updatedAt,id)`, `(projektstand,updatedAt,id)` — region/leader filters already run in 1.5–6.7 ms via
`projects_updatedAt_id_idx`/`region_stand_idx`. `audit_log(entityType,entityId,createdAt)` was not measured this stage.
Re-run `explain.mjs` on production-shaped data before adding any.

## Pool

`getPool()` (request traffic, `DB_POOL_SIZE` default 10, `DB_QUEUE_LIMIT` 200) and `getRelayPool()` (outbox relay,
`RELAY_POOL_SIZE` 3). Separate on purpose: sharing them stalled realtime delivery under load (found, fixed, see
runbook). Pool exhaustion answers **429** (`bahn_requests_shed_total`), not 500.
