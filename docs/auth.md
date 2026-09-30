# Authentication & authorization

## Identity (server-validated; the browser is never trusted)

`resolveIdentity(req)` (`server/_core/identity.ts`):

1. `Authorization: Bearer <token>` → `verifyBearer` (jose): signature (RS256/ES256/PS256 only; `alg=none` rejected),
   `iss`, `aud`, `exp` (30 s skew). Enabled by `OIDC_ISSUER` + `OIDC_AUDIENCE` (`OIDC_JWKS_URI` optional; Entra's
   `…/discovery/v2.0/keys` is derived from the issuer). Tested with locally generated keys (`oidc.test.ts`).
2. Otherwise the signed session cookie (existing SDK path).

Claims → principal: `roles` (`admin` > `editor` > else **viewer**, i.e. least privilege), `workspaces[]`,
`departments[]`. Subject = `tid:oid`; the principal id is `o` + 31 hex of its SHA-256 (fits the 64-char actor columns,
never a raw tenant/object id).

**No database on the authentication path.** Authorization derives from the verified token alone. A `users` row is
written by a **batched write-behind provisioner** (`server/infra/userProvisioner.ts`, one enqueue per user per 10 min,
multi-row upserts off the request path). Measured with 10,000 distinct tokens: 10,000 users provisioned in ~20-70
statements, `provisionFailures` 0 (docs/load-testing.md). Before this change every first sighting cost two queries
against a 10-connection pool. Resolved identities are cached 30 s per credential hash **with single-flight**.

**Not verified against a live Entra tenant** — no tenant is available here. What is verified is the validation logic
with Entra-shaped tokens and in the two-browser proof (a local test IdP + JWKS). **NOT DONE:** the browser sign-in (MSAL redirect/popup) that obtains the token;
`setAccessTokenProvider()` in `client/src/realtime/serverApi.ts` is the hook it plugs into.

## Demo credentials

`auth.demoLogin` returns `NOT_FOUND` in production unless `ALLOW_DEMO_LOGIN=1`. The server refuses to boot in
production with the default JWT secret, a secret < 32 chars, no `DATABASE_URL`, or no IdP configured
(`assertProductionConfig`, tested). In server mode (`VITE_SERVER_MODE=1`) the SPA takes its identity from the SERVER
(`auth.session`, resolved from the bearer token in `sessionStorage['bahn.access_token']` or the session cookie), never from
localStorage; the login screen calls `auth.demoLogin` (only answers when explicitly enabled). The static local-mode login
still exists for the unchanged Vercel app and protects nothing.

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
