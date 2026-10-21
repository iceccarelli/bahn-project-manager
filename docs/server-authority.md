# Server authority — dependency map of the production data plane

Scope: which workflow reads and writes through the server, where it is authorized, and what holds it together. Written from the
code and the CI browser proofs at `main` `d0e394e`; every row names its evidence. **This is a map of what exists, not a
certification.** What this audit did **not** trace is listed at the end; do not read an empty cell as "fine".

Two build targets share the pages. `SERVER_MODE` is a build-time constant (`client/src/realtime/serverApi.ts`): the production
bundle (`VITE_SERVER_MODE=1`) has no browser-local data plane; the demo bundle keeps it, labelled (`LegacyPlaneNotice`).
Everything below is the **production** path.

## Pages → data source in server mode

| Page / feature | Server mode renders | Evidence |
|---|---|---|
| Projekte (`/projects`) | server pages (`projects.list`, keyset) + live events | `useProjectsPage`, `useServerProjects`; browser proofs 1–5, DRAWER, TOPOLOGY |
| Dashboard | server read models (`dashboard.*`, per-scope cache), drill-down is server-evaluated | `usePortfolio`; steps "DASHBOARD + AUDIT", "DRILL-DOWN" |
| Audit | `audit.page` (workspace-scoped, one keyset page at a time); no unscoped `audit.list` exists | `useAuditFeed` selects the server feed when `SERVER_MODE`; step "DASHBOARD + AUDIT" |
| PSV-ITK | `ServerDepartmentView department="ITK"` — the Project aggregate filtered to one Gewerk | `pages/PsvItk.tsx`; step "PSV-ITK (server)" |
| BVB-EEA | `ServerDepartmentView department="EEA"` (same component) | `pages/BvbEea.tsx`; step "BVB-EEA (server)": own route, heading, EEA-only controls, scoped KPIs, non-EEA editor refused (403), EEA editor's edit reaches B live. Run locally on MariaDB 10.11 (29 of 30 steps pass; the 30th is the Docker-only Redis-outage step) and fails when the page is pointed at ITK (mutation check). **CI, MySQL 8.4 + Redis 7:** `e2e-server` (`server-mode.e2e.ts` step) green on the PR head ([run 176](https://github.com/iceccarelli/bahn-project-manager/actions/runs/38919301398)) and on `main` `967569f` ([run 177](https://github.com/iceccarelli/bahn-project-manager/actions/runs/39577068858)) |
| Projektanmeldung / Abnahme | `checklists.save/submit`, `bookings.*` | `useChecklistDraft`, `useSchedule` have server branches; step "PROJEKTANMELDUNG → GEWERK" |
| Einstellungen (Gewerk subscriptions) | `notifications.subscriptions/setSubscription` | step "PROJEKTANMELDUNG → GEWERK" (settings switch) |
| Prüfberichte / ITK tabs | `pruefberichte.*` | steps "ITK PRÜFBERICHTE", "ÜBERSICHTSLISTE + PRÜFBERICHT-VERKNÜPFUNG" |
| Command search | `search.query` (typed, scoped) | step "COMMAND SEARCH (server)" |
| Map | `map.query/station` | `readModels.db.test.ts` (authorization and filters equal the list's) |

`docs/staging.md` previously listed Dashboard, BVB-EEA, PSV-ITK, Anmeldung, Audit and Gewerk workspaces as legacy-snapshot pages.
That is no longer true of the code above; the legacy snapshot (`/data.json`, `/schedule.json`) is refused in the server artifact
(`assert-build-target.mjs`, container gate, step "EXPORT is workspace-scoped; … unknown /api paths are 404").

## Mutations: owner, authorization, guarantees

All writes go through the domain services (`server/domain/`); `server/mutationPlane.test.ts` fails if any other module writes
project tables. Counts below are occurrences in the service source, a pointer to read the code, not a proof of behaviour.

| Workflow | Procedure(s) | Domain service | Authorization | In one transaction | Idempotent / versioned | Audit | Live event (outbox) |
|---|---|---|---|---|---|---|---|
| Project create / update / delete / review edit | `projects.create/update/delete/updateReview/createReview` | `ProjectService` | `canCreateProject`, `canEditProject`, `canDeleteProject`, `canApproveReview` (+ workspace scope) | yes (6 tx sites) | `expectedVersion` (stale → conflict), `idempotencyKey` | `appendAudit` | yes (outbox row + `feedSeq`) |
| Register import | `projects.registerPreview/registerApply` (admin) | `RegisterImportService` → `ProjectService.createWithin/updateWithin` | `canImportRegister` + per-row `canEditProject` | per batch | idempotency key, `expectedVersion`; re-import is a no-op (`registerImport.db.test.ts`) | yes | yes (through ProjectService) |
| Prüfbericht import | `pruefberichte.import` (admin) | `importPruefberichte` in `server/infra/pruefberichtStore.ts` (not in `server/domain/`; reports are not project tables, so `mutationPlane.test.ts` does not cover it) | `adminProcedure` + `canImportPruefberichte` | batches sent by the browser; transaction scope not traced | idempotent by (year, laufende Nummer) (router comment; `pruefberichtStore.db.test.ts` counts `audit_log` rows across a re-import) | yes (`audit_log`, `entityType pruefbericht`) | no |
| Prüfbericht ↔ project link | `pruefberichte.setLink`, `autoLink` (admin) | `PruefberichtLinkService` | `canEditProject` on the project; view needs `canViewPruefberichte` (global — reports have no workspace) | yes | `expectedVersion`, `idempotencyKey`, removed link = remembered decision | yes | **no, by design**: "Reports are not part of the Project aggregate and carry no workspace, so no project event is emitted" (service header) |
| Projektanmeldung save / submit | `checklists.save/submit` | `ChecklistService` | `canEditProject` / `canViewProject` | yes; submit creates the project and its reviews via `createWithin` and the department notifications in the same transaction | `expectedVersion`, `idempotencyKey`; replay delivers nothing twice (dedupKey) | yes | yes |
| Slot booking | `bookings.book/release` | `BookingService` | `canEditProject` / `canViewProject` | yes | `expectedVersion`, `idempotencyKey` | yes | yes |
| Notification inbox | `notifications.list/markRead` | notification store | own rows only (`ctx.principal.id`); workspace re-checked on read (docs/auth.md) | not traced | — | not traced | — |
| Gewerk subscriptions | `notifications.setSubscription` (own), `setSubscriptionForUser` (admin) | `SubscriptionService` | own: eligible via current grant; other: `canManageUsers` | yes | upsert (naturally idempotent) | admin changes only | no |
| Document-action record | `audit.record` | `ProjectService.recordDocumentAction` | any signed-in user, 120/min/principal | single | — | yes | no |
| Grants (role/workspace/department) | none — come from the verified token | provisioner (`provisionBatch`) | the token | batched upsert | per-sighting TTL; changed grant bypasses it | yes (`field = grant`) | no |

## Isolation and failure behaviour — where it is tested

* Workspace isolation: `securityAudit.db.test.ts`, `routers.register.db.test.ts`, `readModels.db.test.ts`; browser PROOF 4 (project moved Frankfurt → Kassel: stream, DOM and API).
* Disconnect / reconnect / convergence: PROOF 2 and 5, TOPOLOGY, CHAOS (Redis outage, app restart), `scripts/load/chaos.ts` (local, SIGKILL on one host).
* Duplicate submission / retry: `idempotencyKey` paths in `projectService.db.test.ts`, `hardening.db.test.ts`; step "integrity: every committed change has exactly one audit set, one event, one feedSeq".
* Conflicts: PROOF 3a/3b (structured conflict, nobody overwritten).

## Gaps found by this audit (not fixed here)

1. ~~BVB-EEA has no browser proof.~~ Closed by the step "BVB-EEA (server)" in `scripts/e2e/server-mode.e2e.ts` (see the page table). It does not cover the map view, export or detail dialog of that page, which `ServerDepartmentView` shares with PSV-ITK and which the PSV-ITK step does not exercise either.
2. **`audit.record` rate limit is per instance** (an in-process `Map`, 120/min/principal): with N instances the effective limit is N times higher, and it resets on restart. Acceptable as abuse damping, not as a quota.
3. **What the browser shows while an operation is pending, failed or conflicted** was not traced page by page. PROOF 3a/3b cover the conflict dialog for the project table; Anmeldung, Einstellungen, link and import dialogs were not audited for pending/failed/offline states.
4. **`audit.record` takes no idempotency key** (the other mutations in the table do), so a client retry is a second call. Whether a duplicate document-action entry matters was not assessed.
5. **Caches are per instance** (`dashboard.*` per-scope read-model cache, 30 s identity cache, `pruefberichtView`): after a write, a read on another instance can be stale until that instance's TTL or invalidation. The convergence proofs cover the project table over the event stream, not these caches. TTLs and invalidation paths were not re-verified here.

## Not traced

Presence and notification fan-out internals (see `docs/realtime.md`), Excel export, PDF generation, the `/odata` Express router (`odata.metadata` is public but returns a constant), SMTP mail path, and anything under `scripts/`.
