# Authentication & authorization

## Identity (server-validated; the browser is never trusted)

`resolveIdentity(req)` (`server/_core/identity.ts`):

1. `Authorization: Bearer <token>` → `verifyBearer` (jose): signature (RS256/ES256/PS256 only; `alg=none` rejected),
   `iss`, `aud`, `exp` (30 s skew). Enabled by `OIDC_ISSUER` + `OIDC_AUDIENCE` (`OIDC_JWKS_URI` optional; Entra's
   `…/discovery/v2.0/keys` is derived from the issuer). Tested with locally generated keys (`oidc.test.ts`).
2. Otherwise the signed session cookie (existing SDK path).

Claims → principal: `roles` (`admin` > `editor` > else **viewer**, i.e. least privilege), `workspaces[]`,
`departments[]` — and, because Entra can emit only `roles` as a multi-valued claim, the same grants as app roles
`Workspace.<BM|ALL>` / `Department.<Gewerk>` inside `roles` (unioned with the arrays; unknown names grant nothing; see
[entra-acceptance.md](entra-acceptance.md)). Subject = `tid:oid`; the principal id is `o` + 31 hex of its SHA-256 (fits the 64-char actor columns,
never a raw tenant/object id).

**No database on the authentication path.** Authorization derives from the verified token alone. A `users` row is
written by a **batched write-behind provisioner** (`server/infra/userProvisioner.ts`, one enqueue per user per 10 min,
multi-row upserts off the request path). Measured with 10,000 distinct tokens: 10,000 users provisioned in ~20-70
statements, `provisionFailures` 0 (docs/load-testing.md). Before this change every first sighting cost two queries
against a 10-connection pool. Resolved identities are cached 30 s per credential hash **with single-flight**.

**Not verified against a live Entra tenant** — no tenant is available here. What is verified is the validation logic
with Entra-shaped tokens and in the two-browser proof (a local test IdP + JWKS). 

## Browser sign-in (implemented; proven only against a mock authority)

`client/src/realtime/oidcClient.ts`: OIDC **authorization code + PKCE (S256)**, no client secret, discovery from
`VITE_OIDC_AUTHORITY` (Entra v2.0 compatible), redirect URI `/auth/callback`. Build-time config: `VITE_OIDC_AUTHORITY`,
`VITE_OIDC_CLIENT_ID`, `VITE_OIDC_SCOPE`. With these set the Login page shows only "Mit Microsoft anmelden" (no password form).

* Token storage: access token in memory + `sessionStorage` (per tab) with its expiry; **never `localStorage`**; no refresh token,
  no id token. An expired token is not sent; the user is bounced through the IdP again (silent when the IdP session lives).
* The token is sent as `Authorization: Bearer` on tRPC, the SSE stream, presence and the (authenticated) legacy snapshot.
* Logout clears the token + flow state, clears the query cache, calls `auth.logout`, then ends the IdP session
  (`end_session_endpoint` when advertised) and returns to `/login`.
* The callback checks `state` (single-use), exchanges the code with the stored verifier, and only follows same-origin
  relative `returnTo` paths.
* The CSP `connect-src` admits the IdP origin derived from `OIDC_ISSUER` (the browser calls discovery + token endpoints).
* The server stays the authority: it re-validates signature/iss/aud/exp on every request. Missing workspace claim = no
  access; only the literal `["ALL"]` grants all workspaces to a non-admin; unknown roles = viewer. Proven end to end in
  `scripts/e2e/oidc-browser.e2e.ts` (mock authority, real browser, real server bundle). **Not proven against Entra.**

## Two entrances: Microsoft sign-in first, the demo always one click away

| Deployment | What the sign-in page offers |
|---|---|
| **Production** (container, `build:production`) | "Mit Microsoft anmelden" is the one primary action (no password form, no demo credentials). With `VITE_DEMO_URL` set at build time a plain link "Demo ansehen" leads to the static demo. |
| **Static demo** (`build:demo`, Vercel) | browser-local demo accounts (they protect nothing and say so). With `VITE_APP_URL` set at build time a "Mit Microsoft anmelden (Produktivsystem)" button leads to the production sign-in. |

The demo is a separate deployment on purpose: demo authentication can never be enabled on the production server (boot refuses it),
so "demo always available" means the static demo stays up and each side links to the other. Both URLs are validated as absolute
`https` (or local `http`) without credentials (`shared/entry-links.ts`) and used only as navigation targets.

A first Microsoft sign-in whose token carries **no role/workspace grant** lands on an explicit "Angemeldet — noch keine Freigabe"
page (with sign-out) instead of empty lists (`scripts/e2e/oidc-browser.e2e.ts`). Access is never widened to make that page go away.

### Checklist for the first real Microsoft sign-in (Entra) — **not verified against a live tenant**

1. **API app registration**: expose an API scope (`access_as_user`); define **app roles** `admin`, `editor`, `viewer` and assign them to users/groups
   (Enterprise application → Users and groups). The `roles` claim is what the server maps.
2. **SPA app registration**: platform *Single-page application*, redirect URI `https://<host>/auth/callback` (exactly), API permission for the scope above.
3. **Token version**: Entra issues v1 tokens (`iss=https://sts.windows.net/<tid>/`, `aud=api://<id>`) unless the API manifest sets
   `accessTokenAcceptedVersion: 2` (`iss=…/v2.0`, `aud=<client-id>`). Either works — set both spellings:
   `OIDC_ISSUER="https://login.microsoftonline.com/<tid>/v2.0,https://sts.windows.net/<tid>/"` and
   `OIDC_AUDIENCE="api://<api-id>,<api-id>"` (comma or space separated; every other issuer/audience is refused).
4. **Workspaces**: Entra emits no `workspaces`/`departments` claim by itself, and a claims-mapping policy emits one string per claim, not an array
   (a single string is ignored — default-deny). Assign them as **app roles** `Workspace.<Name>` / `Workspace.ALL` / `Department.<Gewerk>` (to users or groups);
   if a tenant does produce string arrays they are honoured too. `ALL` is the only all-workspaces grant. Admins (app role `admin`) see everything without it.
   Until they exist a user gets the "noch keine Freigabe" page.
5. **Build args**: `VITE_OIDC_AUTHORITY=https://login.microsoftonline.com/<tid>/v2.0`, `VITE_OIDC_CLIENT_ID=<spa-client-id>`,
   `VITE_OIDC_SCOPE="openid profile api://<api-id>/access_as_user"`, optionally `VITE_DEMO_URL`.
6. **Migrations** before the new version serves: `node dist/migrate.js` applies 0014 (`users.principalId` backfill, `department_subscriptions`,
   `notifications.dedupKey`). The backfill derives the same principal ids the running server uses; identities whose `openId` was longer than
   64 characters (a real tenant's `tid:oid`) were truncated before 0014; the migration drops their grant and principal id (they can never
   be a recipient) and they are provisioned afresh on their next sign-in — no such deployment existed. A `BEFORE INSERT` trigger derives
   `dedupKey` for a pre-0014 server still writing during a rolling deploy.
7. **Verification levels**: ☑ mock identity provider (`oidc-browser.e2e.ts`, `server-mode.e2e.ts`) · ☑ locally against MariaDB + Redis ·
   ☑ CI against MySQL 8.4 + Redis 7 (`ci.yml`) · ☐ real Entra tenant · ☐ deployed environment. **Microsoft SSO is not production-verified until the
   real tenant flow has been exercised** (token version, claims, redirect URI, CSP origin).
   The repeatable procedure and report: [entra-acceptance.md](entra-acceptance.md) (`scripts/gate/entra-acceptance.ts`; not yet run against any tenant).

## Provisioning contract: Entra → application identity → permissions

What the token says is what the user may do; nothing in the database widens it. The contract, as the code enforces it:

| Entra | Application | Where |
|---|---|---|
| **App role** `admin` / `editor` / `viewer` (claim `roles`, highest wins; unknown or missing → `viewer`) | `Principal.role` | `server/_core/oidc.ts` `verifyBearer` |
| claim `workspaces: string[]` — Bahnhofsmanagement names, or exactly `["ALL"]` — **and/or** app roles `Workspace.<Name>` / `Workspace.ALL` (`grantsFromRoles`) | `Principal.workspaces`; missing/empty/`"*"` → **no workspace** (default-deny) | `workspacesFromClaim` |
| claim `departments: string[]` and/or app roles `Department.<Gewerk>` — Gewerke (`EEA`, `ITK`, … from `shared/validation.ts`) | `Principal.departments`: review editing (`canEditDepartment`), department subscriptions | `verifyBearer`, `permissions.ts` |
| `tid` + `oid` | stable identity: `users.openId = oidc:<tid>:<oid>` (varchar 128, never truncated), **principal id** `o` + 31 hex of sha256(openId) (`server/domain/principalId.ts`, stored in `users.principalId`) | `identity.ts`, migration 0014 |
| `name`, `email` / `preferred_username` | `users.name`, `users.email` — the only profile attributes mapped. No Graph call, no group resolution, no job title/department text: an attribute the token does not carry is not invented. | provisioner |

* **Display name, e-mail, department text are never identity and never a grant.** Only `tid:oid` identifies, only `roles` / `workspaces` / `departments` claims grant.
* **Groups**: not consumed. If the tenant prefers security groups, map them to the app roles / claims above in Entra (app-role assignment to groups, or a claims-mapping policy emitting `workspaces` / `departments`). Group-id → permission mapping in this application, and Microsoft Graph for group overage, are **not implemented**; a token whose claims are missing lands on the pending page below rather than being resolved by a lookup.
* **First login**: idempotent write-behind upsert (`provisionBatch`): the `users` row, `principalId`, the grant snapshot; a new or changed grant is audited (`entityType user`, field `grant`). The request itself never waits for the database.
* **No grant yet**: "Angemeldet — noch keine Freigabe" (sign-out offered); lists stay empty, nothing is widened.
* **Revocation**: *access* follows the token (30 s identity cache): the next token without `editor` or without a department stops edits and subscription changes at once. *Deliveries* read the stored grant snapshot (`users.grantSnapshot`), which the provisioner rewrites when the user next makes a request with the changed token — an idle user keeps the old grant until then (bounded by the token lifetime, since every request carries a fresh token). Notifications already stored stay readable while the recipient may see the project's workspace; they are about projects, not reports, and carry no Prüfbericht data. The audit trail shows the grant change.
* **Existing sessions**: a token is re-validated on every request; a changed grant takes effect within 30 s of the IdP issuing the new token (the SPA holds no refresh token; it re-authenticates silently when the access token expires).
* **Administrators review mappings** in the audit (`field = grant`) and correct department subscriptions per user (`notifications.subscriptionsOfUser` / `setSubscriptionForUser`, audited `subscription.<Gewerk>`). Role and workspace corrections are made in Entra, never in the application.

## Department notifications (Gewerk subscriptions)

`department_subscriptions` (migration 0014) stores explicit decisions — the user's own (`source = user`) or an administrator's (`admin`). Without a row the default applies: an **editor follows exactly the departments of their grant**, an **administrator follows none** and opts in. An explicit "off" is a row: sign-ins, re-provisioning and imports never undo it. Eligibility is re-read at delivery time from the user's stored grant (`users.grantSnapshot`, refreshed on the user's next request with a changed token): an explicit "on" for a department the grant no longer carries delivers nothing.

Event → recipients: `ChecklistService.submit` (Projektanmeldung) creates the project and its reviews through `ProjectService.createWithin`; the departments whose generated review is `offen` (`buildDepartmentReviews`, the workbook's trigger rule) are the ones with work. For each such department every eligible, subscribed user who may see the project's workspace — minus the actor — gets **one** notification row (`kind assignment`, `department`, link to the project) and one `notification.created` outbox event addressed to them, in the **same transaction** as the submission. Draft saves, idempotent retries and reviews that are "nicht erforderlich" produce nothing. Uniqueness is the logical fact, not the event: `notifications.dedupKey = checklist.submitted:<checklistId>:<department>` per recipient (unique), so a regenerated event cannot deliver twice; watcher notifications use `event:<eventId>`. Reads re-check workspace access (`notifications.list` filters by the recipient's current workspaces). Project watchers (`project_watchers`) are a separate feature and unchanged.

Settings: `/einstellungen` (Benachrichtigungen je Gewerk) lists what the current grant allows and the effective state; the bell links there. Tests: `server/domain/departmentNotifications.test.ts` (policy), `departmentNotifications.db.test.ts` (real DB: provisioning, recipients, dedup, rollback, revocation, admin audit, watchers), `mutationPlane.test.ts`, the server-mode browser proof step "PROJEKTANMELDUNG → GEWERK".

## One production auth model: OIDC bearer tokens

Production authenticates **bearer access tokens only**, verified by the server on every request (signature, issuer,
audience, expiry, claims). There is no demo login, no cookie session and no legacy OAuth route in production:

* `assertProductionConfig` refuses to boot with `ALLOW_DEMO_LOGIN` set (any truthy value), `LEGACY_USER_WORKSPACES`,
  `OAUTH_SERVER_URL`, a missing `OIDC_ISSUER`/`OIDC_AUDIENCE`, a weak/default `JWT_SECRET`, no `DATABASE_URL` or no `REDIS_URL`.
* `auth.demoLogin` answers `NOT_FOUND` in production, signed legacy session cookies are ignored (401), and the legacy OAuth
  callback is not mounted. The production SPA has no credential form: if the IdP was not configured at build time the login
  page says so. (Covered by `oidc.test.ts` and the `AUTH (production)` step of the server-mode e2e.)
* In the SPA the identity comes from the SERVER (`auth.session`, resolved from the bearer token held in `sessionStorage`).
* The static demo artifact (`pnpm build:demo`) keeps its browser-local demo login; it protects nothing and says so.

### Authorization changes are audited

Role, workspaces and departments come from the verified token on every request. The server mirrors each verified principal
into `users` and, in the same transaction, appends an `audit_log` row (`entityType='user'`, `field='grant'`, old/new canonical
grant JSON) whenever a grant is new or changed. A changed grant bypasses the provisioner's sighting TTL, so it is recorded on
the next request that carries the new token; access itself changes as soon as the IdP issues a token with new claims
(the identity cache holds a verified token for at most 30 s). These rows are unscoped (visible to unrestricted auditors only).

## Permission functions (`server/domain/permissions.ts`, pure, unit-tested)

`canViewProject, canEditProject, canCreateProject, canEditDepartment, canApproveReview, canDeleteProject, canViewAudit,
canExport, canManageUsers, canSubscribe`. Roles: admin (all) · editor (view/edit in allowed workspaces, approve in own
departments, audit, export) · viewer (read).

### Workspace access is explicit and default-deny

| Principal `workspaces` | Meaning |
|---|---|
| `"ALL"` | explicit all-workspaces grant (claim `workspaces: ["ALL"]`) |
| `["Frankfurt", …]` | exactly those workspaces |
| `[]` | **no workspace access** — what a missing/empty/garbage claim produces |

Only `admin` sees every workspace without a grant. `"*"` and bare strings are **not** grants (tested). Unknown role
strings → `viewer`; `roleFromLegacy(undefined|null|other)` → `viewer` (only `admin`/`user` map up). Legacy cookie users
with no assignment get `[]` unless they are admins, use the (non-production) demo login, or the deployment sets
`LEGACY_USER_WORKSPACES=ALL` explicitly. `workspaceRestriction()` returns `null` (unrestricted) or the list; an empty
list makes every list/count/notification/feed query return nothing (never `IN ()`, never "everything").
Tests: `permissions.test.ts` ("workspace access is explicit and default-deny"), `oidc.test.ts` (missing claims).

Enforced at: every `projects.*` procedure (service layer), `projects.updateReview` (department + workspace), `audit.list`,
`/api/export` (canExport), `/api/import` (admin), every realtime scope. Previously **public** read procedures
(`dashboard.stats`, `filters.options`, `bvbEea.list`, `psvItk.list`, `odata`, `projects.searchSuggestions`) now require login.
