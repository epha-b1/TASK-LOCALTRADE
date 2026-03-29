# LocalTrade Security Architecture

## 1. Authentication (JWT)
- Access tokens: JWT signed with server secret/private key, short TTL (15 minutes).
- Refresh tokens: rotating opaque tokens stored hashed in DB.
- Claims include `sub`, `roles`, `iat`, `exp`, `nonce_seed`.
- Token revocation supported via refresh token invalidation and user deactivation checks.

## 2. Authorization (RBAC + Ownership)
- RBAC middleware enforces role requirements per endpoint.
- Write operations additionally validate object ownership (e.g., seller owns listing/order context).
- Admin endpoints are isolated under `/admin/*`.
- Privilege-escalation prevention: request payload role/user references ignored unless actor has explicit delegation rights.

## 3. Sensitive Data Encryption
- Sensitive fields (tax IDs, bank routing/account, webhook secrets) encrypted with AES-256-GCM.
- Envelope: `enc_version`, `iv`, `ciphertext`, `auth_tag`.
- Keys loaded from local KMS substitute (env-injected key material on-prem).
- UI/API mask sensitive values: only last 4 visible.

## 4. Rate Limiting
- 60 requests per minute per authenticated user.
- Anonymous endpoints (login, health) have per-IP controls.
- Rate limiter store uses PostgreSQL sliding window buckets.
- Exceeding limit returns `429 RATE_LIMIT_EXCEEDED`.

## 5. Anti-Replay Protection
- Protected signed endpoints require `X-Request-Nonce` and `X-Request-Timestamp`.
- Timestamp must be within +/- 5 minutes of server time.
- Nonce stored with uniqueness guarantee; duplicates rejected as replay.
- Cleanup task removes expired nonce rows.

## 6. HMAC-Signed Webhooks
- Outbound webhook payload signed with HMAC-SHA256.
- Header: `X-Webhook-Signature` and `X-Webhook-Timestamp`.
- Destination URL validated against configured local network CIDRs.
- Webhook body includes event id/type/timestamp/resource snapshot.

## 7. Signed Asset URLs
- Download URLs include `asset_id`, `expires_at`, and HMAC signature.
- Default TTL: 15 minutes (configurable).
- Signature scope: `asset_id + expires_at`; not user-bound by design.
- Expired/signature mismatch requests return `403 INVALID_SIGNATURE`.

## 8. Input Validation and Injection Defenses
- Schema-based request validation on all endpoints.
- Parameterized SQL queries only.
- Strict allow-list for MIME types/extensions.
- Regex rules sandboxed with timeout and safe compilation checks.

## 9. Content Safety Controls
- Deterministic scanner pipeline: extension allow-list, MIME sniff, fingerprint check, regex/keyword match.
- Blocked fingerprints deny upload finalization.
- Listings flagged by rules are publish-blocked pending moderator action.

## 10. Backup Strategy
- Nightly encrypted PostgreSQL dumps + object storage manifest.
- Backup artifacts encrypted at rest (AES-256) and checksummed.
- 30-day retention with rotation policy.
- Restore runbook target: service recovery <= 4 hours.
- Monthly restore drill verification required.

## 11. Audit and Monitoring
- Immutable audit entries for auth events, role changes, moderation/arbitration, financial changes.
- Security alerts for repeated failed login, replay attempts, signature failures, and rate-limit spikes.
