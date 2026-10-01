#!/usr/bin/env bash
# Container gate: proves the PRODUCTION IMAGE (not a stand-in) against real MySQL 8.4 + Redis 7.
#   IMAGE=bahn-project-manager:ci CI_DATABASE_URL=mysql://root:root@127.0.0.1:3306/bahn_ci \
#   CI_REDIS_URL=redis://127.0.0.1:6379 scripts/gate/container-ci.sh
# The containers run with --network host so they reach the CI service containers on 127.0.0.1.
#
# This harness supplies the configuration the production image legitimately requires. It does NOT weaken
# the image's own validation — step 1 asserts that the image still refuses to boot without it.
# Anything that fails here is a real container failure.
set -euo pipefail
IMAGE=${IMAGE:?IMAGE required}
DATABASE_URL=${CI_DATABASE_URL:?CI_DATABASE_URL required}
REDIS_URL=${CI_REDIS_URL:?CI_REDIS_URL required}
PORT=${CI_PORT:-3000}
NAME=bpm-ci
ENVS=(-e NODE_ENV=production -e PORT="$PORT" -e DATABASE_URL="$DATABASE_URL" -e REDIS_URL="$REDIS_URL"
      -e JWT_SECRET=ci-only-not-a-secret-0123456789abcdef0123456789abcdef
      -e OIDC_ISSUER=https://idp.ci.invalid/v2.0 -e OIDC_AUDIENCE=api://bahn-ci)
step() { printf '\n== %s\n' "$*"; }
fail() { echo "FAIL: $*" >&2; docker logs "$NAME" 2>&1 | tail -40 >&2 || true; exit 1; }
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

step "1. image refuses to boot without production configuration (validation intact)"
set +e; OUT=$(docker run --rm --network host -e NODE_ENV=production -e PORT="$PORT" "$IMAGE" 2>&1); RC=$?; set -e
[ "$RC" -ne 0 ] && grep -q "Unsafe production configuration" <<<"$OUT" || { echo "$OUT"; fail "image booted (or failed differently) without required configuration (rc=$RC)"; }
echo "refused as expected (rc=$RC)"

step "2. migrations (node dist/migrate.js), twice — must be idempotent"
for i in 1 2; do
  docker run --rm --network host "${ENVS[@]}" "$IMAGE" node dist/migrate.js 2>&1 | tee /tmp/migrate.$i.log | tail -3
  grep -q "migrations applied" /tmp/migrate.$i.log || fail "migration run $i did not complete"
done
TABLES=$(docker run --rm --network host "${ENVS[@]}" "$IMAGE" node -e "
import('mysql2/promise').then(async m=>{const c=await m.createConnection(process.env.DATABASE_URL);
const [r]=await c.query('SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=DATABASE()');
const [v]=await c.query('SELECT VERSION() v');console.log(r[0].n+' '+v[0].v);await c.end()})")
echo "tables/version: $TABLES"
[ "${TABLES%% *}" -ge 10 ] || fail "too few tables after migration: $TABLES"
[[ "$TABLES" == *" 8.4."* ]] || fail "database is not MySQL 8.4: $TABLES"

step "3. boot with production configuration"
docker run -d --name "$NAME" --network host "${ENVS[@]}" "$IMAGE" >/dev/null
for _ in $(seq 1 45); do
  [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" = true ] || fail "container exited during boot"
  curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/api/health" || fail "/api/health never answered"; echo
READY=$(curl -fsS "http://127.0.0.1:$PORT/api/ready") || fail "/api/ready not 200"
echo "ready: $READY"
grep -q '"db":"ok"' <<<"$READY" && grep -q '"redis":"ok"' <<<"$READY" || fail "ready did not prove DB + Redis connectivity"

step "4. the image serves the PRODUCTION artifact (server data plane, no demo)"
INFO=$(curl -fsS "http://127.0.0.1:$PORT/build-info.json") || fail "build-info.json not served"
echo "$INFO"
grep -q '"target":"production"' <<<"$INFO" && grep -q '"serverMode":true' <<<"$INFO" || fail "image does not contain a production, server-mode client"
curl -fsS "http://127.0.0.1:$PORT/projects" | grep -qi "<div id=\"root\"" || fail "SPA index not served"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/trpc/auth.session"); echo "unauthenticated tRPC -> $CODE"
curl -sI "http://127.0.0.1:$PORT/" | grep -qi '^content-security-policy' || fail "CSP header missing"

step "5. graceful shutdown (SIGTERM -> drain -> exit 0, well inside the grace period)"
T0=$(date +%s); docker stop -t 15 "$NAME" >/dev/null; T1=$(date +%s)
EXIT=$(docker inspect -f '{{.State.ExitCode}}' "$NAME"); LOGS=$(docker logs "$NAME" 2>&1)
echo "exit=$EXIT after $((T1-T0))s"
[ "$EXIT" = 0 ] || fail "container did not exit 0 on SIGTERM (exit=$EXIT)"
[ $((T1-T0)) -lt 12 ] || fail "shutdown took $((T1-T0))s (SIGTERM not handled?)"
grep -q "SIGTERM received" <<<"$LOGS" || fail "no drain log line"

echo; echo "container gate: PASS"
