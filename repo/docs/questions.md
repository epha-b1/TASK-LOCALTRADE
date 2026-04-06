# Required Document Description: Business Logic Questions Log

This file records business-level ambiguities from the prompt and implementation decisions.
Each entry follows exactly: Question + My Understanding/Hypothesis + Solution.

## 1) Server-side MIME sniff fails after client-side validation passes
Question: The prompt requires both client-side file type validation and server-side MIME sniffing. What happens when a file passes the client-side extension check (e.g., file.jpg) but the server detects the actual bytes are not a valid JPEG?
My Understanding/Hypothesis: Server-side MIME sniff is authoritative; failing files must be fully rejected with no partial data retained.
Solution: After final chunk assembly, run MIME sniff before permanent storage write. On failure, delete assembled data, mark session as `rejected`, and return `400 MIME_TYPE_MISMATCH` with a UI-readable message.

## 2) Buyer order cancellation after payment captured
Question: The prompt defines states `placed -> payment_captured -> completed -> cancelled -> refunded` but does not specify whether a Buyer can cancel after payment capture.
My Understanding/Hypothesis: Cancellation is allowed only while `placed`; after capture, only completion or refund is valid.
Solution: Cancel endpoint allows only `placed`. For `payment_captured` or later, return `409 INVALID_STATE_TRANSITION` with a message directing user to refund flow.

## 3) Review fate when order is refunded
Question: The prompt allows reviews after `completed`, but does not define what happens to an existing review if the order is later refunded.
My Understanding/Hypothesis: Refund should not automatically remove or hide a review.
Solution: Keep review published after refund; allow Seller appeal through standard flow; add audit entry when refund affects an order with a review.

## 4) Multiple simultaneous appeals by the same Seller
Question: The prompt does not specify whether one Seller can have multiple active appeals at the same time.
My Understanding/Hypothesis: A Seller may have multiple appeals, but only one active appeal per review.
Solution: Enforce uniqueness on `(review_id, active)`; return `409 APPEAL_ALREADY_ACTIVE` for duplicate active appeal on the same review.

## 5) Job queue worker crash mid-transcoding
Question: The prompt requires persisted async jobs with retries, but does not define recovery for jobs stuck in `processing` after worker crash.
My Understanding/Hypothesis: A stale-job watchdog should reset timed-out processing jobs for retry.
Solution: Track `locked_at`; cleanup task runs every 5 minutes and resets jobs older than 10 minutes back to `queued` with retry increment; mark `failed` after max retries.

## 6) Settlement import file deduplication
Question: The prompt requires idempotent payment import by transaction key, but does not define behavior for importing the same file twice.
My Understanding/Hypothesis: Deduplication should be record-level, not file-level.
Solution: Skip rows whose `transaction_key` already exists, insert new rows, and return summary `{ total, inserted, skipped }` without erroring on duplicates.

## 7) Exact $250.00 refund threshold boundary
Question: The rule says Administrator approval is required for refunds over $250.00; exact boundary behavior is not explicit.
My Understanding/Hypothesis: `Over` means strictly greater than; exactly $250.00 is auto-approved.
Solution: Use `if amount > 250.00` for approval path; include boundary unit tests for $250.00 and $250.01.

## 8) 14-day review window boundary
Question: The prompt says review allowed within 14 days, but does not clarify inclusivity at the exact boundary.
My Understanding/Hypothesis: The 14-day window should be inclusive up to the exact expiry timestamp.
Solution: Validate with `now() - completed_at <= interval '14 days'`; accept at exactly 14 days, reject at 14 days + 1 second.

## 9) Administrator role behavior in buyer flows
Question: RBAC does not explicitly state whether Administrators can place orders or submit reviews.
My Understanding/Hypothesis: Administrator role should be operational-only, not buyer-facing.
Solution: Deny `place_order` and `submit_review` for `admin` role in middleware; keep admin endpoints separate.

## 10) Deactivated Seller account listing behavior
Question: The prompt does not define what happens to Seller listings when account is deactivated.
My Understanding/Hypothesis: Published listings should be hidden immediately, while existing orders remain resolvable.
Solution: In one transaction, set user inactive and move Seller `published` listings to `removed`; keep current orders unchanged; record audit event.

## 11) Keyword/regex moderation rule scope
Question: The prompt does not define matching scope and sensitivity for prohibited terms (title vs description, case sensitivity, whole-word behavior).
My Understanding/Hypothesis: Rules should scan title + description case-insensitively; regex should control whole-word vs substring matching.
Solution: Store active regex rules and evaluate against combined text; on first match, auto-flag listing and persist matching rule ID for moderation traceability.

## 12) Resumable upload chunk resend behavior
Question: The prompt requires resumable uploads but does not define behavior when an already-uploaded chunk is resent.
My Understanding/Hypothesis: Chunk upload should be idempotent per `(session_id, chunk_index)`.
Solution: Add unique constraint on `(session_id, chunk_index)`; if resend detected, return success with `already_received` state and do not re-write chunk data.

## 13) Signed URL scope (per asset vs per user)
Question: The prompt requires time-limited signed download URLs, but does not define whether signatures are user-scoped.
My Understanding/Hypothesis: Time-limited, non-user-scoped URLs are sufficient for hotlink control in this environment.
Solution: Sign `asset_id + expiry_timestamp`, validate signature/expiry on download, and document intentional non-user-scoped behavior in security notes.

## 14) Positive-rate percentage denominator
Question: The prompt defines positive-rate but does not specify exact denominator.
My Understanding/Hypothesis: Use all reviews in the last 90 days as denominator, with ratings >=4 as numerator.
Solution: Compute rolling 90-day positive rate; if no reviews in window, return `null` and hide metric in UI.

## 15) HMAC webhook event coverage
Question: The prompt mentions HMAC webhooks on local network but does not define triggering events/payload.
My Understanding/Hypothesis: Webhooks should cover key lifecycle events relevant to local integrations.
Solution: Support subscriptions by event type (e.g., order completed, payment captured, refund approved, listing published/flagged) and send HMAC-SHA256 signed payloads to allowed local endpoints.

## 16) User-to-role assignment model
Question: The prompt defines roles but does not clarify single-role vs multi-role assignment.
My Understanding/Hypothesis: Multi-role is allowed except `admin`, which should remain exclusive.
Solution: Implement many-to-many `user_roles`; reject mixed `admin` + non-admin assignments; enforce checks in authorization middleware.

## 17) Listing publish gate with pending media jobs
Question: The prompt requires media processing and Ready-to-Publish gate, but does not define if publish is allowed while assets are pending.
My Understanding/Hypothesis: Publish must be blocked until all assets are `ready`.
Solution: Publish endpoint validates all listing assets are `ready` and none are `processing/failed`; otherwise return `409 LISTING_NOT_READY` with asset status details.

## 18) Who can mark orders completed
Question: The prompt does not specify actor authorization for transitioning `payment_captured` to `completed`.
My Understanding/Hypothesis: Seller marks completion; admin override is exceptional and audited.
Solution: Restrict order completion endpoint to Seller owning the listing; provide separate admin override endpoint requiring reason and audit log entry.

## 19) Store credit balance source of truth
Question: The prompt includes store credit tender but does not define balance model/enforcement.
My Understanding/Hypothesis: Store credit should use immutable ledger entries per Buyer.
Solution: Implement `store_credit_ledger` with `credit/debit/reversal`; payment capture verifies available balance transactionally before debiting and linking to payment record.
