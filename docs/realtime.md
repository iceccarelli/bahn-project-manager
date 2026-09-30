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

`project:<id>`, `workspace:<slug>` (Bahnhofsmanagement), `department:<CODE>`, `user:<id>`, `notifications:<id>`
(only project/workspace channels carry events in this stage). `scopesForEvent` = the project channel + the current
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

## Not built yet

Presence (online/away/idle/editing/viewing on Redis TTL), `department:`/`user:`/`notifications:` event producers,
reviews/checklists/bookings events, viewport-aware map channels. The channel model and gateway already accept them.
