# Performance budgets and measurements

Budgets are limits a change must not exceed; each has the measurement it is checked against. Measured on ONE host
(Chromium headless 1440×900, server + MySQL 8.4 + Redis on the same 4 vCPU box, real 1,298-row dataset shape) with
`scripts/perf/browser-perf.ts` — they prove DOM/JS work, not a deployed network path. They are NOT field data.

## Browser (Projekte page, server mode) — `docs/measurements/browser-perf-{before,after}.json`

| Metric | Budget | Before (full DOM) | After (virtualized) |
|---|---|---|---|
| DOM nodes after load | ≤ 3,000 | 27,335 | **1,469** |
| Table rows in DOM | ≤ 60 | 500 (900 after scrolling) | **21** (29 after scrolling) |
| JS heap after load / after scrolling | ≤ 50 MB / ≤ 80 MB | 76 / 149 MB | **10 / 31 MB** |
| INP (98th pct of scripted interactions) | ≤ 200 ms | 1,040 ms | **72 ms** |
| Long tasks during the session | ≤ 10 | 125 | **5** |
| Scroll frame time p95 (software-rendered) | ≤ 60 ms | 483 ms | **50 ms** |
| LCP | ≤ 2,500 ms | 336 ms | 364 ms |
| CLS | ≤ 0.1 | 0.206 (fails) | **0.078** |
| First data row rendered | ≤ 1,500 ms | 717 ms | 714 ms |
| Initial transferred (uncompressed, 1 page) | ≤ 1.5 MB | 2.6 MB (5 pages) | **1.3 MB** (1 page) |
| Map: time to first marker | ≤ 1,500 ms | 2,722 ms | **439 ms** |

Initial JS: entry + preloaded vendor chunks **651 KB raw / 197 KB gzip** (budget ≤ 250 KB gzip); 31 route/vendor chunks.

## API payload (100 rows)

| Projection | raw | gzip |
|---|---|---|
| before: `expand=[reviews,details]` + COUNT | 241 KB | 15.3 KB |
| after: `expand=[table,reviewSummary]`, no COUNT | **165 KB** | **8.9 KB** |
| summary only | 24.5 KB | 3.1 KB |

Exact totals come from `projects.count` (cached per authorization scope + filter set, 15 s), never from a page.

## Realtime fanout — `docs/measurements/fanout-topology.json`

1,000 clients with the global Projects page open, 150 plain edits (`scripts/load/fanout-topology.mjs`):

| Topology | deliveries | per event | bytes | per relevant recipient |
|---|---|---|---|---|
| before: 9 workspace channels per client | 137,000 | 913 | ~69 MB | 29.0 |
| **after: `collection:<scope>` + `project:<id>` of the rows on screen** | **4,718** | **31** | **2.3 MB** | **1.0** |

−96.6 % deliveries and bytes; delivery equals the relevant recipients exactly. Membership changes (create/delete/move)
still reach every list because they ride the compact collection channel.

## Server-side budgets (carried from docs/scaling.md; NOT re-certified here)

API p95 read ≤ 250 ms, write ≤ 400 ms, error ≤ 0.1 %; realtime p95 ≤ 500 ms. 10k is **not** claimed: the external,
production-shaped run has not happened (docs/staging.md).
