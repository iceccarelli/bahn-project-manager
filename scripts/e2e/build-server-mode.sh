#!/usr/bin/env bash
# Build the SERVER-MODE artifact into dist-e2e/: bundle + client (VITE_SERVER_MODE=1). Same commands CI/staging use.
set -euo pipefail
cd "$(dirname "$0")/../.."
rm -rf dist-e2e && mkdir -p dist-e2e
pnpm exec esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist-e2e --splitting >/dev/null
VITE_SERVER_MODE=1 pnpm exec vite build --outDir "$PWD/dist-e2e/public" --emptyOutDir >/dev/null
ls dist-e2e | head; du -sh dist-e2e/public | cut -f1
