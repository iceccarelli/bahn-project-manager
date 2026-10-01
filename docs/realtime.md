# Realtime

## Contract (`shared/domain-events.ts`, versioned: `schemaVersion: 1`)

```ts
{ schemaVersion, eventId (uuid), eventType: 'project.created|updated|deleted', aggregateType: 'project',
  aggregateId, aggregateVersion, actorId, actorName?, timestamp, traceId,
  changes: { field: { from, to } }, context?: { workspace, workspaceBefore } }
```

`aggregateVersion` is the row's `syncVersion` at commit; `UNIQUE(aggregateType,aggregateId,aggregateVersion)` makes
per-aggregate versions **gapless and unique**, so the client can tell "duplicate", "stale", "next" and "gap" apart
(`decideEvent`). Events are persisted in `domain_events` (outbox **and** replay log).

## Ports (domain never sees the transport)

```ts
interface RealtimePublisher  { publish(event: DomainEvent): Promise<void> }
interface RealtimeSubscriber { subscribe(scope: { channels; signal?; maxQueue? }): AsyncIterable<DomainEvent | OVERFLOW> }
```

Adapters: `InProcessBus` (single instance), `RedisBus` (many instances). A vendor adapter needs only these two methods.

## Channels — nobody gets "everything"

`project:<id>`, `workspace:<slug>` (Bahnhofsmanagement), `department:<CODE>`, `user:<id>`, `notifications:<id>`.
Project/workspace channels carry project events; `notifications:<self>` carries notifications; any project/workspace/
department scope can carry presence snapshots. `scopesForEvent` = the project channel + the current
workspace (+ the previous workspace on a move). The gateway authorizes **every requested scope** (`canSubscribe`, plus
a project→workspace check for workspace-restricted principals); denied scopes are reported in `hello` and never
subscribed; wildcards/malformed scopes are 400.

## Delivery pipeline

`COMMIT` → `OutboxRelay` (one leader cluster-wide via `GET_LOCK`, ordered by `id`, batch 200, nudged post-commit and
polling every 250 ms) → `publisher.publish` → `LocalHub` (bounded per-subscriber queue, default 256) → SSE frame.
At-least-once; `eventId` de-duplicates at hub and client. A permanently invalid row is dead-lettered
(`failedAt`, `bahn_outbox_dead_letters_total`) instead of blocking the queue; a transient bus failure retries in order
with backoff.

A slow consumer never blocks the publisher: on queue overflow it gets a `resync` frame and is disconnected
(`bahn_realtime_events_dropped_total`); it reconnects and recovers state.

## Client (`client/src/realtime/`)

(Server-mode UI: `serverProjects.tsx` — infinite cursor pages, server filters/search/sort, `ServerPager`; `RealtimeProvider` — engine, connection, presence/notification stores, editor with conflict dialog; `notifications.tsx`, `presence.tsx`.)

* `ProjectSyncEngine`: applies only `version === known+1`; drops duplicates; on a gap **parks** the event, asks
  `projects.sync` for the missed events (or a snapshot if >25 missed), then replays parked events and continues from the
  right cursor. A failed recovery does not spin; `resync()` after reconnect repairs it.
* Optimistic edits are an **overlay** on server state (`optimistic → confirm | rollback`), so a remote change to another
  field never clobbers a pending local one; own-event echo (before or after the HTTP response) is a no-op.
* `RealtimeConnection`: `connecting → connected ⇄ degraded`, `reconnecting → resynchronizing → connected`, `offline`.
  Heartbeat watchdog (2.5× interval → degraded), full-jitter exponential backoff, the UI never shows "Live" until
  resync finished ("Wiederverbunden · 3 Änderungen synchronisiert"). `fetch` streaming (not `EventSource`) so a bearer
  token can be sent.
* Bridge to React Query: engine changes `setQueryData` the project and patch it into every cached list page.
  No collection refetch per change.

## Transport choice — measured, not assumed

SSE on one Node process: **10,000 connections = 552 MB server RSS**, connect ramp 6–7 s, 100 % delivery, p95 394–446 ms
(generator on the same host). See [load-testing.md](load-testing.md). Gateway limits: `RT_MAX_CONNECTIONS`,
`RT_MAX_PER_PRINCIPAL` (default 20), 15 min max connection age (forces token/authorization re-evaluation), 15 s heartbeat.

## Recipient-safe events (workspace transitions)

Channels only *route*. A project channel is authorized when it is opened — before the project may move — so **every**
delivery path (live stream, reconnect feed, aggregate sync) passes each event through `eventForPrincipal(principal, event)`:

| Move A → B, recipient can see | Receives |
|---|---|
| B (and A) | the full event |
| B only | the full event with **`from` values stripped** and the old workspace replaced by `"*"` (no history leaks) |
| A only | `project.removed`: **no field values, no new workspace**, actor redacted — the row disappears |
| neither | nothing |

Regression tests: `e2e.db.test.ts` "SECURITY: Frankfurt → Kassel move…" (stream, DOM in the browser proof, feed, sync, API)
and "moved IN from a workspace the recipient cannot see". Notifications reach exactly their recipient; presence for a
project scope requires visibility of that project's workspace.

## Presence (ephemeral)

States `online | away | idle | viewing | editing`; per-user aggregation of tabs (most active wins). Storage:
**Redis** (HASH + ZSET with per-member TTL 45 s; in-memory store without Redis) — **never SQL** (asserted in the browser
proof: no presence table exists). The client derives its state from visibility, input activity (idle after 60 s) and a
focused edit control, and heartbeats every 15 s and on change (`POST /api/realtime/presence`); other clients receive
`presence.changed` snapshots over the same stream (same authorization/fan-out code; not stored, not in the feed). A
sweeper (one per cluster via `SET NX`) expires silent members and publishes the new snapshot. Because presence events are
not replayable, every (re)connect reloads the current snapshot (`GET /api/realtime/presence`) — found necessary by the
browser proof. Scopes: project (viewers/editors), workspace (count in the page bar), user (a user's state is their row in
those lists). Not done: presence rate limiting per principal; departments' presence UI.

## Notifications delivery

See docs/data-plane.md. `notification.created` events share the envelope, outbox and feed with project events.
