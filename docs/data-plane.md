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

* `projects.list`: **cursor** (keyset) pagination; `limit ≤ 100` (validation, not clamping); sort from a closed enum
  (`updatedAt`, `id` index-backed; `projektnummer`, `station`, `projektstand`, `projektleiter`, `bahnhofsmanagement`
  via `COALESCE(col,'')` keyset); filters incl. review-based `department`/`reviewStatus`/`pruefer` (`EXISTS` on
  `department_reviews`); **column projection** (9 summary columns; no `fullRowData`); optional `expand:
  ["details","reviews"]` (the Projekte table asks for both; reviews are one `IN (page ids)` query); `total` only when
  `includeTotal`; the response carries `feedHead` (see Collection recovery). `showAll` no longer exists.
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


## Department reviews are part of the Project aggregate

`projects.updateReview` (`ProjectService.updateReview`): same transaction shape as a field edit — idempotency claim,
project row lock, `canApproveReview` (department membership **and** workspace), review row lock, **project version
check**, review UPDATE, project version +1, audit rows keyed `review.<Gewerk>.<field>`, one `project.updated` outbox
event whose `changes` use the same keys. Consequences: one version sequence, one stream, one conflict model, one
recovery path — **no second sync system**. The unversioned, unevented `reviews.update` was **removed**. Concurrency is
project-wide (a review edit conflicts with a field edit on the same project), which is coarser than necessary and
safe. `reviews.create`, BVB-EEA, PSV-ITK, checklists and bookings are **not** migrated yet.

## Collection recovery (durable change feed)

`domain_events.feedSeq` is assigned by the single outbox relay **in publication order** (gapless, commit-ordered — a
plain auto-increment `id` is not: a slow transaction can commit after a later id). The relay persists the numbering
before publishing, so a retry re-publishes with the same numbers and never reorders across failures.

* `projects.list` returns `feedHead` **read before** the page → the client's cursor precedes its snapshot.
* The SSE `hello` frame carries the current `headSeq` (read AFTER subscribing, coalesced by `FreshRead` so a connect burst
  shares queries but no caller receives a value older than its own subscription).
* `projects.changes({after, upTo})` returns visible events in feed order, filtered **per recipient**
  (`eventForPrincipal`), plus the highest scanned `cursor` and `hasMore`. Scan budget: 5 × 500 events per call.
* Client (`ProjectSyncEngine.catchUp/resync`): applies updates to known projects by version; **creations and move-ins
  invalidate the list queries** (targeted refetch, no fabricated rows); deletions and move-outs remove rows. The cursor
  advances only from authoritative responses, never from live events. A 30 s reconcile covers silent transport loss.
* `projects.sync({known})` (per-aggregate versions) remains the gap-repair tool for projects a client holds.

Proven in real browsers (scripts/e2e) and by `e2e.db.test.ts` ("RECOVERY"): while B is offline A creates, deletes,
moves out, moves in and updates → B converges to the authoritative visible collection.

## Notifications

`domain event → policy → user notification → realtime → notification center`, inside the mutation transaction:
`planNotification` (pure; kinds `critical|workflow|assignment|deadline`, plus `mention|system` reserved) decides
whether an event notifies; recipients are the project's **watchers** (`project_watchers`, follow toggle in the detail
dialog) minus the actor; each recipient gets one `notifications` row **and** one `notification.created` outbox event
(delivered on `notifications:<userId>` and recoverable from the feed, both filtered to that recipient — and only while
they can still see the project's workspace). Reads (`notifications.list/unreadCount/markRead`) re-check the caller's
current workspace access. The Header bell in server mode reads this source, not the audit log. No email/push channels
yet; `mention`, `deadline` reminders and `system` notifications have no producers yet.


## One domain path for every aggregate (after the unification)

`authorize → transaction → idempotency claim → optimistic version → audit rows → outbox event → (relay) realtime → React Query`

| Aggregate | Service | Events | Notes |
|---|---|---|---|
| Project (+ department reviews: create/update) | `ProjectService` | `project.*` | BVB-EEA and PSV-ITK are Gewerk **views** of this aggregate (department filter), not separate tables |
| Checklist (Projektanmeldung) | `ChecklistService` | `checklist.*` | submit creates the project + 14 reviews and can book a slot in the SAME transaction |
| Booking (calendar slot) | `BookingService` | `booking.updated` | double-booking impossible (row lock + version + status); details redacted per workspace |

Removed: the standalone `bvbEea.*`, `psvItk.*` and `reviews.create` endpoints (any logged-in user could write any row;
no role, workspace, version, event) and every runtime write in `server/db.ts` except user provisioning. The legacy tables
are deprecated in `drizzle/schema.ts`.

## Read models (updated in the write transaction; rebuildable; verified against a recompute in tests)

`rm_project_stats`, `rm_review_stats`, `rm_pruefer_load` (dashboard, per workspace), `project_geo` (map: station →
coordinates, resolved once per write by `shared/stationGeo.ts`), `notification_unread`. Dashboard / department KPIs read a
handful of rows for the caller's workspaces only; the map query (`map.query`, `map.station`) is a bounding-box range scan
(clusters below zoom 10 or above 1,500 stations) with the list's exact authorization and filters.
`rebuildReadModels` / `rebuildGeo` repair drift; `verifyReadModels` is the test oracle.

## Fixed on the way

* `projektnummer` search: InnoDB tokenizes "G.011570020" to `011570020` ("G" is below the minimum token size), so
  `+G.011570020*` matched nothing on MySQL 8.4. The query is now tokenized like the index.

## The mutation plane is enforced, not described

`server/mutationPlane.test.ts` fails the build when:

* a server file outside the classified writer list (`WRITERS`) contains an INSERT/UPDATE/DELETE or an ORM write — routers and
  domain services may never write tables directly (they go through `ProjectTx`);
* a tRPC mutation procedure exists that is not classified (domain / audit-only / personal state / dev-only);
* an HTTP write route other than the ephemeral realtime scope/presence endpoints appears;
* `shared/` or `client/` imports the database layer.

Removed in this pass because they were dead and unscoped or bypassed the plane: the Excel import route, the Manus/Forge
scaffolding (`llm`, image/voice/storage proxies, `notifyOwner`, Google-Maps proxy), the unmounted Express OData router, and
unscoped read helpers in `server/db.ts`.

Known, documented referential gap: deleting a project does not unlink `schedule_slots.projectId` /
`project_checklists.projectId` (the link then resolves to NotFound; it is read-safe, not a write bypass).

## Dashboard: where every figure comes from

All figures are computed by the server for the caller's **authorized workspaces only** (`workspaceRestriction`; a restricted
principal's cache key is its normalized workspace set, never shared with another scope). Two classes:

* **Incremental** — counters maintained inside the write transaction (`rm_project_stats`, `rm_review_stats`, `rm_pruefer_load`):
  exact at commit, read as tiny indexed lookups (`dashboard.stats`, `dashboard.department`; 5 s burst cache per scope).
* **Date-dependent** — cannot be a stored counter because "today" moves (overdue, aging, upcoming, delayed projects) or
  needs per-project distinct counts: derived by `shared/portfolio-view.ts` from ONE lean authorized row scan, cached per scope
  with single flight (30 s TTL; `dashboard.portfolio`, `dashboard.reel`, and every drill-down share that cache). Not a scan per
  request. Update latency ≤ 30 s plus the client's 60 s refetch; on the instance that handled a write nothing is invalidated
  early (documented trade-off).

| Figure | Source | Scope | Cache | Click-through (server-evaluated `drill`) |
|---|---|---|---|---|
| Gesamtprojekte / Fachprüfungen | portfolio (`metrics`, `totalReviews`) | workspaces | 30 s | `/projects` |
| Offene Prüfungen, Abgeschlossen, Kritisch | portfolio `metrics` (`shared/project-metrics`) | workspaces | 30 s | `/projects` |
| Handlungsbedarf (overdue / blocked / Nachforderung / unassigned) | portfolio `bedarf` (rows + distinct projects) | workspaces | 30 s | `?bedarf=<key>` → `drill.bedarf`, same predicate + same pinned day |
| Status-Verteilung and per-Gewerk donuts | portfolio `tones` / `gewerke` | workspaces | 30 s | `?tone=<band>[&gewerk=<G>]` → `drill.{tone,department}` (department inside the predicate); EEA/ITK donuts open `/bvb-eea` / `/psv-itk` with the same drill |
| Gewerk standings / risk, aging, concentration, data quality | portfolio | workspaces | 30 s | Gewerk → its page; reviewer → search |
| Anstehende Prüftermine | portfolio `upcoming` (12 nearest open dated rows) | workspaces | 30 s | project dialog (live detail) |
| Regionale Verteilung | portfolio `regions` | workspaces | 30 s | `/projects?region=…` |
| Fachspezialisten workload | portfolio `workload` (timeline capped to 8) | workspaces | 30 s | project |
| Team-Aktivität | `audit.page` (8 newest, 7 days; auditors only) | workspaces | 15 s / 60 s refetch | `/audit` |
| Map | `map.query` (bbox/zoom, honours the drill) | workspaces | 30 s | station → `drill.ids` |

A drill is resolved server-side to an id set over the caller's authorized rows and intersected with the list's own workspace
condition; a client-supplied id outside the caller's scope matches nothing (`DRILL-DOWN` e2e step). Counts and lists are the
same computation, so a badge and the list it opens cannot disagree (`portfolioModel.db.test.ts`).
