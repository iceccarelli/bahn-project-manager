#!/usr/bin/env bash
# Start the PRODUCTION bundle (dist/index.js) for LOCAL load tests with a local mock IdP (scripts/load/mock-idp.mjs).
# Extra env passes through (e.g. REDIS_URL=redis://127.0.0.1:6390, PORT=3101). Logs: $LOG (default /tmp/bahn-load-server.log).
# Authentication is OIDC bearer only (production has no demo login / cookie sessions):
#   TOKEN=$(curl -s "http://127.0.0.1:${IDP_PORT:-3290}/token?role=admin&workspaces=ALL&oid=load-admin")
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${JWT_SECRET:?set JWT_SECRET (>=32 chars)}"
IDP_PORT=${IDP_PORT:-3290}
nohup node scripts/load/mock-idp.mjs --port "$IDP_PORT" --aud load > "${IDP_LOG:-/tmp/bahn-load-idp.log}" 2>&1 &
echo $! > "${IDP_PIDFILE:-/tmp/bahn-load-idp.pid}"
export NODE_ENV=production PORT=${PORT:-3100} DB_POOL_SIZE=${DB_POOL_SIZE:-20}
export OIDC_ISSUER="http://127.0.0.1:$IDP_PORT/" OIDC_AUDIENCE=load OIDC_JWKS_URI="http://127.0.0.1:$IDP_PORT/jwks"
[ -n "${REDIS_URL:-}" ] || export ALLOW_SINGLE_INSTANCE=1   # one local node without Redis; any multi-instance run must set REDIS_URL
export DATABASE_URL=${DATABASE_URL:-mysql://bahn:bahn@127.0.0.1:3306/bahn_load}
export RT_MAX_PER_PRINCIPAL=${RT_MAX_PER_PRINCIPAL:-100000} RT_MAX_CONNECTIONS=${RT_MAX_CONNECTIONS:-100000} METRICS_TOKEN=${METRICS_TOKEN:-lt}
nohup node --max-old-space-size=${HEAP_MB:-4096} dist/index.js > "${LOG:-/tmp/bahn-load-server.log}" 2>&1 &
echo $! > "${PIDFILE:-/tmp/bahn-load-server.pid}"
for _ in $(seq 1 40); do curl -fs "localhost:$PORT/api/ready" >/dev/null 2>&1 && { echo "up pid $(cat ${PIDFILE:-/tmp/bahn-load-server.pid}) port $PORT idp :$IDP_PORT"; exit 0; }; sleep 0.25; done
echo "server failed to start"; tail -20 "${LOG:-/tmp/bahn-load-server.log}"; exit 1
