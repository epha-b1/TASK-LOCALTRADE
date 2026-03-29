# LocalTrade Data Model

## 1. ER Diagram (Textual)
```text
users 1---* user_roles *---1 roles
users 1---* listings
listings 1---* assets
assets 1---* upload_sessions 1---* upload_chunks
assets 1---* jobs

users (buyer) 1---* orders *---1 listings
orders 1---* payments
orders 1---* refunds

orders 1---0..1 reviews
reviews 1---* review_media
reviews 1---* appeals

listings 1---* moderation_decisions
assets 1---* content_scan_results

users 1---* webhook_subscriptions
users 1---* audit_logs
users 1---* store_credit_ledger
```

## 2. Core Tables (Abbreviated)
- `users(id, email, password_hash, status, display_name, tax_id_enc, created_at, updated_at)`
- `roles(id, code)` (`buyer`, `seller`, `moderator`, `arbitrator`, `admin`)
- `user_roles(user_id, role_id, assigned_at)`
- `listings(id, seller_id, title, description, price_cents, quantity, status, flagged_rule_id, created_at)`
- `assets(id, listing_id, kind, mime_type, ext, size_bytes, storage_path, status, fingerprint_sha256, metadata_json, created_at)`
- `upload_sessions(id, asset_id, seller_id, total_chunks, chunk_size_bytes, status, created_at)`
- `upload_chunks(id, session_id, chunk_index, chunk_path, size_bytes, received_at)`
- `jobs(id, type, payload_json, status, retry_count, locked_at, available_at, last_error, created_at)`
- `orders(id, buyer_id, listing_id, quantity, total_cents, status, completed_at, created_at)`
- `payments(id, order_id, tender_type, amount_cents, transaction_key, status, settlement_ref, created_at)`
- `refunds(id, order_id, seller_id, amount_cents, status, requires_admin_approval, approved_by, confirmed_at, created_at)`
- `reviews(id, order_id, buyer_id, seller_id, rating, body, status, under_appeal, removed_by_arbitration, created_at)`
- `review_media(id, review_id, asset_id)`
- `appeals(id, review_id, seller_id, status, reason, resolved_by, resolution_note, created_at)`
- `moderation_decisions(id, listing_id, moderator_id, decision, notes, created_at)`
- `content_rules(id, rule_type, pattern, active, created_at)`
- `content_scan_results(id, asset_id, listing_id, rule_id, verdict, detail, created_at)`
- `webhook_subscriptions(id, created_by, event_type, target_url, secret_enc, active, created_at)`
- `audit_logs(id, actor_user_id, actor_roles, action, target_type, target_id, before_json, after_json, created_at)`
- `store_credit_ledger(id, buyer_id, entry_type, amount_cents, payment_id, note, created_at)`

## 3. Index Strategy

### High-Cardinality and Lookup Indexes
- `users(email)` unique.
- `roles(code)` unique.
- `user_roles(user_id, role_id)` unique.
- `listings(seller_id, status, created_at desc)`.
- `assets(listing_id, status)`.
- `assets(fingerprint_sha256)` unique for blocked fingerprints subset via partial index.
- `upload_chunks(session_id, chunk_index)` unique (idempotent chunk handling).
- `jobs(status, available_at, created_at)` for worker polling.
- `orders(buyer_id, created_at desc)` and `orders(listing_id, status)`.
- `payments(transaction_key)` unique for idempotency.
- `refunds(order_id, status)`.
- `reviews(seller_id, created_at desc)` and `reviews(order_id)` unique (one review/order).
- `appeals(review_id, status)` partial unique where status in active set.
- `audit_logs(target_type, target_id, created_at desc)`.

### Analytical and Storefront Indexes
- `reviews(seller_id, rating, created_at)` for 90-day rating/positive-rate aggregates.
- `reviews(created_at)` BRIN for time-window scans.

### Security and Replay Indexes
- `request_nonces(nonce)` unique with TTL cleanup index on `created_at`.
- `webhook_delivery_logs(subscription_id, created_at)` for operations tracking.

## 4. Constraints and Data Integrity
- Enforce foreign keys across all parent-child relations.
- Use `CHECK` constraints for rating (1..5), positive amounts, and enum-like statuses.
- Immutable ledgers (`payments`, `refunds`, `store_credit_ledger`) updated by append-style transitions and audit logs.
