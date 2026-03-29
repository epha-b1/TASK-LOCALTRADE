# LocalTrade Test Plan

## 1. Requirement-to-Test Mapping

| Requirement ID | Requirement | Test Case ID | Type |
|---|---|---|---|
| FR-AUTH-01 | JWT login + refresh rotation | TC-AUTH-LOGIN-001, TC-AUTH-REFRESH-002 | Integration |
| FR-RBAC-01 | Role enforcement on protected routes | TC-RBAC-ROUTE-001 | Integration |
| FR-USER-03 | Seller deactivation removes published listings | TC-USER-DEACT-003 | Integration |
| FR-UPLOAD-01 | 5 MB chunk resumable upload | TC-MEDIA-CHUNK-001 | Integration |
| FR-UPLOAD-02 | MIME sniff authoritative rejection | TC-MEDIA-MIME-002 | Integration |
| FR-UPLOAD-03 | Duplicate chunk idempotent | TC-MEDIA-CHUNK-003 | Unit/Integration |
| FR-LIST-01 | Publish gate blocks flagged/pending assets | TC-LIST-PUBLISH-001 | Integration |
| FR-JOB-01 | Stale job watchdog recovery | TC-JOBS-WATCHDOG-001 | Unit |
| FR-ORDER-01 | Cancel only in placed state | TC-ORDER-CANCEL-001 | Integration |
| FR-PAY-01 | Transaction key idempotency | TC-PAY-IDEMP-001 | Integration |
| FR-REF-01 | Refund threshold > $250 approval | TC-REF-THRESH-001 | Unit |
| FR-REVIEW-01 | Review window 14 days inclusive | TC-REV-WINDOW-001 | Unit |
| FR-APPEAL-01 | One active appeal per review | TC-APP-UNIQ-001 | Integration |
| FR-METRIC-01 | 90-day positive-rate calculation | TC-STOREFRONT-METRIC-001 | Unit |
| FR-URL-01 | Signed URL expiry/validation | TC-MEDIA-SIGNEDURL-001 | Unit |
| FR-AUDIT-01 | Sensitive writes produce audit log | TC-AUDIT-WRITE-001 | Integration |

## 2. Security Coverage Table

| Security Control | Test IDs |
|---|---|
| JWT validation and expiry | TC-AUTH-JWT-001, TC-AUTH-JWT-002 |
| RBAC least privilege | TC-RBAC-ROUTE-001..005 |
| Ownership checks | TC-RBAC-OWNER-001..003 |
| AES encrypted fields + masking | TC-SEC-ENC-001, TC-SEC-MASK-002 |
| Rate limiting 60 req/min | TC-SEC-RATELIMIT-001 |
| Anti-replay nonce+timestamp | TC-SEC-REPLAY-001..003 |
| HMAC webhook signature | TC-SEC-WEBHOOK-001 |
| Signed URL tamper protection | TC-SEC-SIGNEDURL-001 |
| SQL/script injection hardening | TC-SEC-INJECT-001..004 |
| Backup encryption + restore drill | TC-OPS-BACKUP-001, TC-OPS-RESTORE-002 |

## 3. Boundary Condition Table

| Domain | Boundary | Expected Result |
|---|---|---|
| Upload chunk size | 5 MB exact | accepted |
| Upload file size | 2 GB exact | accepted |
| Upload file size | 2 GB + 1 byte | rejected `FILE_TOO_LARGE` |
| Files per listing | 20 exact | accepted |
| Files per listing | 21st file | rejected `FILE_LIMIT_REACHED` |
| Refund approval | $250.00 | auto-approved |
| Refund approval | $250.01 | admin approval required |
| Review window | exactly 14 days | accepted |
| Review window | 14 days + 1 second | rejected |
| Rate limit | 60 req/min | accepted |
| Rate limit | 61st req/min | `429` |

## 4. Test Execution Strategy
- Unit tests: pure domain invariants and state transitions.
- Integration tests: Fastify routes with test DB.
- End-to-end smoke: auth -> listing -> order -> payment -> completion -> review.
- Security tests included in CI pipeline and pre-release checklist.

## 5. Endpoint Regression Coverage
- CORS preflight headers: `OPTIONS` returns expected allow headers/methods.
- Signed downloads: valid signature succeeds; expired/tampered signature returns `403 INVALID_SIGNATURE`.
- Storefront ranking: verifies `verified_purchase_first`, `most_recent`, `highest_rated` behavior and review badges.
- Refund visibility: enforces object-level auth for buyer/seller/admin and returns order history.
- Admin operations: user listing, role updates, pending refunds queue, and store-credit issuance.
- Review lifecycle add-ons: review image attachment cap and duplicate active appeal rejection.
