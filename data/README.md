# `data/` — authoritative source files and generated reports

Everything the station master is derived from, plus the reports each generator
emits. Nothing here is served to the browser; the browser-facing artifacts are
`client/public/stations.json` and `client/public/stations-national.json`.

## Files

| File | Tracked | Produced by | Purpose |
|---|---|---|---|
| `Bahnhoefe-2026-06-16.xlsx` | yes (binary) | DB InfraGO | Official national station master: 5,426 stations, 8 columns, **no coordinates**. Replace this file when DB publishes a new edition, then re-run the generator. |
| `station-coordinates.json` | yes | `generate-stations-master.ts`, once | Coordinate ledger, `Bhf-Nr -> {lat, lng, source, name}`. Bootstrapped from the pre-Stage-1 `stations.json` (909 pairs) and tracked from then on, so the generator stays a pure function of its inputs and can be re-run after it has overwritten its own output. |
| `stations-master.report.json` | yes | `pnpm stations:generate` | Row counts, checksums, BM distribution, and the explicit list of stations without coordinates and of retired stations. |
| `normalize-report.json` | yes | `pnpm data:normalize` | Every changed cell in `data.json` (before -> after), plus the diagnostics deferred to later stages. |

## Regenerating

```bash
pnpm stations:generate     # xlsx + ledger -> client/public/stations{,-national}.json
pnpm data:normalize        # canonicalise client/public/data.json against the master
pnpm verify:data           # integrity gate (also runs in CI)
```

`pnpm stations:check` regenerates in memory and exits non-zero if the committed
output has drifted from its inputs.

## Adding coordinates for a new station

Stations added by DB after the ledger was created ship with `lat: null` /
`lng: null` and are excluded from the map index — **never** approximated. To
place one, add its entry to `station-coordinates.json` with an honest `source`
value and re-run `pnpm stations:generate`.

## Provenance

`Bahnhoefe-2026-06-16.xlsx` is the file distributed as
`Bahnhöfe-2026-06-16 (1).xlsx`. It is renamed only to keep the path ASCII and
shell-safe; the contents are byte-identical, and the generator records its
SHA-256 in `stations-master.report.json`.
