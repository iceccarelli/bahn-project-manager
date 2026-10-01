# Bahn Project Manager

Management of Deutsche Bahn infrastructure and station-development projects across 14 technical departments (*Fachbereiche*).
React 19 SPA + Node (Express/tRPC) + MySQL 8.4 + Redis 7. **One authoritative system:** the server owns all project state; the
browser holds caches only.

```
Caddy/TLS → 2+ identical stateless Node instances → MySQL 8.4 (truth) + Redis 7 (transport/presence/cache)
mutation → authorization → validation → transaction → optimistic version + idempotency → audit → outbox event
         → relay → Redis → SSE → browser sync engine
```

What is verified and what is **not** (no claim without evidence): [`docs/production-readiness.md`](docs/production-readiness.md).
Architecture: [`docs/architecture.md`](docs/architecture.md) · topology/deployment: [`docs/topology.md`](docs/topology.md),
[`docs/staging.md`](docs/staging.md) · operations: [`docs/runbook.md`](docs/runbook.md) · auth: [`docs/auth.md`](docs/auth.md).

## Two artifacts — never mixed

| Artifact | Build | Meaning |
|---|---|---|
| **Production** | `pnpm build:production` · the `Dockerfile` | server-authoritative; contains no dataset and no demo notice (CI-asserted) |
| **Demo** | `pnpm build:demo` (Vercel) | browser-local preview over a *synthetic* dataset; says so on every page |

`pnpm build` is `pnpm build:production`. A bare `vite build` is refused.

## Develop

```bash
pnpm install --frozen-lockfile
pnpm dev                       # needs DATABASE_URL (MySQL) for the server data plane; REDIS_URL optional in dev
pnpm check && pnpm lint        # typecheck + lint
TEST_DATABASE_URL=mysql://root:pw@127.0.0.1:3306 TEST_REDIS_URL=redis://127.0.0.1:6379 pnpm test
scripts/e2e/build-server-mode.sh && pnpm exec tsx scripts/e2e/server-mode.e2e.ts   # two real browsers, two instances
pnpm gate                      # the integrated deployment gate (docs/runbook.md)
```

Real project data never enters the repository (`docs/data-governance.md`); fixtures are synthetic.

## Quality gates (GitHub Actions, required on `main` via `.github/rulesets/main.json`)

`lint-typecheck` · `test` (MySQL 8.4 + Redis 7) · `build` · `e2e` (demo UI gates) · `e2e-server` · `migrations-mysql84` ·
`container` (the production image booted against MySQL 8.4 + Redis 7) · `image` · `ui-perf`.

## Stack

React 19 · Vite 7 · TypeScript · Tailwind 4 / shadcn · TanStack Query · Leaflet · Express · tRPC 11 · Drizzle (MySQL 8.4) ·
Redis 7 · SSE · OIDC code + PKCE (Microsoft Entra compatible; verified against a mock IdP only — see the readiness ledger).

## License

MIT © 2025–2026 Bahn Project Manager contributors.
