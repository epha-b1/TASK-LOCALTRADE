# Business Logic Questions and Clarifications

---

## 1. Server-Side MIME Sniff Fails After Client-Side Validation Passes

**Question:** The prompt requires both client-side file type validation and server-side MIME sniffing. What happens when a file passes the client-side extension check (e.g. file.jpg) but the server detects the actual bytes are not a valid JPEG — does the upload fail silently, return an error to the UI, and is the partially uploaded chunk data discarded?

**Assumption:** Server-side MIME sniff is the authoritative check. If it fails, the entire upload session for that file is rejected, all uploaded chunks are discarded, and the UI receives a structured error explaining the rejection reason so the user sees it clearly.

**Solution:** After the final chunk is assembled, run MIME sniff before writing to permanent storage. If it fails, delete the assembled file, mark the upload session as `rejected`, return `400 MIME_TYPE_MISMATCH` with a human-readable message. The UI shows this inline on the file entry.

---

## 2. Buyer Order Cancellation After Payment Captured

**Question:** The prompt defines order states as `placed → payment_captured → completed → cancelled → refunded` but does not specify whether a Buyer can cancel after payment has already been captured, or whether cancellation is only allowed before payment.

**Assumption:** Cancellation is only allowed in the `placed` state (before payment capture). Once payment is captured, the order can only be completed or refunded — not directly cancelled. This protects Sellers from losing confirmed revenue without a formal refund process.

**Solution:** The cancel endpoint checks order state. If state is `placed`, allow cancellation. If state is `payment_captured` or later, return `409 INVALID_STATE_TRANSITION` with message "Order cannot be cancelled after payment is captured. Please initiate a refund." Refund flow handles the money-back path.

---

## 3. Review Fate When Order Is Refunded

**Question:** The prompt says Buyers can review after an order is `completed`, but does not address what happens to an existing review if the order is later refunded. Should the review remain visible, be hidden, or be flagged?

**Assumption:** A refund does not automatically remove or hide a review. The review was left in good faith after a completed transaction. Removing it automatically would undermine the trust system. If the Seller believes the refund context makes the review unfair, they can appeal it through the normal appeal process.

**Solution:** Refund state change does not touch the review record. Review remains published. Seller retains the right to appeal. This is documented in the audit log when a refund is processed on an order that has a review.

---

## 4. Multiple Simultaneous Appeals by the Same Seller

**Question:** The prompt does not specify whether a Seller can have multiple active appeals open at the same time — for example, appealing three different reviews simultaneously.

**Assumption:** A Seller can have multiple active appeals simultaneously, one per review. There is no stated limit. Each appeal is independent and goes into the Arbitrator queue separately.

**Solution:** No uniqueness constraint on (seller_id, appeal_status). Uniqueness is enforced at (review_id) — one active appeal per review at a time. If a Seller tries to appeal a review that already has an active appeal, return `409 APPEAL_ALREADY_ACTIVE`.

---

## 5. Job Queue Worker Crash Mid-Transcoding

**Question:** The prompt requires async job queues persisted in PostgreSQL with retry logic, but does not specify what happens to a job that was set to `processing` when the worker process crashes — how is it detected and recovered?

**Assumption:** A crashed worker leaves the job stuck in `processing` state indefinitely. A watchdog mechanism must detect stale jobs and reset them for retry.

**Solution:** Each job row has a `locked_at` timestamp set when a worker picks it up. A background cleanup job runs every 5 minutes and resets any job stuck in `processing` for more than 10 minutes back to `queued` with `retry_count + 1`. After 3 retries the job moves to `failed`. Worker uses a PostgreSQL advisory lock or `SELECT FOR UPDATE SKIP LOCKED` to prevent double-processing.

---

## 6. Settlement Import File Deduplication

**Question:** The prompt requires idempotency on payment imports using unique transaction keys, but does not specify what happens if the exact same settlement file is imported twice — is the entire file rejected, or only duplicate transaction records within it?

**Assumption:** File-level deduplication is not required. Record-level deduplication via transaction key is sufficient. Importing the same file twice should be safe — duplicate transaction keys are silently skipped (idempotent), new records are inserted, and the import summary reports how many were new vs. skipped.

**Solution:** On import, for each record check if `transaction_key` already exists in the payments table. If yes, skip it and increment `skipped_count`. If no, insert it. Return import summary: `{ total, inserted, skipped }`. No error is thrown for duplicates.

---

## 7. Exact $250.00 Refund Threshold Boundary

**Question:** The prompt states "Administrator approval over $250.00" — this is ambiguous about whether exactly $250.00 requires approval or is auto-approved.

**Assumption:** "Over $250.00" means strictly greater than. A refund of exactly $250.00 is auto-approved. A refund of $250.01 requires Administrator approval.

**Solution:** Threshold check: `if (amount > 250.00) → require_admin_approval`. $250.00 exactly goes through auto-approval. This boundary is explicitly tested in unit tests.

---

## 8. 14-Day Review Window — Exact Boundary

**Question:** The prompt says "within 14 days" but does not clarify whether day 14 is included (i.e. is the window 14 full days, or does it expire at the start of day 14?).

**Assumption:** The window is 14 full days from the order completion timestamp. A review submitted at any point within 336 hours (14 × 24) of `completed_at` is accepted. A review submitted on day 15 (hour 337+) is rejected.

**Solution:** Eligibility check: `now() - order.completed_at <= interval '14 days'`. The boundary is inclusive of the 14th day up to the exact second of expiry. Tested with a review submitted at exactly 14 days (pass) and 14 days + 1 second (fail).

---

## 9. Administrator Role — Can They Place Orders or Leave Reviews?

**Question:** The RBAC section does not explicitly state whether an Administrator can act as a Buyer (place orders, leave reviews) or whether the Admin role is purely operational.

**Assumption:** Administrator is an operational role only. They cannot place orders or leave reviews in their capacity as Administrator. If an Administrator also needs to buy, they would need a separate Buyer account. This prevents Admins from gaming the review system or creating fake orders.

**Solution:** The RBAC permission check for `place_order` and `submit_review` explicitly excludes the `admin` role. Admin endpoints are separate from buyer/seller flows. This is enforced at the route middleware level and tested.

---

## 10. Deactivated Seller Account — What Happens to Their Listings

**Question:** The prompt does not specify what happens to a Seller's published listings when their account is deactivated by an Administrator.

**Assumption:** When a Seller account is deactivated, all their `published` listings are immediately moved to `removed` state and become invisible to Buyers. Active orders on those listings are not automatically cancelled — they remain in their current state for resolution. The Seller cannot log in or create new listings while deactivated.

**Solution:** Account deactivation triggers a DB transaction: set `users.status = inactive`, set all `listings.status = removed` where `seller_id = user_id AND status = published`. Existing orders are untouched. Audit log records the deactivation and the count of listings removed. Reactivation does not auto-restore listings — Seller must re-publish manually.

---

## 11. Keyword/Regex Rule Matching Scope

**Question:** The prompt says keyword/regex rules apply to "prohibited terms" but does not specify whether matching is case-sensitive, whether it applies to the full listing description or just title, and whether partial word matches count (e.g. does a rule for "gun" match "begun"?).

**Assumption:** Rules apply to both title and description. Matching is case-insensitive. Rules are stored as regex patterns, so the Administrator controls whether it is a whole-word match or substring match by writing the regex appropriately (e.g. `\bgun\b` for whole word). Default simple keyword rules are wrapped as `\bkeyword\b` automatically if no regex syntax is detected.

**Solution:** Store rules as regex strings in the DB. On listing create/update, run each active rule against `title + ' ' + description` using case-insensitive regex match. First match triggers automatic flag. The matching rule ID is stored on the listing for Moderator reference. Admin UI shows rule syntax with a test field.

---

## 12. Resumable Upload — Same Chunk Re-Sent

**Question:** The prompt requires resumable uploads with retry controls but does not specify the behavior when the client re-sends a chunk that was already successfully uploaded (e.g. client retries due to a network timeout but the server already received it).

**Assumption:** Chunk uploads must be idempotent. Re-sending an already-received chunk should be accepted silently without duplicating data. The server tracks which chunks have been received per upload session.

**Solution:** Each upload session tracks received chunks in a `upload_chunks` table with `(session_id, chunk_index)` as a unique constraint. If a chunk with the same index is re-sent, the server returns `200 OK` with `{ "status": "already_received" }` without writing the data again. Client treats this as success and moves to the next chunk.

---

## 13. Signed URL Scope — Per Asset or Per User

**Question:** The prompt requires signed time-limited download URLs to prevent hotlinking, but does not specify whether the signed URL is tied to a specific user (so sharing the URL with another user fails) or just time-limited (anyone with the URL can use it within the expiry window).

**Assumption:** Signed URLs are time-limited but not user-scoped. Anyone with the URL can access the asset within the 15-minute window. This is the standard CDN-style approach and is sufficient for hotlink prevention in an on-prem environment. User-scoped URLs would break legitimate use cases like sharing a link in a chat.

**Solution:** HMAC signature covers `asset_id + expiry_timestamp` only — no user ID in the signature. Backend validates signature and expiry. No session or auth check on the asset download endpoint itself. This is documented in the security spec as an intentional design decision.

---

## 14. Positive-Rate Percentage Calculation

**Question:** The prompt defines positive-rate as a percentage but does not specify the denominator — is it all reviews in the last 90 days, or only verified-purchase reviews, or all reviews ever?

**Assumption:** Positive-rate is calculated over all reviews submitted in the rolling 90-day window (same window as the average rating). Denominator = total reviews in last 90 days. Numerator = reviews with rating 4 or 5 in last 90 days.

**Solution:** `positive_rate = COUNT(reviews WHERE rating >= 4 AND created_at >= now() - 90 days) / COUNT(reviews WHERE created_at >= now() - 90 days) * 100`. If no reviews in window, positive_rate = null (not displayed). Tested with known datasets.

---

## 15. HMAC Webhook — What Events Trigger Them

**Question:** The prompt mentions HMAC-signed webhooks limited to the local network but does not specify which events trigger webhooks or what the webhook payload looks like.

**Assumption:** Webhooks are an outbound notification mechanism for key state changes. Since this is an on-prem system, webhooks are likely used to notify other local systems (e.g. ERP, inventory). Triggered events: order completed, payment captured, refund approved, listing published, listing flagged.

**Solution:** Implement a `webhook_subscriptions` table where Administrators configure endpoint URLs and event types. On each triggering event, the system sends a POST to the configured URL with HMAC-SHA256 signature in `X-Webhook-Signature` header. Only URLs within the configured local IP range are accepted. Failed deliveries are logged but not retried (fire-and-forget for simplicity, documented as such).

---

## 16. User-to-Role Assignment Model

**Question:** The prompt defines five roles but does not specify whether a single account can hold multiple roles (for example Seller + Buyer), or whether role assignment is exactly one role per account.

**Assumption:** A user account may hold multiple roles except `admin`, which must remain exclusive for separation of duties. This supports common local marketplace usage (users buying and selling) while preserving strict controls for admin operations.

**Solution:** Implement `user_roles` join table with many-to-many relationship. Enforce application-level rule that assigning `admin` clears non-admin roles and assigning any non-admin role to an admin account is rejected. Route guards check for role membership by permission.

---

## 17. Listing Publish Gate While Media Jobs Are Pending

**Question:** The prompt requires metadata extraction/transcoding and a "Ready to Publish" gate, but does not explicitly define whether a listing can be published before all media jobs complete successfully.

**Assumption:** Publishing is blocked until all attached assets are in `ready` state and no asset is `processing` or `failed`. This guarantees buyers only see listings with usable media.

**Solution:** The publish endpoint validates listing-level invariants: at least one media/attachment exists, every asset for the listing is `ready`, and listing is not content-flagged. If any asset is pending/failed, return `409 LISTING_NOT_READY` with per-asset status details.

---

## 18. Who Can Mark Orders Completed

**Question:** The prompt states buyers place orders and can review after completion, but does not specify who is authorized to transition an order from `payment_captured` to `completed`.

**Assumption:** Seller confirms fulfillment and marks the order completed. Buyers cannot self-complete orders. Administrators can force completion only via an explicit override endpoint with an audit reason.

**Solution:** `POST /orders/:id/complete` requires `seller` role and ownership of listing tied to the order. Admin override is implemented separately under admin scope and requires `reason` in request body; both actions create immutable audit log entries.

---

## 19. Store Credit Balance Source of Truth

**Question:** The prompt includes `store credit` as a payment tender but does not define how available balance is tracked and enforced.

**Assumption:** Store credit uses an internal ledger account per Buyer. Available credit equals sum(credits) - sum(debits) from confirmed ledger entries. Orders paid with store credit must reserve and then capture against this ledger.

**Solution:** Add `store_credit_ledger` table with immutable entries (`credit`, `debit`, `reversal`) and running-balance query by buyer. Payment capture with store credit runs in a DB transaction that verifies sufficient balance, writes a `debit` ledger row, and links it to the payment record.
