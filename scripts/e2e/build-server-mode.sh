#!/usr/bin/env bash
# Build the SERVER-MODE artifact into dist-e2e/: bundle + client (VITE_SERVER_MODE=1). Same commands CI/staging use.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=${OUT:-dist-e2e}  # VITE_OIDC_* in the environment are baked into the client (real sign-in build)
node scripts/data/stage-public-data.mjs
rm -rf "$OUT" && mkdir -p "$OUT"
pnpm exec esbuild server/_core/index.ts server/_core/migrate.ts --platform=node --packages=external --bundle --format=esm --outdir="$OUT" --splitting >/dev/null
BUILD_TARGET=production VITE_SERVER_MODE=1 pnpm exec vite build --outDir "$PWD/$OUT/public" --emptyOutDir >/dev/null
ls "$OUT" | head; du -sh "$OUT/public" | cut -f1
