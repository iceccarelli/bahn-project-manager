# Protecting `main`

**State: NOT PROTECTED until GitHub says so.** The repository carries the ruleset as code
(`.github/rulesets/main.json`); a repository admin must import it. Nothing in this repo or its CI can apply it.

## What the ruleset requires

Required status checks (each is a job in `.github/workflows/ci.yml`; `pnpm check:consistency` fails if the two lists drift
or if any of the nine is dropped): `lint-typecheck`, `test`, `build`, `e2e`, `e2e-server`, `container`,
`migrations-mysql84`, `image`, `ui-perf`. Plus: pull request required, no force-push, no deletion.

`ui-perf` is required only because it has run green on CI (see the check run on the PR that introduced this file); its
budgets are in `scripts/perf/thresholds.json`.

## What the admin does (GitHub UI)

1. Repository → **Settings → Rules → Rulesets → New ruleset → Import a ruleset**.
2. Choose `.github/rulesets/main.json`; keep enforcement **Active**; target `main`.
3. Save. Confirm: Settings → Rules shows the ruleset *Active*, and a test PR shows nine required checks.
4. Verify from the API (read-only): `GET /repos/{owner}/{repo}/rules/branches/main` lists `required_status_checks`
   with the nine contexts.

Only after step 4 may anyone write "main is protected". A repo without the admin step is documented as unprotected.

## Why direct pushes are not the fallback

Merging requires all nine checks green on the final head. Until the ruleset is active the discipline is procedural:
open a PR, wait for the nine checks, merge.
