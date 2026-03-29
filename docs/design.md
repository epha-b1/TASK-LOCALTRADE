# LocalTrade System Design

## 1. Architecture Overview
LocalTrade is a modular monolith with clear domain boundaries:
- Frontend: Angular SPA (offline-capable with service worker and local caching of pending actions).
- Backend: Fastify REST API with domain plugins.
- Database: PostgreSQL for transactional state and queue persistence.
- Object Storage: on-prem filesystem/NAS mount for media binaries.
- Workers: Node worker process polling PostgreSQL job tables.

## 2. Runtime Components
- `api`: Fastify server, auth, RBAC, validation, domain routes.
- `worker`: async job executor (metadata extraction/transcode/compression/content scan).
- `scheduler`: periodic tasks (stale-job recovery, backup trigger, cleanup).
- `frontend`: Angular client served by Node/NGINX container.
- `postgres`: primary data store.

## 3. Module Breakdown
- `auth`: login, JWT issue/refresh, password hashing, nonce replay checks.
- `users`: profile, status, role assignment, seller deactivation cascade.
- `listings`: CRUD, lifecycle transitions, publish checks.
- `media`: upload sessions/chunks/finalize/signed download URLs.
- `assets`: metadata state, fingerprint tracking, content scan outcomes.
- `jobs`: queue management and workers.
- `orders`: placement, cancellation, completion flow.
- `payments`: tender capture, settlement imports, reconciliation.
- `refunds`: initiation, approval, confirmation/reversal.
- `reviews`: verified reviews, ranking and metrics.
- `appeals`: seller appeal lifecycle, arbitrator decisions.
- `moderation`: moderation queue and decisions.
- `content-safety`: deterministic rules/fingerprint checks.
- `storefront`: buyer listing/review read models + credit metrics.
- `audit-logs`: immutable event ledger.
- `admin`: platform config, rules, webhooks, maintenance.

## 4. Key State Machines

### 4.1 Listing State Machine
- `draft` -> `flagged` (auto safety trigger)
- `draft` -> `published` (seller publish; all checks pass)
- `flagged` -> `draft` (moderator approves)
- `published` -> `removed` (seller unpublish/admin/deactivation)

### 4.2 Asset State Machine
- `uploading` -> `uploaded` (all chunks assembled)
- `uploaded` -> `processing` (job queued)
- `processing` -> `ready` (metadata/transcode complete)
- `processing` -> `failed` (max retries exhausted)
- any -> `blocked` (safety/fingerprint violation)

### 4.3 Order State Machine
- `placed` -> `payment_captured`
- `placed` -> `cancelled`
- `payment_captured` -> `completed`
- `payment_captured|completed` -> `refunded`

### 4.4 Refund State Machine
- `pending` -> `approved`
- `pending` -> `rejected`
- `approved` -> `confirmed` (import/reconciliation confirmation)

### 4.5 Appeal State Machine
- `open` -> `in_review` -> `resolved_uphold|resolved_modify|resolved_remove`

## 5. Major Flows

### 5.1 Resumable Upload Flow
1. Seller creates upload session with asset metadata.
2. Client sends chunks (`5 MB`) with chunk index.
3. Server writes chunk blob and dedups repeated chunks by `(session_id, chunk_index)`.
4. Finalize assembles file and runs MIME sniff + extension + size + fingerprint checks.
5. If valid, move to object store and enqueue metadata/transcode jobs.
6. Asset becomes `ready`; listing publish gate recalculates.

### 5.2 Listing Publish Flow
1. Seller requests publish.
2. API verifies ownership, listing not flagged, all assets `ready`.
3. If any blocking condition exists, return `409 LISTING_NOT_READY`.
4. On success, mark `published`, emit audit log, trigger webhook.

### 5.3 Order/Payment/Completion Flow
1. Buyer places order in `placed`.
2. Payment capture via offline tender adapter.
3. Set order `payment_captured`; emit webhook.
4. Seller marks completed.
5. Buyer review window opens for 14 days.

### 5.4 Refund and Reconciliation Flow
1. Seller initiates refund request.
2. If amount > 250, status `pending_admin_approval` (modeled as `pending` + flag).
3. Admin approves/rejects.
4. Approved refund creates reversal row and waits settlement confirmation import.
5. On confirmation import, refund state -> `confirmed`; order -> `refunded`.

### 5.5 Moderation and Appeal Flow
1. Content scan flags listing/review media.
2. Moderator reviews flagged listing and notes decision.
3. Seller may appeal review decisions; one active appeal per review.
4. Arbitrator resolves and storefront badges update accordingly.

## 6. Security Design
- JWT auth with short access TTL and refresh token rotation.
- Route-level RBAC and row-level ownership checks.
- Sensitive fields encrypted with AES-256-GCM.
- Rate limiting at Fastify pre-handler (60 req/min/user).
- Replay protection: nonce cache table + 5-minute timestamp enforcement.
- HMAC signatures for webhook payloads and signed asset URLs.

## 7. Observability and Operations
- Structured JSON logs with correlation IDs.
- Health endpoints: `/health/live`, `/health/ready`.
- Metrics counters for uploads, job retries, moderation actions, failed auth, rate limit hits.
- Backup scheduler writes encrypted dump and verifies checksum.
