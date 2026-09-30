#!/usr/bin/env bash
# "Container equivalent" check for environments without a Docker daemon: install ONLY production
# dependencies into an empty directory (what the runtime image contains), copy the built artifact
# in, boot it, and probe it. Catches devDependency imports and missing runtime packages — the
# failure class that killed the container on its first line before (see scripts/doctor.mjs).
#   scripts/gate/container-sim.sh dist-e2e   (defaults to dist-e2e)
set -euo pipefail
cd "$(dirname "$0")/../.."
ART=${1:-dist-e2e}
TMP=$(mktemp -d); trap 'kill ${PID:-0} 2>/dev/null || true; rm -rf "$TMP"' EXIT
cp package.json pnpm-lock.yaml "$TMP"/ && cp -r patches "$TMP"/patches
( cd "$TMP" && CI=1 pnpm install --prod --frozen-lockfile --ignore-scripts >/dev/null 2>&1 ) || { echo '{"check":"container-sim","ok":false,"why":"prod install failed"}'; exit 1; }
cp -r "$ART" "$TMP/dist"
PORT=${SIM_PORT:-3390}
( cd "$TMP" && NODE_ENV=production PORT=$PORT DATABASE_URL=${SIM_DATABASE_URL:?set SIM_DATABASE_URL} JWT_SECRET=$(printf 'x%.0s' $(seq 1 48)) \
  OIDC_ISSUER=http://127.0.0.1:1/ OIDC_AUDIENCE=sim METRICS_TOKEN=sim node dist/index.js > "$TMP/out.log" 2>&1 ) &
PID=$!
for _ in $(seq 1 60); do curl -fs "localhost:$PORT/api/ready" >/dev/null 2>&1 && break; sleep 0.5; done
READY=$(curl -s -o /dev/null -w '%{http_code}' "localhost:$PORT/api/ready" || true)
HEALTH=$(curl -s -o /dev/null -w '%{http_code}' "localhost:$PORT/api/health" || true)
INDEX=$(curl -s -o /dev/null -w '%{http_code}' "localhost:$PORT/projects" || true)
CSP=$(curl -sI "localhost:$PORT/" | grep -ci '^content-security-policy' || true)
MET=$(curl -s -o /dev/null -w '%{http_code}' -H 'authorization: Bearer sim' "localhost:$PORT/api/metrics" || true)
MODS=$(du -sm "$TMP/node_modules" | cut -f1)
BAD=$(grep -ci "Cannot find package\|ERR_MODULE_NOT_FOUND" "$TMP/out.log" || true)
OK=false; [ "$READY" = 200 ] && [ "$HEALTH" = 200 ] && [ "$INDEX" = 200 ] && [ "$CSP" = 1 ] && [ "$MET" = 200 ] && [ "$BAD" = 0 ] && OK=true
printf '{"check":"container-sim","ok":%s,"ready":%s,"health":%s,"spaIndex":%s,"cspHeader":%s,"metrics":%s,"missingModuleErrors":%s,"prodNodeModulesMB":%s}\n' "$OK" "$READY" "$HEALTH" "$INDEX" "$CSP" "$MET" "$BAD" "$MODS"
$OK
