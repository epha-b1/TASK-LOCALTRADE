#!/usr/bin/env bash
set -euo pipefail

DATABASE_URL="postgres://localtrade:localtrade@localhost:5432/localtrade"

backend_passed=0
backend_failed=0
backend_total=0
frontend_passed=0
frontend_failed=0
frontend_total=0

parse_vitest_counts() {
  python3 - "$1" <<'PY'
import re
import sys

path = sys.argv[1]
text = open(path, 'r', encoding='utf-8', errors='ignore').read()
text = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', text)
lines = [line for line in text.splitlines() if 'Tests' in line]
line = lines[-1] if lines else ''

passed = 0
failed = 0
total = 0

m = re.search(r'(\d+)\s+passed', line)
if m:
    passed = int(m.group(1))

m = re.search(r'(\d+)\s+failed', line)
if m:
    failed = int(m.group(1))

m = re.search(r'\((\d+)\)', line)
if m:
    total = int(m.group(1))
else:
    total = passed + failed

print(f"{passed} {failed} {total}")
PY
}

echo "Starting postgres test dependency..."
docker compose up -d postgres

echo "Installing backend dependencies..."
npm --prefix backend ci

echo "Running backend migrations..."
DATABASE_URL="$DATABASE_URL" npm --prefix backend run migrate

echo "Seeding backend users/roles..."
DATABASE_URL="$DATABASE_URL" npm --prefix backend run seed

echo "Running backend tests..."
backend_log="$(mktemp)"
set +e
DATABASE_URL="$DATABASE_URL" npm --prefix backend test | tee "$backend_log"
backend_status=${PIPESTATUS[0]}
set -e
read -r backend_passed backend_failed backend_total < <(parse_vitest_counts "$backend_log")

echo "Installing frontend dependencies..."
npm --prefix frontend ci

echo "Running frontend tests..."
frontend_log="$(mktemp)"
set +e
npm --prefix frontend test -- --watch=false | tee "$frontend_log"
frontend_status=${PIPESTATUS[0]}
set -e
read -r frontend_passed frontend_failed frontend_total < <(parse_vitest_counts "$frontend_log")

echo "Running frontend build check..."
npm --prefix frontend run build

total_passed=$((backend_passed + frontend_passed))
total_failed=$((backend_failed + frontend_failed))
total_tests=$((backend_total + frontend_total))

echo "Tests: ${total_passed} passed, ${total_failed} failed, ${total_tests} total"

if [ "$backend_status" -ne 0 ] || [ "$frontend_status" -ne 0 ] || [ "$total_failed" -ne 0 ]; then
  exit 1
fi

exit 0
