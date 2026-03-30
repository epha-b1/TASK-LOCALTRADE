# LocalTrade Task Workspace

## Start the stack

No `.env` setup is required for local development.

```bash
docker compose up
```

## Service addresses

- Frontend: `http://localhost:4200`
- API: `http://localhost:3000`
- API readiness health check: `http://localhost:3000/health/ready`

## Test credentials by role

- Buyer: `buyer@localtrade.test` / `buyer`
- Seller: `seller@localtrade.test` / `seller`
- Moderator: `moderator@localtrade.test` / `moderator`
- Arbitrator: `arbitrator@localtrade.test` / `arbitrator`
- Admin: `admin@localtrade.test` / `admin`

## Run tests

```bash
bash run_tests.sh
```

## Encrypted backups and restore

- Admin backup jobs are processed by the worker and produce encrypted files at `MEDIA_ROOT_PATH/backups/`.
- File format: `backup-YYYY-MM-DD-<timestamp>.sql.enc`.
- Backups older than 30 days are deleted automatically.
- Restore time objective (RTO): 4 hours from backup selection to verified API readiness.

### Restore procedure

1. Stop API writes (put API into maintenance mode or stop the API service).
2. Decrypt the backup file with the same `ENCRYPTION_KEY_HEX` used at backup time.
3. Restore into PostgreSQL using `psql`:

```bash
psql "$DATABASE_URL" < decrypted-backup.sql
```

4. Restart API and verify readiness with `http://localhost:3000/health/ready`.

## Verification flow (login to order)

1. Start services with `docker compose up`.
2. Open `http://localhost:4200`.
3. Log in as seller (`seller@localtrade.test` / `seller`).
4. Go to **My Listings**, create a listing, then go to **Upload** and upload at least one asset.
5. Publish the listing after the upload is ready.
6. Log out and log in as buyer (`buyer@localtrade.test` / `buyer`).
7. Open **Browse Listings**, click **View & Order**, choose quantity, and place the order.
8. Open **My Orders** and confirm the order appears with status and totals.

## Production Deployment

The backend blocks startup if insecure default secrets are used outside
development/test mode. Before deploying to production, ensure the following
environment variables are set to strong random values:

- `NODE_ENV=production`
- `JWT_SECRET` — minimum 32 random characters
- `SIGNED_URL_SECRET` — minimum 32 random characters
- `ENCRYPTION_KEY_HEX` — exactly 64 hex characters (32 bytes)
- `CORS_ALLOWED_ORIGINS` — comma-separated list of allowed frontend origins
  (e.g. `http://192.168.1.100:4200`)

If `NODE_ENV` is not set to `production`, the secret guard does not activate and
default secrets remain in effect. Always set `NODE_ENV=production` in production
deployments.
