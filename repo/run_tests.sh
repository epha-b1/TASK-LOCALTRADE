#!/usr/bin/env bash
# Strict Docker-only test runner.
# Runs backend unit + API integration, frontend unit + build, and FE↔BE E2E
# entirely inside docker-compose. No host-side Node, npm, or psql is used.

set -euo pipefail

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-localtrade}"
export COMPOSE_PROJECT_NAME

cleanup() {
  echo
  echo "Stopping stack..."
  docker-compose -p "$COMPOSE_PROJECT_NAME" --profile test down --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "===> Starting stack (postgres + api + frontend)..."
docker-compose -p "$COMPOSE_PROJECT_NAME" up -d postgres api frontend

echo
echo "===> Backend unit + API integration tests (Docker)..."
docker-compose -p "$COMPOSE_PROJECT_NAME" --profile test run --rm backend-tests

echo
echo "===> Frontend unit tests + production build (Docker)..."
docker-compose -p "$COMPOSE_PROJECT_NAME" --profile test run --rm frontend-tests

echo
echo "===> FE↔BE E2E (Docker, real proxy round-trip)..."
docker-compose -p "$COMPOSE_PROJECT_NAME" --profile test run --rm e2e

echo
echo "All test suites passed."
