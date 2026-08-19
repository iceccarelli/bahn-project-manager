# Applying Stage 1 — corrected delivery

The first attempt failed because the patch file was never in the Codespace.
`git apply stage-1-stations-master.patch` couldn't find it, so nothing changed —
which is why `pnpm stations:generate` reported "Command not found" and why lint
still showed 277 warnings and the bundle 720.75 kB (both the exact pre-patch
baseline). Your branch is clean; there is nothing to undo.

**`stage-1-complete.patch` replaces the previous patch.** It is self-contained:
it carries the code, the generated station master, the normalised `data.json`,
the coordinate ledger, the reports, **and** `data/Bahnhoefe-2026-06-16.xlsx` as a
git binary blob. No separate Excel download, no generator run required.

---

## 1. Get the file into the Codespace

Download `stage-1-complete.patch` from this conversation, then either:

- **Drag it** from your file manager into the VS Code Explorer panel, dropping it
  on the `bahn-project-manager` root folder; **or**
- Right-click the root folder in the Explorer → **Upload...** → pick the file.

Confirm it landed:

```
@iceccarelli ➜ /workspaces/bahn-project-manager (stage-1-stations-master) $ ls -la stage-1-complete.patch
```

It should be ~3.2 MB. If it is a few hundred bytes, the browser saved an HTML
error page instead — re-download.

## 2. Apply and verify

You are already on `stage-1-stations-master`, so start at `git apply`:

```
@iceccarelli ➜ /workspaces/bahn-project-manager (stage-1-stations-master) $ git apply --check stage-1-complete.patch
@iceccarelli ➜ /workspaces/bahn-project-manager (stage-1-stations-master) $ git apply stage-1-complete.patch
@iceccarelli ➜ /workspaces/bahn-project-manager (stage-1-stations-master) $ pnpm install --frozen-lockfile
@iceccarelli ➜ /workspaces/bahn-project-manager (stage-1-stations-master) $ pnpm verify:data
@iceccarelli ➜ /workspaces/bahn-project-manager (stage-1-stations-master) $ pnpm check && pnpm lint && pnpm test:cov && NODE_ENV=production pnpm build:client
@iceccarelli ➜ /workspaces/bahn-project-manager (stage-1-stations-master) $ rm stage-1-complete.patch
@iceccarelli ➜ /workspaces/bahn-project-manager (stage-1-stations-master) $ git add -A && git commit -m "stage 1: canonical station master + BM vocabulary"
```

`git apply --check` prints nothing on success. Use `git apply` (not `patch -p1`)
— the embedded Excel is a git binary diff, which `patch` cannot decode.

`pnpm install` is only needed because `package.json` gained four scripts; no new
dependencies were added, so it is fast.

## 3. Expected output — compare against this

```
pnpm verify:data
  [verify-stations]
        stations: 919 rows (909 with coordinates, 10 without, 1 retired)
        resolution: 852 exact | 15 tokens | 309 fuzzy | 96 region-only | 26 unresolved
        all checks passed.

pnpm check           (no output — 0 errors)
pnpm lint            Found 271 warnings.        ← was 277
pnpm test:cov        Tests  5 passed | 6 skipped (11)
pnpm build:client    index-Do9q7M5_.js  725.47 kB │ gzip: 217.78 kB
```

If `lint` still says **277** or the bundle is **720.75 kB**, the patch did not
apply — check step 1.

## 4. Optional — confirm reproducibility

```
@iceccarelli ➜ /workspaces/bahn-project-manager (stage-1-stations-master) $ pnpm stations:check
@iceccarelli ➜ /workspaces/bahn-project-manager (stage-1-stations-master) $ pnpm data:normalize
```

`stations:check` regenerates the master in memory from the Excel + ledger and
exits non-zero if the committed output has drifted — it should print
`--check OK`. `data:normalize` should report **0 cells changed** and say it kept
the existing report; the 171 KB audit trail of the 1,301 original changes stays
in `data/normalize-report.json`.

---

## What I verified before sending this

Cloned `main` fresh, checked out `stage-1-stations-master`, applied
`stage-1-complete.patch`, then ran the full sequence above. All of it passed,
and the embedded Excel restored with the identical SHA-256
(`a081b847d9a1d766…`). The numbers in section 3 are that run's actual output.

## Two fixes since the previous patch

1. **The patch is now self-contained** — the Excel and all generated artifacts
   are embedded, so there is no second file to move and no generator step.
2. **`normalize-existing-data.ts` no longer erases its own audit trail.** The
   script is idempotent, so a second run legitimately changes nothing — but it
   was then overwriting `data/normalize-report.json` with an empty change list,
   destroying the record of the 1,301 cells the first run changed. It now keeps
   the last report that has content and says so. The committed report is the full
   171 KB one.

---

## A faster path for Stages 2–6

Moving a 3 MB patch by hand every stage will get old. If you add
`iceccarelli/bahn-project-manager` to this session's authorized sources, I can
push the branch directly and you would just run:

```
@iceccarelli ➜ /workspaces/bahn-project-manager (main) $ git fetch origin && git checkout stage-2-data-model
```

I tried to push earlier and the git proxy refused — the repo is not in this
session's authorized set, so no credential is injected. Your call: I am equally
happy to keep shipping patches and leave you in full control of what lands.
