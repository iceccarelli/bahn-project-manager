# Security

This is a **hardening pass of the slice and the HTTP edge, not a completed security audit.** No penetration test,
dependency audit (`pnpm audit`), or secret scan was performed at this stage.

## Done (each has a test or a measured check)

| Area | Change |
|---|---|
| Arbitrary column write | `reviews.update`, `bvbEea.update`, `psvItk.update` accepted `{field: string, value: any}` and wrote `[field]: value` — any column, including `id`/`projectId`. Now closed enums + typed values (`routers.db.test.ts`). Project writes use a strict whitelist schema; unknown/server-owned keys are rejected (400), not ignored. |
| `z.any()` | Removed from all write inputs. |
| Sort injection | `(projects as any)[sortBy]` (tRPC list and OData) → closed enums (`updatedAt`,`id`). Express OData router (unmounted) still has its own sort; it is not reachable. |
| IDOR / enumeration | Invisible ≡ nonexistent (`NOT_FOUND`); realtime scopes authorized per channel. |
| Unauthenticated data | Public reads → login required. `/api/export/excel` (whole DB, anonymous) → `canExport`; `/api/import/excel` → admin, 25 MB cap. |
| Injection | Search terms are stripped/parameterized; `x'; DROP TABLE…` test returns nothing and the table survives. LIKE metacharacters escaped. |
| Body limits | 50 MB JSON limit on every route → 256 kB. |
| CSP | `default-src 'self'`, `script-src 'self'` (no inline/eval), OSM tiles only external host, `frame-ancestors 'none'`. **Verified on the built server's response headers; not verified by loading the SPA under CSP in a browser** (the OSM tile host was blocked by the sandbox proxy). Static Vercel deployment does **not** send this CSP yet (`vercel.json` has nosniff/frame/referrer only). |
| HSTS / nosniff / frame / referrer / permissions-policy | Set by `securityHeaders` (HSTS in production). |
| Cookies | `SameSite=None` → `Lax`; `HttpOnly`; `Secure` when https. |
| CSRF | Cookie-authenticated non-GET requests with a foreign `Origin` → 403 (bearer/non-browser exempt). Tested. |
| CORS | None by default; `ALLOWED_ORIGINS` allow-list with credentials; never `*`. |
| Secrets | Production boot refuses the default JWT secret / short secret. |
| Demo credentials | Off in production unless explicitly enabled. |
| Unhandled rejection | Gateway boundary catches; process-level counter + log. (An escaped rejection crashed the server in the 1000-connection probe — fixed.) |

## Open (NOT DONE)

Rate limiting per IP/user (only per-principal realtime connection caps and DB-queue shedding exist); upload
validation beyond size (Excel import is admin-only but parses untrusted xlsx with `xlsx@0.18.5`, which has known
advisories — verify/upgrade); `audit_log` PII/retention policy; secret scanning in CI; the Excel import still writes
outside the audited/evented path (admin-only bulk tool, flagged); logging redaction review; `reviews.update` writes are
audited but not versioned/evented yet; dependency audit; `pnpm audit` gate.
