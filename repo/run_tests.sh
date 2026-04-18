#!/usr/bin/env bash
# Strict Docker-only test runner.
# Runs backend unit + API integration, frontend unit + build, and FE↔BE E2E
# entirely inside docker-compose. No host-side Node, npm, or psql is used.
#
# Uses high, isolated host ports by default so this script can run on a
# machine that already has containers on 3000 / 4200 / 5432. Override any of
# the three if you need different values.

set -euo pipefail

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-localtrade}"
POSTGRES_PORT="${POSTGRES_PORT:-55432}"
API_PORT="${API_PORT:-33000}"
FRONTEND_PORT="${FRONTEND_PORT:-44200}"
export COMPOSE_PROJECT_NAME POSTGRES_PORT API_PORT FRONTEND_PORT

# Prefer the modern `docker compose` (v2+); fall back to legacy `docker-compose`.
if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
else
  DC=(docker-compose)
fi

cleanup() {
  echo
  echo "Stopping stack..."
  "${DC[@]}" -p "$COMPOSE_PROJECT_NAME" --profile test down --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "===> Backend unit + API integration tests (Docker, postgres only)..."
# Bring up ONLY postgres: the backend-tests container starts its own
# in-process Fastify server. Running the api container in parallel would
# cause its worker scheduler to race with the test's in-process worker
# over the shared jobs table.
"${DC[@]}" -p "$COMPOSE_PROJECT_NAME" up -d postgres
"${DC[@]}" -p "$COMPOSE_PROJECT_NAME" --profile test run --rm backend-tests

echo
echo "===> Frontend unit tests + production build (Docker)..."
"${DC[@]}" -p "$COMPOSE_PROJECT_NAME" --profile test run --rm frontend-tests

echo
echo "===> Starting full stack (postgres + api + frontend) for E2E..."
"${DC[@]}" -p "$COMPOSE_PROJECT_NAME" up -d postgres api frontend

echo
echo "===> FE↔BE E2E (Docker, real proxy round-trip)..."
"${DC[@]}" -p "$COMPOSE_PROJECT_NAME" --profile test run --rm e2e

echo
echo "All test suites passed."
