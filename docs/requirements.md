# LocalTrade Marketplace Operations - Software Requirements Specification

## 1. Purpose and Scope
This document defines functional and non-functional requirements for LocalTrade, an offline-first, on-prem marketplace platform where Sellers publish listings with media, Buyers place orders and leave verified reviews, and operational roles moderate content, arbitrate disputes, and administer the platform.

## 2. Actors and Roles
- Buyer: browse storefront, place orders, submit reviews within allowed window.
- Seller: manage listings/media, fulfill orders, initiate refunds, appeal reviews.
- Moderator: review flagged listings/media and decide publish eligibility.
- Arbitrator: resolve review appeals.
- Administrator: manage users/roles/rules/system settings, approve high-value refunds, audit, webhook subscriptions.

## 3. Functional Requirements

### 3.1 Authentication and Authorization
- JWT authentication is required for all protected APIs.
- Role-based access control (RBAC) must enforce least privilege at route and write-operation levels.
- A user may hold multiple roles except `admin` which is exclusive.
- Admin accounts cannot place orders or submit reviews.
- Every write must enforce anti-privilege-escalation checks (ownership or role authority).

### 3.2 User Management
- Admin can create/deactivate/reactivate users and assign roles.
- Deactivating a Seller must move all their `published` listings to `removed`.
- Reactivation does not auto-republish removed listings.

### 3.3 Listing Lifecycle
- Seller can draft/update listing fields (title, description, price, quantity, category).
- Listing states: `draft`, `flagged`, `published`, `removed`.
- Publish gate requires all assets `ready` and listing not flagged.
- Content safety checks run on listing content and assets; flagged items are publish-blocked until moderator decision.

### 3.4 Asset Uploads and Processing
- Allowed types: JPG, PNG, MP4, PDF.
- Max file size: 2 GB; max files/listing: 20.
- Uploads are resumable in 5 MB chunks.
- Client validates extension/size pre-upload and shows progress/retry controls.
- Server performs MIME sniffing after final assembly; server is authoritative.
- Duplicate chunk uploads are idempotent and return already-received status.
- Metadata extraction (dimensions, duration, codec) and transcoding/compression run via PostgreSQL-backed async jobs.
- Stuck processing jobs are re-queued by watchdog after 10 minutes; fail permanently after 3 retries.
- Blocked file fingerprints cannot be re-uploaded.

### 3.5 Orders and Payments
- Buyer places order for published listing.
- Order states: `placed`, `payment_captured`, `completed`, `cancelled`, `refunded`.
- Cancellation allowed only in `placed`.
- Seller marks order completed; admin override requires reason/audit.
- Payment tenders: cash, check, store_credit, card_terminal_import.
- Payment import supports idempotent record-level dedup by transaction key.
- Duplicate records are skipped; import returns `{ total, inserted, skipped }`.

### 3.6 Refunds
- Seller initiates refund.
- Refunds over $250.00 require Admin approval; $250.00 exactly is auto-approved.
- Refund states: `pending`, `approved`, `rejected`, `confirmed`.
- Confirmation uses same import reconciliation path as payment settlements.
- Reversal records must be created and linked to original payment/order.

### 3.7 Reviews, Appeals, and Storefront Trust
- Buyer can review only completed orders and only within 14 days inclusive (<= 14 days).
- Review constraints: 1-5 stars, max 1000 chars, up to 5 images.
- Review remains visible after order refund unless altered by appeal/arbitration.
- Seller can open multiple simultaneous appeals, max one active appeal per review.
- Arbitrator decisions: uphold, modify, remove; decision is timestamped and auditable.
- Storefront metrics per seller include rolling 90-day average rating and positive-rate.
- Positive-rate = percentage of 4-5 star reviews within rolling 90-day window.
- Review ranking rules configurable: verified purchase first, most recent, highest rated.
- Badges indicate under appeal and removed-by-arbitration.

### 3.8 Moderation and Content Safety
- Deterministic offline checks: extension allow-list, MIME sniff, fingerprint blocklist, keyword/regex scanning.
- Keyword/regex scans apply to title + description, case-insensitive.
- Keyword rules auto-wrap as whole-word regex unless explicit regex provided.
- Moderator decisions include notes and timestamp.

### 3.9 Signed URLs and Media Access
- Asset downloads use HMAC-signed URLs with default 15-minute expiry.
- Signature covers `asset_id + expiry` (not user-bound).
- Expired/invalid signatures are rejected.

### 3.10 Webhooks
- Admin manages webhook subscriptions for local-network endpoints only.
- Trigger events: order completed, payment captured, refund approved, listing published, listing flagged.
- Outbound webhook requests include HMAC-SHA256 signature header.
- Failed deliveries are logged (fire-and-forget, no retry).

### 3.11 Audit and Compliance
- Immutable audit log for all sensitive actions and state transitions.
- Each audit row stores actor, role context, action, target type/id, before/after summaries, timestamp.

### 3.12 Backup and Restore
- Nightly encrypted backups to local encrypted media.
- Retention: 30 days.
- Documented restore target: <= 4 hours.

## 4. Non-Functional Requirements
- Offline-first operation with no required external cloud services.
- On-prem deployment via Docker Compose.
- API rate limit: 60 requests/minute per user.
- Anti-replay for signed requests/webhooks: nonce + 5-minute timestamp window.
- AES-256 encryption for sensitive financial/tax fields; masked display last 4 digits.
- Input validation and anti-injection protections on all request boundaries.
- Horizontal concurrency handling for job workers via DB locking (`FOR UPDATE SKIP LOCKED`).

## 5. Acceptance Criteria (Condensed)
- Seller can upload up to 20 files/listing with resumable chunk flow and retry.
- MIME mismatch after upload returns `400 MIME_TYPE_MISMATCH`; rejected file removed.
- Flagged listing cannot be published until Moderator approval.
- Buyer cannot review after 14 days + 1 second.
- Refund $250.00 auto-approves; $250.01 requires admin approval.
- Duplicate settlement imports do not double-count payment rows.
- Signed URL expires exactly at configured timestamp and blocks hotlink persistence.
- All protected writes generate audit logs and enforce RBAC + ownership checks.
- `run_tests.sh` validates critical domain logic and security boundaries.
