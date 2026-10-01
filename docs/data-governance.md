# Data governance — what is in this repository, and what must never be

**Finding (security / data-governance, not a runtime concern).** The repository is public. Until this change it
contained, in the working tree **and in every commit that touched them**:

| What | Where | Why it is sensitive |
|---|---|---|
| The internal project export | `client/public/data.json` (1,298 projects, 18,172 reviews) | project numbers, free-text descriptions and comments (some naming colleagues), SharePoint/Teams links of the operator's tenant, ~320 person names (Projektleitung, Prüfer) |
| The Prüftermin calendar | `client/public/schedule.json` (647 slots) | who booked which slot for which station |
| The contact directory | `shared/contacts.ts`, `data/contacts.source.json` | ~50 named employees with their business e-mail addresses; tests and docs quoting them |
| Derived reports | `data/normalize-report.json`, `data/contacts.report.json`, `data/schedule.report.json` | every changed cell of the real export (before → after), workbook hashes |
| An example checklist | `ChecklisteBeispiel.pdf` | unknown content; unreferenced |
| A build output | `dist-oidc/` (accidentally committed) | a second copy of the export in `legacy/` |

Removing a file from `dist/public` (what the server-mode build now does, see `docs/auth.md`) protects a *running
deployment*. It does nothing for the **source repository**: anyone can read the data from `git` today. Treat it as a
disclosure of internal data and personal data, to be handled by the data owner / data-protection officer.

## What this change did (HEAD)

* The tracked files above are **removed**. `.gitignore` now excludes them, the staged copies under `client/public/`,
  `data/*.xlsm`, and the derived reports, so they cannot be re-committed by accident.
* `fixtures/synthetic/` ships a **synthetic** dataset with the same shape and statistics (1,298 projects, 14 reviews each,
  the same status/region/Prüfer distributions and null patterns; invented names, texts, numbers and links on the
  reserved `example.invalid` domain; station names are the public DB station master). `scripts/data/stage-public-data.mjs`
  copies it to `client/public/` before dev, build, tests and the e2e suites. **CI runs on synthetic data only.**
* The real export is supplied **out of band**: `PRIVATE_DATA_DIR=<dir>` (data.json, schedule.json, contacts.source.json) for
  staging/builds, or, for the database, `PRIVATE_DATA_DIR=<dir> node scripts/data/stage-public-data.mjs && tsx scripts/e2e/seed-real.ts <db-url>`
  (it rebuilds the read models and the geo model afterwards). In the Docker build use a BuildKit secret, never a `COPY`.
* The contact directory and the pseudonymised names in code, tests and docs were replaced by synthetic ones
  (`@example.invalid`). **Residual risk:** a deployment that wants the real contacts compiles them into the client
  bundle (static, unauthenticated asset). Until they are served by an authenticated API, serve the bundle only behind
  an authenticating proxy, or keep the synthetic directory.
* Server-mode builds already refuse to publish the snapshot (`/data.json`, `/schedule.json`) to anyone but
  all-workspace principals.

## What this change could NOT do — needs the repository owner

**Git history still contains the original files.** Rewriting public history is destructive and outward-facing (force-push
to a protected `main`, invalidated clones, forks, open PRs); it was **not** done and must be decided by the owner.

```bash
# 0. Work on a fresh mirror clone. Decide first whether the data is to be treated as DISCLOSED (it is, as of today).
git clone --mirror git@github.com:<owner>/bahn-project-manager.git && cd bahn-project-manager.git
# 1. Drop the sensitive paths from every commit
git filter-repo --invert-paths \
  --path client/public/data.json --path client/public/schedule.json \
  --path data/contacts.source.json --path data/contacts.report.json \
  --path data/normalize-report.json --path data/schedule.report.json \
  --path ChecklisteBeispiel.pdf --path-glob 'dist-*'
# 2. Pseudonymise names/numbers/e-mails that were quoted in code, tests and docs of old commits.
#    names.txt:  real==>synthetic   (kept PRIVATE; build it from the export)
git filter-repo --replace-text names.txt
# 3. Force-push every branch and tag (needs the branch protection exception), then:
git push --force --mirror origin
```

Afterwards: (a) ask GitHub Support to purge cached views and the `refs/pull/*` refs and unreachable objects; (b) tell
every fork owner / collaborator to delete their clones; (c) assume anything fetched before the rewrite is still out
there — rotate nothing is needed (no secrets were in the data) but the **data subjects** and the data owner must be told;
(d) re-run `pnpm gate` on the rewritten history.

## Rules from now on

1. No real project, schedule, contact or user data in the repository — fixtures are synthetic or generated.
2. Real data enters only through `PRIVATE_DATA_DIR` / a secret store / the database import, and never through `COPY` in a Dockerfile.
3. A PR that adds a file under `client/public/` or `data/` matching the ignored patterns fails CI (`scripts/data/check-no-private-data.mjs`).
