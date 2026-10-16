# Microsoft Entra acceptance — what an owner with a tenant must do

**Status: NOT EXERCISED.** No Entra tenant, app registration or test user was available when this was written. Everything
below is the procedure; its result is not claimed anywhere. Mock-IdP tests (`oidc.test.ts`, `oidc-browser.e2e.ts`) prove the
validation and mapping logic, **not** that Entra issues tokens this server accepts. "Real Entra verified" may be written in
`docs/auth.md` / `docs/production-readiness.md` only after the report in step 4 says `"verdict": "real-entra"` for the
deployed commit **and** the browser checks in step 5 are ticked.

## 1. Tenant configuration (one time)

| Where | Setting |
|---|---|
| API app registration | Expose an API: Application ID URI `api://<api-id>`, scope `access_as_user`. Manifest: `accessTokenAcceptedVersion` = `2` (then `iss=https://login.microsoftonline.com/<tid>/v2.0`, `aud=<api-id>`); if left `null` Entra issues v1 tokens (`iss=https://sts.windows.net/<tid>/`, `aud=api://<api-id>`). Either works as long as both spellings are in `OIDC_ISSUER` / `OIDC_AUDIENCE`. |
| API app roles | `admin`, `editor`, `viewer` (allowed member types: Users/Groups) **and the grant roles below**. |
| SPA app registration | Platform *Single-page application* (not Web: no client secret exists or is needed). Redirect URIs: `https://<host>/auth/callback` **and** `https://<host>/login` (Entra accepts `post_logout_redirect_uri` only if it is a registered redirect URI). API permission: `access_as_user`; grant admin consent if the tenant requires it. |
| Enterprise application (of the API) | "Assignment required" = Yes; assign users **or groups** to the roles. |

### Workspace and department grants: as app roles

The server consumes `roles`, `workspaces[]` and `departments[]` (docs/auth.md). Entra emits `roles` natively and
multi-valued; a claims-mapping policy or optional claim emits **one string per claim**, so `workspaces: ["Frankfurt","Kassel"]`
cannot be produced without extra machinery (a single string is ignored by the server — default-deny — and the acceptance
script warns about it). The smallest contract that needs no Graph call, no group-overage handling and no second identity
store is therefore to carry the grants in the same claim, as additional **app roles** (value = exactly this, no spaces):

| App role value | Grants |
|---|---|
| `Workspace.Darmstadt` … `Workspace.Mainz`, `Workspace.Giessen`, `Workspace.Saarbruecken`, `Workspace.uebergreifend` | that Bahnhofsmanagement (ASCII spellings resolve to Gießen / Saarbrücken / übergreifend) |
| `Workspace.ALL` | the explicit all-workspaces grant |
| `Department.EEA`, `Department.ITK`, … (the 14 Gewerke of `shared/validation.ts`, case-insensitive) | department review rights and subscriptions |

Rules (tested in `server/_core/oidc.test.ts`): unknown or misspelled names grant nothing; a grant role never changes the
role (`admin`/`editor`/`viewer`); the array claims, if a tenant does emit them, are honoured too and the two are unioned.
Assign the roles to **groups** in Enterprise applications to administer by group without the application ever resolving groups.

## 2. Server and build configuration

```
OIDC_ISSUER="https://login.microsoftonline.com/<tid>/v2.0,https://sts.windows.net/<tid>/"
OIDC_AUDIENCE="<api-id>,api://<api-id>"
VITE_OIDC_AUTHORITY="https://login.microsoftonline.com/<tid>/v2.0"
VITE_OIDC_CLIENT_ID="<spa-client-id>"
VITE_OIDC_SCOPE="openid profile api://<api-id>/access_as_user"
```
`VITE_*` are compiled in (rebuild the image after changing them); the CSP `connect-src` admits the issuer's origin automatically.

## 3. Create four test users and obtain their access tokens (never print them)

Users: **admin** (role `admin`, `Workspace.ALL`), **editor** (`editor`, one `Workspace.<BM>`, one `Department.<Gewerk>`),
**viewer** (`viewer`, one `Workspace.<BM>`), **nogrant** (signed in, assigned nothing but able to authenticate — assignment
is required, so give this user only `viewer` and no `Workspace.*`).

For each user sign in once through the deployed SPA in a private window, then copy the token **without echoing it**:
DevTools → Application → Session Storage → `bahn.access_token` → copy value; then in the shell
`read -rs ENTRA_TOKEN_EDITOR; export ENTRA_TOKEN_EDITOR` and paste. (Tokens live ~1 h; do this per run.)

## 4. Run the claim/authorization acceptance

```
export OIDC_ISSUER=… OIDC_AUDIENCE=…            # exactly the production values
export ENTRA_ACCEPTANCE_URL=https://<host>        # optional but required for the "deployed server agrees" evidence
mkdir -p artifacts && pnpm exec tsx scripts/gate/entra-acceptance.ts > artifacts/entra-acceptance.json; echo "exit $?"
```
It verifies each token against the tenant's real JWKS with the server's own code, checks role/workspace expectations per
persona, compares with the deployed server's `auth.session`, and checks that a tampered token and an anonymous request
get no identity. Exit `0` = pass; `1` = fail (problems name the Entra setting to fix); `2` = no tokens (nothing ran).
The report holds claim *structure* (iss, aud, ver, role values, claim shapes, lifetime) and an 8-hex subject label — no token,
object id, name or e-mail. A non-Microsoft issuer can never produce `real-entra` (`selftest-not-entra`, exit 1 unless
`ENTRA_ACCEPTANCE_ALLOW_NON_ENTRA=1`, which exists only for the mock-IdP self-test).

## 5. Browser checks (manual, with the real tenant; tick each in the PR that records the result)

- [ ] Login page shows only "Mit Microsoft anmelden" (+ "Demo ansehen" when `VITE_DEMO_URL` is set); no password form.
- [ ] Sign-in as **editor** lands on the app, project lists show only the granted workspace; as **nogrant** shows "Angemeldet — noch keine Freigabe".
- [ ] No CSP violations in the console during sign-in (login.microsoftonline.com discovery + token endpoint).
- [ ] The notification bell and live project updates arrive for the editor within the granted workspace and not outside it (open the app as editor and admin, change a project in a second workspace).
- [ ] Sign-out ends the Entra session and returns to `/login`; browser Back does not show data; a copied pre-logout token still works until it expires (access tokens are not revocable — expected, bounded by token lifetime).
- [ ] After removing `Workspace.<BM>` from the editor in Entra and signing in again, the workspace is gone (≤ 1 token lifetime + 30 s identity cache).
- [ ] A callback URL replayed in the address bar ends on the sign-in error, not in the app.

Record: commit SHA of the deployed image, the JSON report, who ran it, date, tenant id *not* included.
