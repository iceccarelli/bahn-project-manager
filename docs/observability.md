# Observability

## Correlation ids

* `traceId`: from W3C `traceparent`, else `x-trace-id`/`x-request-id` (charset/length-bounded), else random. Echoed as
  `x-trace-id` response header, stored on every domain event and audit row, carried through the relay to the browser.
* `requestId`: per HTTP request. `mutationId`: client-generated per user action (also the idempotency key root).
  `eventId`: per domain event. The client sends `x-trace-id` on every tRPC call.

## Metrics — `GET /api/metrics` (Prometheus text; requires `Authorization: Bearer $METRICS_TOKEN`; off if unset)

| Metric | Answers |
|---|---|
| `bahn_http_request_ms{path,type}` | API p50/p95/p99 (histogram) |
| `bahn_db_transaction_ms` | write-transaction latency |
| `bahn_mutations_total{outcome}` / `bahn_conflicts_total` | conflict rate |
| `bahn_db_pool_connections_in_use`, `bahn_db_pool_queued_requests` | pool utilization (sampled 5 s) |
| `bahn_requests_shed_total` | overload rejections (429) |
| `bahn_cache_hits_total{name,kind}` / `_misses_total` | cache hit ratio |
| `bahn_realtime_connections`, `_channel_subscriptions`, `_connects_total` | connections / reconnects |
| `bahn_realtime_event_age_ms` | **event latency** at delivery (now − envelope timestamp) |
| `bahn_realtime_events_delivered_total` / `_dropped_total` | fan-out / slow-consumer drops |
| `bahn_outbox_backlog`, `_published_total`, `_publish_failures_total`, `_dead_letters_total` | event backlog |
| `bahn_realtime_gateway_errors_total`, `bahn_unhandled_rejections_total` | robustness |
| `bahn_auth_verify_ms`, `bahn_identity_resolve_ms` | token verification / identity resolution latency (cache hits included) |
| `bahn_user_provision_written_total`, `_failures_total` | write-behind user provisioning |
| `bahn_outbox_dead_letters_total` | unpublishable rows quarantined (alert on > 0) |
| `bahn_redis_up` | 1/0: shared Redis reachable (readiness reports `degraded`, instance stays in rotation) |

**Alert rules**: `deploy/observability/alerts.yml` (Prometheus format; 12 rules covering instance liveness, Redis, outbox
backlog / dead letters, realtime latency and drops, load shedding, pool saturation, API latency, conflict rate, unhandled
rejections, OIDC latency). `pnpm check:consistency` fails if a rule names a metric the server does not export. The
thresholds are starting points to tune from the staging load run; no monitoring stack runs in this repository, so they
have **not** been exercised against a live Prometheus.

**Probes**: `/api/health` (liveness), `/api/ready` — 503 when MySQL is unreachable or the instance is draining; 200 with
`status: degraded, redis: down` when only Redis is lost.

## Not done

Sentry is a dependency but **not initialised** anywhere in the repo (checked); client-side `traceId` propagation into
Sentry, web-vitals (LCP/INP/CLS) collection, offline-queue depth and long-task metrics are **NOT DONE**. Metrics are
in-process (per instance); scrape every instance and aggregate. Structured logs use `console`; pino is installed but
unused.
