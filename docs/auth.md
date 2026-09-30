# Authentication & authorization

## Identity (server-validated; the browser is never trusted)

`resolveIdentity(req)` (`server/_core/identity.ts`):

1. `Authorization: Bearer <token>` → `verifyBearer` (jose): signature (RS256/ES256/PS256 only; `alg=none` rejected),
   `iss`, `aud`, `exp` (30 s skew). Enabled by `OIDC_ISSUER` + `OIDC_AUDIENCE` (`OIDC_JWKS_URI` optional; Entra's
   `…/discovery/v2.0/keys` is derived from the issuer). Tested with locally generated keys (`oidc.test.ts`).
2. Otherwise the signed session cookie (existing SDK path).

Claims → principal: `roles` (`admin` > `editor` > else **viewer**, i.e. least privilege), optional `workspaces[]`,
`departments[]`. Subject = `tid:oid`. The `users` row mirrors the identity; `role` is authoritative from the token.
Resolved identities are cached 30 s per credential hash **with single-flight**, so a burst of requests does one
verification and one `lastSignedIn` write, not thousands.

**Not verified against a live Entra tenant** — no tenant is available here. What is verified is the validation logic
with Entra-shaped tokens. **NOT DONE:** the browser sign-in (MSAL redirect/popup) that obtains the token;
`setAccessTokenProvider()` in `client/src/realtime/serverApi.ts` is the hook it plugs into.

## Demo credentials

`auth.demoLogin` returns `NOT_FOUND` in production unless `ALLOW_DEMO_LOGIN=1`. The server refuses to boot in
production with the default JWT secret, a secret < 32 chars, no `DATABASE_URL`, or no IdP configured
(`assertProductionConfig`, tested). Note: the *static SPA's* login screen (local mode) still uses its own local demo
flow — it protects nothing and must not be the production entry point once server mode is deployed.

## Permission functions (`server/domain/permissions.ts`, pure, unit-tested)

`canViewProject, canEditProject, canCreateProject, canEditDepartment, canApproveReview, canDeleteProject, canViewAudit,
canExport, canManageUsers, canSubscribe`. Roles: admin (all) · editor (view/edit in allowed workspaces, approve in own
departments, audit, export) · viewer (read). Empty `workspaces` = all workspaces (matches today's open product).

Enforced at: every `projects.*` procedure (service layer), `reviews.update` (department + workspace), `audit.list`,
`/api/export` (canExport), `/api/import` (admin), every realtime scope. Previously **public** read procedures
(`dashboard.stats`, `filters.options`, `bvbEea.list`, `psvItk.list`, `odata`, `projects.searchSuggestions`) now require login.
