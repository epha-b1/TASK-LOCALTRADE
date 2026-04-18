# LocalTrade Marketplace

**Project type:** fullstack

Offline-first, on-prem, role-based local marketplace. The entire runtime —
database, backend API, and Angular web frontend — runs inside Docker.
No host-side language runtime, package install, or database client is
required to run, verify, or test the project.

---

## Start the stack

```bash
docker-compose up
```

Detached / teardown variants (optional, same command family):

```bash
docker-compose up -d        # run in background
docker-compose down         # stop and remove containers
```

### Isolated project profile (recommended on shared hosts)

Use the `localtrade73` project label and the dedicated host ports so this
stack never collides with any other Docker project running on the same
machine:

```bash
POSTGRES_PORT=55432 API_PORT=33000 FRONTEND_PORT=44200 \
  docker-compose -p localtrade73 up -d postgres

# Same profile for the full stack:
POSTGRES_PORT=55432 API_PORT=33000 FRONTEND_PORT=44200 \
  docker-compose -p localtrade73 up -d
```

`bash run_tests.sh` uses exactly this profile by default.

---

## Access

Once the stack is up:

| Service | URL |
| --- | --- |
| Web frontend | http://localhost:4200 |
| Backend API | http://localhost:3000 |
| API docs (OpenAPI / Swagger UI) | http://localhost:3000/docs |
| Liveness probe | http://localhost:3000/health/live |
| Readiness probe (checks DB) | http://localhost:3000/health/ready |

PostgreSQL is on the compose network only (`postgres:5432`) and is **not**
exposed to the host by default.

---

## Demo credentials

Authentication is required for all role-based flows. Use these seed accounts:

| Role | Email | Password |
| --- | --- | --- |
| Buyer | `buyer@localtrade.test` | `buyer` |
| Seller | `seller@localtrade.test` | `seller` |
| Moderator | `moderator@localtrade.test` | `moderator` |
| Arbitrator | `arbitrator@localtrade.test` | `arbitrator` |
| Admin | `admin@localtrade.test` | `admin` |

Public endpoints (storefront listings, review detail, registration, login,
signed download URL) do not require authentication.

---

## Verification

### 1. Quick API smoke (from any host with docker-compose up running)

Use the containerized shell — no host `curl`/`jq` assumed:

```bash
docker-compose exec api sh -c \
  'wget -q -O- http://localhost:3000/health/ready'
# → {"ok":true}
```

Log in as seller and list own listings (all through the API container):

```bash
docker-compose exec api sh -c '
  TS=$(date +%s) &&
  wget -q --header "Content-Type: application/json" \
       --header "X-Request-Nonce: readme-$RANDOM" \
       --header "X-Request-Timestamp: $TS" \
       --post-data={\"email\":\"seller@localtrade.test\",\"password\":\"seller\"} \
       -O- http://localhost:3000/api/auth/login'
```

### 2. End-to-end Web/UI flow

1. Open http://localhost:4200.
2. Log in as **seller** (`seller@localtrade.test` / `seller`).
3. **My Listings → New listing.** Fill title, description, price, quantity.
4. **Upload.** Drag JPG/PNG/MP4/PDF files (≤ 2 GB each, ≤ 20 per listing).
   Wait for each upload's status to reach `ready`.
5. **Publish** the listing.
6. Log out. Log back in as **buyer** (`buyer@localtrade.test` / `buyer`).
7. **Browse Listings → View & Order.** Pick a quantity, place the order.
8. **My Orders** should show the order with correct totals.

### 3. Automated verification (see [Testing](#testing))

```bash
# Brings up the stack and runs all test suites inside containers.
bash run_tests.sh
```

---

## Testing

All test suites run **inside Docker** via the `test` compose profile — no
host-side `npm install`, `node`, or `psql` is needed.

### Run every suite

```bash
bash run_tests.sh
```

`run_tests.sh` brings up the stack, runs backend unit + API integration,
frontend unit + build, and end-to-end FE↔BE tests — then tears down.

### Run an individual suite

```bash
# Backend unit + API integration (DB-backed, real HTTP, no mocks)
docker-compose --profile test run --rm backend-tests

# Frontend unit tests + production build
docker-compose --profile test run --rm frontend-tests

# End-to-end: login → core action → round-trip through nginx proxy
docker-compose --profile test run --rm e2e
```

What each suite validates:

- **backend-tests** — domain invariants (refund threshold, review window,
  publish gate, credit metrics), JWT / HMAC / signed URLs, worker retry
  lifecycle, and every HTTP endpoint via a real bound TCP port (no
  `app.inject` bypass, no repository/service mocks).
- **frontend-tests** — Angular components (auth, listings, orders,
  reviews, moderation, arbitration, admin), core HTTP interceptors,
  toast service, role-based guards, and the production build.
- **e2e** — spins through the frontend nginx container to confirm
  `/api/*` requests are proxied to the backend, exercising a real
  FE↔BE↔DB round trip (login → list → create listing → verify
  persistence).

---

## Encrypted backups and restore

- Admin backup jobs are produced by `POST /api/admin/backups/run` and
  processed by the worker.
- Encrypted files are written to `MEDIA_ROOT_PATH/backups/` with format
  `backup-YYYY-MM-DD-<timestamp>.sql.enc` (AES-256-GCM).
- Files older than 30 days are pruned automatically.
- **RTO:** 4 hours from backup selection to verified API readiness.

### Restore procedure (Docker-contained)

```bash
# 1) Stop writes (or stop the api service).
docker-compose stop api

# 2) Decrypt the backup inside the api container with the ENCRYPTION_KEY_HEX
#    that was active at backup time, then pipe into the postgres container.
docker-compose exec -T api sh -c \
  'node -e "…decrypt script using ENCRYPTION_KEY_HEX…" < /var/localtrade/media/backups/backup-<date>.sql.enc' \
  | docker-compose exec -T postgres psql -U localtrade -d localtrade

# 3) Restart the api and verify readiness.
docker-compose start api
docker-compose exec api sh -c 'wget -q -O- http://localhost:3000/health/ready'
# → {"ok":true}
```

Decryption utility is shipped in the api image at
`/app/dist/scripts/decrypt-backup.js` (or run via `docker-compose exec api`
with Node directly). Keeping the whole restore flow containerized means
the same `ENCRYPTION_KEY_HEX` used by the api service is reused — no host
Node, no host `psql`.

---

## Environment policy (strict)

- **Docker-contained.** Every required path (run, verify, test, restore)
  runs inside the compose stack. No host-side `npm install`, `node`,
  `psql`, or other language runtime is used or required.
- **Production secrets.** In production deployments you **must** set:
  - `NODE_ENV=production`
  - `JWT_SECRET` — ≥ 32 random characters
  - `SIGNED_URL_SECRET` — ≥ 32 random characters
  - `ENCRYPTION_KEY_HEX` — exactly 64 hex characters (32 bytes)
  - `CORS_ALLOWED_ORIGINS` — comma-separated allow-list
  The api refuses to start with the development defaults while
  `NODE_ENV=production`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `docker-compose up` reports `port is already allocated` on 3000/4200/5432 | another local service holds the port | remap with env vars, e.g. `POSTGRES_PORT=55432 API_PORT=33000 FRONTEND_PORT=44200 docker-compose up` (all three are overridable — see `docker-compose.yml`). `bash run_tests.sh` already sets these high ports by default. |
| API logs `pool: cannot connect` on boot | Postgres is still initializing | compose waits for `pg_isready` via the healthcheck; if you bypassed it, re-run `docker-compose up` |
| Frontend shows CORS errors | `CORS_ALLOWED_ORIGINS` doesn't include the origin you're hitting | set `CORS_ALLOWED_ORIGINS=http://localhost:4200` (or your LAN IP) in compose env and restart the api |
| Integration tests fail with `relation ... does not exist` | DB volume was wiped between runs | `docker-compose --profile test run --rm backend-tests` — it re-migrates and re-seeds before testing |
| API refuses to start in production with `INSECURE_DEFAULT_SECRETS` | default dev secrets still in effect | set all variables listed under **Environment policy** |
| `e2e` fails with `Timed out waiting for …` | frontend or api not yet healthy when e2e started | run `docker-compose up -d` first, wait a few seconds, then `docker-compose --profile test run --rm e2e` |

---

## Reference

- API reference (OpenAPI): http://localhost:3000/docs
- Business-logic questions log: [`docs/business-logic-questions-log.md`](docs/business-logic-questions-log.md) (also available as [`docs/questions.md`](docs/questions.md) for backwards-compat)
- Source layout: `backend/` (Fastify + TypeScript), `frontend/` (Angular),
  `e2e/` (vitest + real-proxy round-trip suite).
