# STAGE 1 — Stations Master Data (Foundation)

**Patch:** `stage-1-stations-master.patch` · 16 files · +1,660 / −113 · 91 KB
**Base:** `6580167` (`main`) — verified to apply cleanly with both `git apply` and `patch -p1`

---

## Commands

```
@iceccarelli ➜ /workspaces/bahn-project-manager (main) $ git checkout -b stage-1-stations-master
@iceccarelli ➜ /workspaces/bahn-project-manager (main) $ git apply stage-1-stations-master.patch
@iceccarelli ➜ /workspaces/bahn-project-manager (main) $ mkdir -p data && cp ~/Downloads/Bahnhoefe-2026-06-16.xlsx data/
@iceccarelli ➜ /workspaces/bahn-project-manager (main) $ pnpm install --frozen-lockfile
@iceccarelli ➜ /workspaces/bahn-project-manager (main) $ pnpm stations:generate
@iceccarelli ➜ /workspaces/bahn-project-manager (main) $ pnpm data:normalize
@iceccarelli ➜ /workspaces/bahn-project-manager (main) $ pnpm verify:data
@iceccarelli ➜ /workspaces/bahn-project-manager (main) $ pnpm check && pnpm lint && pnpm test:cov && NODE_ENV=production pnpm build:client
@iceccarelli ➜ /workspaces/bahn-project-manager (main) $ git add -A && git commit -m "stage 1: canonical station master + BM vocabulary"
```

The patch carries **code only**. The three data artifacts
(`client/public/stations.json`, `client/public/stations-national.json`,
`client/public/data.json`) are produced by the two generators, so the patch stays
reviewable at 91 KB instead of ~9 MB. I ran exactly this sequence on a clean
clone: the outputs are **byte-identical** (SHA-256 verified) to mine.

`Bahnhoefe-2026-06-16.xlsx` is attached alongside the patch — it is the file you
uploaded, renamed only to keep the path ASCII and shell-safe. Contents are
byte-identical; the generator records its SHA-256
(`a081b847d9a1d766…`) in `data/stations-master.report.json`.

---

## Verification — measured on a clean clone

| Gate | Before | After |
|---|---|---|
| `pnpm check` | 0 errors | **0 errors** |
| `pnpm lint` | 277 warnings | **271 warnings** (−6; 4 new files added 0) |
| `pnpm test:cov` | 5 passed / 6 skipped | **5 passed / 6 skipped** |
| `pnpm build:client` | 720.75 kB | **725.47 kB** (+4.72 kB) |
| `pnpm build:parallel` | ok | **ok** (server bundle 74 kB) |
| `pnpm verify:data` | — | **new gate, passes** (wired into CI) |

Reproducibility: `pnpm stations:check` regenerates in memory and exits non-zero on
drift — it passes. Running `pnpm data:normalize` a second time reports
**0 cells changed**, so both generators are idempotent.

Browser smoke test (headless Chromium against the production build, logged in as
admin): 1,298 projects render, the 14 department columns render, the map draws
425 markers, and the header reads
`417 STATIONEN · 852 EXAKT · 1.272/1.298 VERORTET` — the same numbers
`pnpm verify:data` prints. No console errors except OpenStreetMap tile fetches,
which the sandbox has no network route for.

---

## Decisions taken (you said "keep making the best decisions")

| # | Decision | Why |
|---|---|---|
| 1 | The 9 stations with no coordinates ship `lat: null`, are excluded from the map index, and are listed by name in the build report | Inventing coordinates is exactly the data drift the brief forbids. They are named in the report so someone can supply real ones. |
| 2 | `client/public/stations.json` = RB Mitte (919 rows); `stations-national.json` = all 5,426 | Keeps the hot path small; national data is present for expansion but fetched by nothing today. |
| 3 | Canonical BM vocabulary is the **form's** (`Frankfurt`), not the station master's (`Frankfurt a. M.`) | The only direction that does not orphan 330 existing Frankfurt projects from their own region filter. The VBA compares `Range("G9") = "Frankfurt"` literally. |
| 4 | HuBs stays a notification recipient, not a 15th department | A 15th department means backfilling 18,172 review rows. Deferred to Stage 2 as an explicit data-model decision. |
| 5 | Regenerated `data.json` is produced by the script, not shipped in the patch, with `data/normalize-report.json` listing every changed cell | 91 KB reviewable patch instead of 9 MB, and the change list is auditable before you commit. |
| 6 | Contacts (~50 real employee addresses) untouched | Stage 4. They must not land in a public static asset. |

---

## What the patch does

### New — `shared/bahnhofsmanagement.ts` (145 lines)

The single canonical BM vocabulary, derived from `Hilfsdatei!N17:N25` of the live
form. `normalizeBahnhofsmanagement()` is a pure function with a fixed resolution
order — canonical → alias → `"<BM> LOS <n>"` lot suffix → **null + `unmapped`**.
It never guesses: an unrecognised value returns `null` and is surfaced, so a new
spelling fails loudly instead of silently inventing a region.

Consumed by the two generators, `client.ts`, `useStations.ts`, `useDataQuery.ts`,
`shared/validation.ts` (`REGIONS` is now a re-export) and `shared/const.ts`.

### New — `scripts/generate-stations-master.ts` (450 lines)

```
data/Bahnhoefe-2026-06-16.xlsx  ─┐
                                 ├─→ client/public/stations.json           (919)
data/station-coordinates.json   ─┘   client/public/stations-national.json (5,426)
                                     data/stations-master.report.json
```

The **coordinate ledger** solves the determinism trap: the generator's coordinate
source used to be its own output, so a second run would have had nothing to
inherit from. On first run it bootstraps `data/station-coordinates.json` from the
pre-Stage-1 `stations.json` (909 pairs, each with provenance and the station name
at recording time), then reads that ledger forever after. The generator is now a
pure function of two tracked inputs and re-runnable.

It refuses to write on any invariant violation: non-canonical BM, duplicate
Bhf-Nr, half-coordinates, or coordinates outside Germany.

**Join result:**

```
Excel RB Mitte                918
+ retained retired              1   Bhf 2660 "Heimersheim" — gone from the 2026
                                    master, still referenced by project 519.
                                    Kept with retired: true so it resolves on the
                                    map but is hidden from the create dropdowns.
= stations.json               919   909 with coordinates, 10 without
BM mismatches                   0
station renames                27   e.g. 2753 Beerfelden-Hetzbach → Oberzent-Hetzbach
                                         4918 Pfeddersheim → Worms-Pfeddersheim
```

New fields: `Regionalbereich`, `Kategorie`, `DS100`, `exactMatch`, `retired?`.
`PLZ` is now a 5-char **string** so leading zeros survive nationally (`01067`).
`Land` / `DS100` / `Aufgabenträger` are absent from the 2026 Excel and are
inherited by exact Bhf-Nr from the previous master — `null` for the 9 new
stations, never guessed.

### New — `scripts/normalize-existing-data.ts` (340 lines)

**1,301 cells changed** across 1,298 projects — and the report separates them
honestly:

```
890  number → string type corrections   bahnhofsnummer (499) · streckennummer (390) · projektnummer (1)
411  real value changes                 projektleiter 108 · kommentar 91 · projektbeschreibung 75
                                        bahnhofsmanagement 60 · station 31 · projektstand 15 · projektLink 13
```

The 890 are not churn. `bahnhofsnummer` / `streckennummer` are declared
`string | null` in **every** layer — `useDataQuery.ts` `Project`,
`shared/validation.ts` `ProjectSchema`, `drizzle/schema.ts` `varchar(32)` — while
`data.json` stored many of them as JSON numbers. That mismatch is precisely what
commit `7c42b6d` ("coerce ALL searched fields to string — fixes numeric
projektnummer/Bhf/Strecken crash") had to work around inside the search filter.
Stage 1 fixes it at the source.

BM distribution afterwards, with the derived `stats.regionStats` and
`filters.regions` blocks recomputed from the rows so they cannot drift again:

```
Frankfurt 331 · Darmstadt 162 · Koblenz 148 · Kassel 131
Saarbrücken 112 · Kaiserslautern 104 · Mainz 97 · Gießen 87 · (126 without BM)
```

The dropdown-polluting values are gone: `???`, `Bitte auswählen`, `Saabrücken`,
`koblenz`, `Frankfurt `, `Gießen `, `Koblenz `, `Darmstadt LOS 1`,
`Koblenz LOS 2/3/4`. **0 unmapped values remain.**

Deliberately **not** changed, and reported instead:
station names are never rewritten to match the master (`"Fulda Hbf"` stays
`"Fulda Hbf"` — reconciliation is a map concern, not a stored-value one);
`projektstand` (81 distinct) and review `status` (15 distinct) vocabularies; and
the **278 `dd.mm.yyyy`** + 18 `"-"` values in `terminProjektvorstellung`. All
three are Stage 2, where the column types get settled.

### Rewritten — `client/src/lib/stationGeo.ts`

Four defects from Stage 0 fixed:

- **D2 — the `exact` boolean lied.** Replaced with
  `precision: "exact" | "tokens" | "fuzzy" | "region"` and a derived `isPrecise`.
  292 markers were previously drawn as precise when they were not.
- **D3 — cross-region false positives.** Every tier now runs inside the project's
  own BM first and only then across all regions. `Sulzbach` / BM `Saarbrücken` now
  resolves to **Sulzbach (Saar)** instead of Sulzbach (Taunus), ~150 km away.
- **D4 — dead centroid fallback.** Centroids are keyed by canonical BM, so they
  work for all 331 Frankfurt projects. Retired stations are excluded from the
  centroid so they cannot drag a region's average.
- **D1 — silent drops.** `resolveAll()` returns a precision histogram; the map
  renders the unplaceable count instead of `if (!r) continue`.

Two additions: a **token-set tier** (`"Hbf Mainz"` ↔ `"Mainz Hbf"`), and a
tie-break on **Bahnhofskategorie**. The old tie-break was file order, which sent
bare city names to arbitrary halts. Now:

```
"Koblenz" → Koblenz Hbf      (was Koblenz-Güls)
"Worms"   → Worms Hbf        (was Worms-Pfeddersheim)
"Hofheim" → Hofheim (Taunus) (was Hofheim (Ried))
```

**Coverage, measured on all 1,298 projects:**

| | Before | After |
|---|---|---|
| exact | 809 *(claimed)* | **852** *(true)* |
| token-set | — | 15 |
| fuzzy | 292 *(mislabelled exact)* | 309 |
| region centroid only | 93 | 96 |
| **silently dropped** | **104** | **26** |

The remaining 26 are correct refusals — `DHL Packstationen` (8), `Cluster 3`,
`Diverse`, `verschieden`, `S6-Ausbau Strecke Baustufe 1` — none of which is a
station, all with no BM.

### Other consumer changes

- **`useStations.ts`** — `bfNrByStation` (name-keyed, last-write-wins) became
  `bfNrByRegionStation` keyed by `(BM, Station)`. Station names are **not** unique
  across regions, so the old lookup could hand back another region's
  Bahnhofsnummer. Also adds `regionByStation` for names that are unique
  network-wide, an explicit `ambiguousStationNames` list, and `selectableRows`
  (retired excluded). Region order now follows the canonical list, so the dropdown
  matches the Projektanmeldung form exactly.
- **`Projects.tsx`** — cascade switched to the BM-scoped lookup.
- **`Map.tsx`** — three-colour precision encoding (red exact / amber reconciled /
  grey region), per-project precision counts (not per-marker), an amber
  "N ohne Station & ohne BM – nicht darstellbar" badge, popups showing the
  station's BM and the precision mix, `fitBounds` over all station-precision
  markers, and `aria-label` on the two icon-only map buttons.
- **`useDataQuery.ts`** — `useFilters` orders regions canonically and sorts names
  with `Intl.Collator("de")` instead of raw `sort()`.
- **`client.ts`** — `normalizeProjects` canonicalises BM as a second line of
  defence, and the localStorage key is now schema-versioned
  (`bahn_projects_v2`), with legacy keys purged on boot. Without this, every
  existing browser would keep its pre-normalisation copy forever (Stage 0 defect
  D11).
- **`shared/const.ts`** — `DATA_JSON_PATH` fixed from `public/data.json` to
  `client/public/data.json`. That one-word bug (Stage 0 defect D19) broke **all
  four** seed/sync entry points; Stage 2 needs it working.
- **`tsconfig.json`** — added `"target": "ES2022"`. tsc was defaulting to ES5 and
  rejecting every `[...map]` in type-checking. `noEmit` is true, so nothing that
  ships changes.
- **`.github/workflows/ci.yml`** — `pnpm verify:data` runs after lint.

### New — `scripts/verify-stations.ts` (CI gate)

Runs on committed artifacts only, so it needs no Excel file and no database:

```
S1 stations.json parses, non-empty, unique Bf. Nr.
S2 every BM is canonical
S3 no half-coordinates; every coordinate inside Germany
S4 (BM, Station) unique — the cascade can never be ambiguous
D1 every bahnhofsmanagement in data.json is canonical or null
D2 filters.regions and stats.regionStats agree with the rows they describe
D3 row counts unchanged (1,298 projects / 18,172 reviews)
G1 map coverage does not regress past the committed baseline
```

---

## Success criteria from the brief

| Criterion | Result |
|---|---|
| Filters no longer show dirty BM values | ✅ 19 values → 8, `0` unmapped |
| Map shows more complete RB Mitte coverage | ✅ dropped 104 → 26; exact 809 (claimed) → 852 (true) |
| Cascade still works | ✅ smoke-tested, and now BM-scoped so it cannot return a foreign Bahnhofsnummer |
| Quality gates green | ✅ check 0 · lint 271 (−6) · tests 5/6 · build ok |

---

## Found while working — going into later stages, not silently fixed

1. **`terminProjektvorstellung` mixes formats** — 278 `dd.mm.yyyy` + 18 `"-"` vs
   ISO. Drizzle types it `datetime`. Stage 2 blocker; listed in
   `data/normalize-report.json → deferredToStage2`.
2. **Two legends overlap** at `bottom-6 left-6 z-[1000]` — `Map.tsx:244` and
   `Projects.tsx:794`. Visible in the screenshot. Stage 5.
3. **Fabricated KPIs still on screen** — "Termingerecht 1116 / 86% im Zeitplan"
   is `Math.round(total * 0.86)`; "+12 seit letzter Woche" and the sidebar's
   "1.299 Projekte" are hardcoded. Stage 5.
4. **`PROJEKTSTAND_OPTIONS` (7) ≠ `PROJECT_STANDS` (18) ≠ `Hilfsdatei!N3:N12` (7,
   different)** — three incompatible phase vocabularies. Stage 2.
5. **Project 1298 "Wiesbaden HBF" is filed under BM Darmstadt** — Wiesbaden Hbf
   belongs to BM Frankfurt in the master. A handful of projects have a BM that
   contradicts their station's BM; 33 projects currently match a station outside
   their own BM. Worth a business review — I did not change any of them, because
   the project's BM may legitimately differ from the station's owner.

---

## Awaiting

**"Stage 1 accepted – proceed"** → Stage 2: shared types, Zod schemas and the
`projectChecklists` entity for the 22-question form, plus the drizzle migration
that closes the 5-column / 16-index drift found in Stage 0 (D18).
