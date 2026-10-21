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

The acceptance script judges each user against this exact configuration (`EXPECTED` in `server/_core/entraAcceptance.ts`);
a missing **or unexpected** grant fails:

| Persona (`ENTRA_TOKEN_…`) | App roles to assign in Entra | Resolves to |
|---|---|---|
| `ADMIN` | `admin`, `Workspace.ALL` | role admin, workspaces `ALL`, departments **none** |
| `EDITOR` | `editor`, exactly one `Workspace.<BM>` (not `ALL`), `Department.ITK` | role editor, one workspace, departments exactly `["ITK"]` |
| `VIEWER` | `viewer`, exactly one `Workspace.<BM>` | role viewer, one workspace, departments **none** |
| `NOGRANT` | `viewer` only (assignment is required for the user to sign in at all) | role viewer, no workspace, departments **none** — the "Angemeldet — noch keine Freigabe" case |

Departments are not given to the admin because an admin needs none (role admin is unrestricted); granting one would be flagged as unexpected.
`ITK` is the fixed test Gewerk; using a different one requires changing `EXPECTED` in the script and its tests together.

For each user sign in once through the deployed SPA in a private window, then copy the token **without echoing it**:
DevTools → Application → Session Storage → `bahn.access_token` → copy value; then in the shell
`read -rs ENTRA_TOKEN_EDITOR; export ENTRA_TOKEN_EDITOR` and paste. (Tokens live ~1 h; do this per run.)

## 4. Run the claim/authorization acceptance

```
export OIDC_ISSUER=… OIDC_AUDIENCE=…            # exactly the production values
export ENTRA_ACCEPTANCE_URL=https://<host>        # optional but required for the "deployed server agrees" evidence
mkdir -p artifacts && pnpm exec tsx scripts/gate/entra-acceptance.ts > artifacts/entra-acceptance.json; echo "exit $?"
```
It verifies each token with the server's own code (signature, issuer, audience, expiry, algorithm), checks the role, workspace **and
exact department set** per persona (table above), compares role, workspaces and departments (order-insensitively; a server that omits
or differs on any of them is a failure) with the deployed server's `auth.session`, and checks that a tampered token and an anonymous request
get no identity. Exit `0` = pass; `1` = fail (problems name the Entra setting to fix); `2` = no tokens (nothing ran).
The report holds claim *structure* (iss, aud, ver, role values, claim shapes, lifetime) and an 8-hex subject label — no token,
object id, name or e-mail.

**When the verdict can be `real-entra`:** every issuer is a Microsoft issuer of one tenant **and** the signing keys are Microsoft's for
that tenant — `OIDC_JWKS_URI` unset, or exactly `https://login.microsoftonline.com/<tid>/discovery/v2.0/keys`. Any other
`OIDC_JWKS_URI` (a mock, a proxy, another tenant's keys), even with a Microsoft-looking issuer string, yields `selftest-not-entra`
(exit 1 unless `ENTRA_ACCEPTANCE_ALLOW_NON_ENTRA=1`, which exists only for self-tests and never changes the verdict). The report's
`keySource` field states which key source was used. Run the procedure against the production configuration, i.e. without `OIDC_JWKS_URI`.
Claim fields shown under `shape` are read from the token *without* verification and are diagnostic only; nothing in the verdict
depends on them. A passing run is evidence about those personas and that key source, not a statement about the browser flow (step 5)
and not a substitute for it.

## Certificates, managed devices and Conditional Access: tenant configuration, not application code

The application uses the standard Microsoft Entra OIDC flow (authorization code + PKCE, public client, **no client secret**) and validates the resulting
access token on the server. Everything about *how* the employee proves who they are is evaluated by Entra **before** a token exists:

* certificate-based authentication, Conditional Access, "require compliant / hybrid-joined device", MFA and device registration are configured by the
  tenant administrators and enforced at sign-in; an employee who fails them never reaches the application's callback with a token;
* the application never sees, collects, stores or transmits a password or a device/user private key, and it does not read device-compliance claims or infer
  anything from them — it has no "certificate recognition" feature and does not claim that a device is compliant;
* an `@deutschebahn.com` address grants nothing; only the app roles / claims of step 1 do. A successful sign-in without grants lands on
  "Angemeldet — noch keine Freigabe".

What the owner verifies in the tenant (cannot be proven from this repository): the test users are subject to the same Conditional Access / certificate /
device policies as production employees and can complete sign-in from an approved device; the SPA and API registrations are in scope of those policies;
sign-in from a non-compliant device is refused **by Entra** (expected, not an application defect).

## 5. Browser checks (manual, with the real tenant; tick each in the PR that records the result)

- [ ] Login page shows only "Mit Microsoft anmelden" (+ "Demo ansehen" when `VITE_DEMO_URL` is set); no password form.
- [ ] Sign-in as **editor** lands on the app, project lists show only the granted workspace; as **nogrant** shows "Angemeldet — noch keine Freigabe".
- [ ] No CSP violations in the console during sign-in (login.microsoftonline.com discovery + token endpoint).
- [ ] The notification bell and live project updates arrive for the editor within the granted workspace and not outside it (open the app as editor and admin, change a project in a second workspace).
- [ ] Sign-out ends the Entra session and returns to `/login`; browser Back does not show data; a copied pre-logout token still works until it expires (access tokens are not revocable — expected, bounded by token lifetime).
- [ ] After removing `Workspace.<BM>` from the editor in Entra and signing in again, the workspace is gone (≤ 1 token lifetime + 30 s identity cache).
- [ ] A callback URL replayed in the address bar ends on the sign-in error, not in the app.
- [ ] Sidebar, header avatar and `/einstellungen` → Konto show *this* user's name, e-mail, role, Bahnhofsmanagements and Gewerke-Freigabe (editor test user: `Bearbeiter`, one workspace, `ITK`) — and no other person's.
- [ ] Sign out as the editor, sign in as the viewer in the same browser profile: the viewer's Konto card shows the viewer, and no recent search or typed-in recipient of the editor is present.
- [ ] With the API deliberately unreachable (stop the app containers behind the proxy) a signed-in tab shows "Server nicht erreichbar" and returns by itself when the API is back, without a second Microsoft sign-in.

Record: commit SHA of the deployed image, the JSON report, who ran it, date, tenant id *not* included.
