# Architecture

> Status labels used throughout `docs/`: **MEASURED** (a runnable gate produced the number, command given),
> **TARGET** (an engineering goal, not yet demonstrated), **NOT DONE** (known gap). Nothing here is a claim
> that the system "is 10k capable"; see [load-testing.md](load-testing.md) for what has and has not been shown.

## The one execution path

```
Identity ─▶ Authorization ─▶ API ─▶ Domain logic ─▶ DB transaction ─▶ Audit ─▶ Outbox
   │            │              │          │                │             │        │
 oidc.ts     permissions.ts  routers.ts  projectService.ts mysqlProjectStore.ts   │
 identity.ts (pure fns)      (tRPC)      (ports only)      (one tx)              ▼
                                                                          OutboxRelay ─▶ Event bus ─▶ Realtime gateway ─▶ Client engine ─▶ Query cache ─▶ UI
                                                                          (leader lock)  (in-proc |    (SSE, per-scope    (dedupe, gaps,     (React Query)
                                                                                         Redis)        authorization)      optimistic)
Observability (traceId / metrics) spans the whole path.
```

| Layer | Files | Depends on |
|---|---|---|
| Identity | `server/_core/oidc.ts`, `identity.ts` | jose, users table |
| Authorization | `server/domain/permissions.ts` | nothing (pure) |
| API | `server/routers.ts`, `server/_core/trpc.ts` | ports, services |
| Domain | `server/domain/projectService.ts`, `ports.ts`, `errors.ts` | **ports only** (no MySQL, Redis, HTTP) |
| Persistence | `server/infra/mysqlProjectStore.ts`, `mysqlOutbox.ts` | drizzle / mysql2 |
| Realtime | `server/realtime/{hub,redisBus,relay,gateway}.ts` | ports |
| Wire contracts | `shared/domain-events.ts`, `project-contract.ts`, `sse.ts` | zod |
| Client | `client/src/realtime/*` | shared contracts |
| Composition root | `server/_core/services.ts` | everything; the only place that picks adapters |

## Source of truth

The database. `localStorage`, React Query, the in-memory engine, Redis pub/sub, search indexes and the dashboard
cache are **derived** and can be discarded without data loss. Redis never holds anything that cannot be rebuilt.

## Two artifacts, never mixed

* **Production** (`pnpm build:production`, the `Dockerfile`): the server-authoritative system. Every page (Projects, Dashboard,
  Audit, Search, Map, Bookings, Reviews, Checklists) reads and writes through the server; the browser holds only caches.
  The artifact contains no dataset (`data.json`/`schedule.json` are removed at build and answer 404) and no demo notice.
* **Demo** (`pnpm build:demo`, Vercel): the browser-local app over a synthetic dataset, for previews. Its data lives in the
  visitor's browser. It shares the UI and the pure derivations in `shared/`, but nothing of the server's authority.

`VITE_SERVER_MODE` is set only by those two scripts; a bare `vite build` is refused, and CI asserts the stamped
`build-info.json` of whatever is shipped (`scripts/assert-build-target.mjs`, the container gate).

## Decisions

| Decision | Choice | Why (evidence) |
|---|---|---|
| Primary store | **Keep MySQL** (verified on MariaDB 10.11 here; CI uses MySQL 8.4) | Existing schema/ops/Docker path; no feature the slice needed was missing. Fulltext (`MATCH…AGAINST`) covered search: 29 ms vs 298 ms for a full-scan `%term%` on 200k rows. Revisit Postgres only if trigram/typo-tolerant search becomes a requirement. |
| Realtime transport | **SSE over HTTP**, behind `RealtimePublisher/Subscriber` ports | Traffic is server→client; writes are ordinary authenticated calls. No sticky sessions, proxy-friendly, native reconnect. 10,000 connections on one Node process = 552 MB RSS (measured). |
| Fan-out between instances | **Redis pub/sub** (required in production; the in-process bus exists for dev and for an explicit `ALLOW_SINGLE_INSTANCE=1`) | Transport only; loss is repaired by version-gap recovery. Verified across 2 instances. |
| Ordering | Per-aggregate `syncVersion`, UNIQUE in `domain_events` | Makes gaps detectable with certainty. |
| Publication | Transactional outbox + single leader relay (`GET_LOCK`) | Event exists iff the tx committed; crash-safe; at-least-once, de-duplicated by `eventId`. |
| Provider lock-in | None in domain code | A vendor (Ably/Pusher/Vercel WS) implements `RealtimePublisher`; the gateway can be swapped. |

## What is deliberately NOT here yet

See "Known gaps" in [runbook.md](runbook.md#known-gaps). Staging (real OIDC, HTTPS, separate hosts) and load certification
have **not** been done — [staging.md](staging.md).
