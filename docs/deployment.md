# LocalTrade Deployment Guide

## 1. Docker Startup Guide

### Prerequisites
- Docker Engine + Docker Compose plugin installed.
- Local storage mount paths available for media and backups.

### Start Services
```bash
cp .env.example .env
docker compose up --build
```

- Compose reads runtime secrets from `.env` via `env_file`.
- Keep `.env` local-only; it is ignored by git and docker build contexts.

### Services
- `postgres`: PostgreSQL database.
- `api`: Fastify backend.
- `worker`: async jobs processor.
- `frontend`: Angular app host.

### Health Checks
- API live: `http://localhost:3000/health/live`
- API ready: `http://localhost:3000/health/ready`
- Frontend: `http://localhost:4200`

## 2. Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| NODE_ENV | yes | `development`/`production` |
| API_PORT | yes | Fastify listen port |
| DATABASE_URL | yes | PostgreSQL connection string |
| JWT_SECRET | yes | JWT signing secret |
| JWT_ACCESS_TTL_SEC | yes | Access token TTL seconds |
| JWT_REFRESH_TTL_SEC | yes | Refresh token TTL seconds |
| RATE_LIMIT_PER_MIN | yes | Requests per minute per user (default 60) |
| ENCRYPTION_KEY_HEX | yes | 32-byte AES key (hex) |
| MEDIA_ROOT_PATH | yes | On-prem object storage path |
| BACKUP_ROOT_PATH | yes | Backup output path |
| SIGNED_URL_SECRET | yes | HMAC secret for asset URL signing |
| SIGNED_URL_TTL_MIN | no | Signed URL lifetime minutes (default 15) |
| WEBHOOK_ALLOWED_CIDRS | yes | Comma-separated local CIDRs |
| WEBHOOK_TIMEOUT_MS | no | Outbound webhook timeout |
| NONCE_WINDOW_SEC | no | Replay window, default 300 |

## 3. Backup and Restore
- Nightly backup job runs from scheduler/cron container.
- Keeps 30 encrypted snapshots.
- Restore process:
  1. Stop API + worker.
  2. Restore PostgreSQL dump.
  3. Restore media directory snapshot.
  4. Run integrity verification.
  5. Start services and run smoke tests.

## 4. Operational Commands
```bash
# run tests
./run_tests.sh

# view api logs
docker compose logs -f api

# manual backup trigger
docker compose exec api npm run backup
```
