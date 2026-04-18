# Test Coverage Audit

## Scope and Method
- Audit mode: static inspection only (no runtime execution).
- Inspected scope: `repo/backend/src/routes`, `repo/backend/src/server.ts`, `repo/backend/test/*`, `repo/frontend/src/**/*.spec.ts`, `repo/README.md`, `repo/run_tests.sh`, minimal structure files.
- Project type declaration found: `fullstack` (`repo/README.md:3`).

## Backend Endpoint Inventory
- Total backend endpoints discovered: **69**.
- Source evidence: route registrations in `backend/src/routes/*.ts` and health routes in `backend/src/server.ts:92` and `backend/src/server.ts:93`.
- Uncovered (strict exact-path evidence missing):
  - `GET /api/admin/content-rules` (`backend/src/routes/content-safety.ts:9`)
  - `PATCH /api/admin/webhooks/subscriptions/:id` (`backend/src/routes/admin.ts:79`)
  - `GET /download/:assetId` (`backend/src/routes/assets.ts:47`)

## API Test Mapping Table
| Endpoint | Covered | Test type | Test files | Evidence |
|---|---|---|---|---|
| `DELETE /api/admin/content-rules/:id` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/content-safety.ts:45`; `admin can update and soft-delete content rules` at `backend/test/api.test.ts:1422` |
| `DELETE /api/listings/:id` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/listings.ts:62`; `seller listings management and order detail auth` at `backend/test/api.test.ts:1456` |
| `GET /api/admin/audit-logs` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/audit-logs.ts:8`; `GET /api/admin/audit-logs returns paginated items for admin and 404 for missing id` at `backend/test/api.test.ts:2837` |
| `GET /api/admin/audit-logs/:id` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/audit-logs.ts:28`; `GET /api/admin/audit-logs returns paginated items for admin and 404 for missing id` at `backend/test/api.test.ts:2847` |
| `GET /api/admin/content-rules` | no | - | - | `backend/src/routes/content-safety.ts:9`; no exact request match in `backend/test/api.test.ts` |
| `GET /api/admin/jobs` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/jobs.ts:8`; `GET /api/admin/jobs + POST /api/admin/jobs/:id/retry enforce admin auth and status transition` at `backend/test/api.test.ts:2901` |
| `GET /api/admin/refunds` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/admin.ts:50`; `GET /api/admin/refunds returns full refund history across sellers for admin` at `backend/test/api.test.ts:2983` |
| `GET /api/admin/refunds/pending` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/admin.ts:42`; `admin user list roles update pending refunds and store credit endpoints work` at `backend/test/api.test.ts:665` |
| `GET /api/admin/users` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/admin.ts:12`; `admin user list roles update pending refunds and store credit endpoints work` at `backend/test/api.test.ts:638` |
| `GET /api/admin/users/:id/pending-reset-token` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/admin.ts:21`; `forgot password does not expose token and reset flow works` at `backend/test/api.test.ts:1334` |
| `GET /api/arbitration/appeals` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/appeals.ts:30`; `negative RBAC checks return 403 for wrong roles` at `backend/test/api.test.ts:1518` |
| `GET /api/assets/:id` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/assets.ts:12`; `GET /api/assets/:id returns own asset summary for seller and 403 for foreign seller` at `backend/test/api.test.ts:2812` |
| `GET /api/assets/:id/metadata` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/assets.ts:33`; `security regression: cross-seller capture and foreign asset access are rejected` at `backend/test/api.test.ts:1825` |
| `GET /api/listings` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/listings.ts:9`; `seller listings management and order detail auth` at `backend/test/api.test.ts:1443` |
| `GET /api/listings/:id` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/listings.ts:19`; `GET /api/listings/:id returns readiness state for seller; buyer is 403` at `backend/test/api.test.ts:2730` |
| `GET /api/media/assets/:assetId/signed-url` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/media.ts:44`; `signed URL download validates valid expired and tampered signatures` at `backend/test/api.test.ts:561` |
| `GET /api/moderation/queue` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/moderation.ts:9`; `negative RBAC checks return 403 for wrong roles` at `backend/test/api.test.ts:1493` |
| `GET /api/orders` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/orders.ts:9`; `orders list returns actor-scoped rows` at `backend/test/api.test.ts:1304` |
| `GET /api/orders/:id` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/orders.ts:33`; `seller listings management and order detail auth` at `backend/test/api.test.ts:1463` |
| `GET /api/payments/:id` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/payments.ts:29`; `payment data isolation blocks unrelated buyer from viewing payment` at `backend/test/api.test.ts:2292` |
| `GET /api/refunds` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/refunds.ts:9`; `refund list enforces object auth and returns history` at `backend/test/api.test.ts:625` |
| `GET /api/reviews/:id` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/reviews.ts:30`; `GET /api/reviews/:id returns review details without authentication` at `backend/test/api.test.ts:2763` |
| `GET /api/storefront/listings` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/listings.ts:73`; `GET /api/storefront/listings is public and supports ranking/sellerId filters` at `backend/test/api.test.ts:2788` |
| `GET /api/storefront/sellers/:sellerId/credit-metrics` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/storefront.ts:7`; `storefront credit metrics endpoint returns expected values` at `backend/test/api.test.ts:2244` |
| `GET /api/storefront/sellers/:sellerId/reviews` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/storefront.ts:16`; `storefront ranking supports verified purchase first and returns badges` at `backend/test/api.test.ts:599` |
| `GET /api/users/me` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/users.ts:10`; `admin can manage content rules and seller deactivation removes published listings` at `backend/test/api.test.ts:359` |
| `GET /api/users/me/store-credit` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/users.ts:19`; `admin user list roles update pending refunds and store credit endpoints work` at `backend/test/api.test.ts:650` |
| `GET /download/:assetId` | no | - | - | `backend/src/routes/assets.ts:47`; no exact request match in `backend/test/api.test.ts` |
| `GET /health/live` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/server.ts:92`; `GET /health/live returns ok without authentication` at `backend/test/api.test.ts:2713` |
| `GET /health/ready` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/server.ts:93`; `GET /health/ready returns ok and confirms DB is reachable` at `backend/test/api.test.ts:2719` |
| `PATCH /api/admin/content-rules/:id` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/content-safety.ts:27`; `admin can update and soft-delete content rules` at `backend/test/api.test.ts:1413` |
| `PATCH /api/admin/users/:id/roles` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/admin.ts:31`; `admin user list roles update pending refunds and store credit endpoints work` at `backend/test/api.test.ts:644` |
| `PATCH /api/admin/users/:id/status` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/users.ts:61`; `admin can manage content rules and seller deactivation removes published listings` at `backend/test/api.test.ts:361` |
| `PATCH /api/admin/webhooks/subscriptions/:id` | no | - | - | `backend/src/routes/admin.ts:79`; no exact request match in `backend/test/api.test.ts` |
| `PATCH /api/listings/:id` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/listings.ts:40`; `cross-user object authorization is enforced` at `backend/test/api.test.ts:1534` |
| `PATCH /api/users/me/seller-profile` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/users.ts:28`; `sensitive seller fields are encrypted at rest and returned masked` at `backend/test/api.test.ts:2254` |
| `POST /api/admin/backups/run` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/admin.ts:101`; `POST /api/admin/backups/run queues a backup job with 202 accepted for admin only` at `backend/test/api.test.ts:2863` |
| `POST /api/admin/content-rules` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/content-safety.ts:17`; `admin can manage content rules and seller deactivation removes published listings` at `backend/test/api.test.ts:329` |
| `POST /api/admin/content-rules/:id/test` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/content-safety.ts:55`; `POST /api/admin/content-rules/:id/test returns match outcome against provided text` at `backend/test/api.test.ts:2882` |
| `POST /api/admin/jobs/:id/retry` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/jobs.ts:16`; `GET /api/admin/jobs + POST /api/admin/jobs/:id/retry enforce admin auth and status transition` at `backend/test/api.test.ts:2919` |
| `POST /api/admin/orders/:id/force-complete` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/admin.ts:90`; `POST /api/admin/orders/:id/force-complete marks order completed and records audit` at `backend/test/api.test.ts:2952` |
| `POST /api/admin/users` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/users.ts:45`; `admin cannot create user with weak password` at `backend/test/api.test.ts:672` |
| `POST /api/admin/users/:id/store-credit` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/admin.ts:58`; `admin user list roles update pending refunds and store credit endpoints work` at `backend/test/api.test.ts:647` |
| `POST /api/admin/webhooks/subscriptions` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/admin.ts:69`; `webhook subscription created and disallowed CIDR target rejected` at `backend/test/api.test.ts:692` |
| `POST /api/appeals` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/appeals.ts:20`; `order, payment, completion, review, appeal flow works` at `backend/test/api.test.ts:262` |
| `POST /api/arbitration/appeals/:id/resolve` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/appeals.ts:38`; `order, payment, completion, review, appeal flow works` at `backend/test/api.test.ts:271` |
| `POST /api/auth/forgot-password` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/auth.ts:52`; `forgot password does not expose token and reset flow works` at `backend/test/api.test.ts:1324` |
| `POST /api/auth/login` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/auth.ts:101`; `(setup)` at `backend/test/api.test.ts:107` |
| `POST /api/auth/logout` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/auth.ts:121`; `jwt tamper missing auth and old refresh token are rejected` at `backend/test/api.test.ts:1569` |
| `POST /api/auth/refresh` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/auth.ts:111`; `jwt tamper missing auth and old refresh token are rejected` at `backend/test/api.test.ts:1572` |
| `POST /api/auth/register` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/auth.ts:10`; `public register creates account and rejects duplicate email` at `backend/test/api.test.ts:1179` |
| `POST /api/auth/reset-password` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/auth.ts:72`; `forgot password does not expose token and reset flow works` at `backend/test/api.test.ts:1363` |
| `POST /api/listings` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/listings.ts:29`; `seller can create listing, upload media, and publish` at `backend/test/api.test.ts:135` |
| `POST /api/listings/:id/publish` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/listings.ts:52`; `seller can create listing, upload media, and publish` at `backend/test/api.test.ts:195` |
| `POST /api/media/upload-sessions` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/media.ts:11`; `seller can create listing, upload media, and publish` at `backend/test/api.test.ts:144` |
| `POST /api/media/upload-sessions/:sessionId/finalize` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/media.ts:33`; `seller can create listing, upload media, and publish` at `backend/test/api.test.ts:187` |
| `POST /api/moderation/listings/:listingId/decision` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/moderation.ts:17`; `audit log records key operations across listing, moderation, order, payment, review, appeal, and refund` at `backend/test/api.test.ts:2459` |
| `POST /api/orders` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/orders.ts:23`; `order, payment, completion, review, appeal flow works` at `backend/test/api.test.ts:228` |
| `POST /api/orders/:id/cancel` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/orders.ts:43`; `cross-user object authorization is enforced` at `backend/test/api.test.ts:1547` |
| `POST /api/orders/:id/complete` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/orders.ts:53`; `order, payment, completion, review, appeal flow works` at `backend/test/api.test.ts:245` |
| `POST /api/payments/capture` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/payments.ts:9`; `order, payment, completion, review, appeal flow works` at `backend/test/api.test.ts:237` |
| `POST /api/payments/import-settlement` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/payments.ts:19`; `settlement import deduplication skips duplicate records` at `backend/test/api.test.ts:1611` |
| `POST /api/refunds` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/refunds.ts:19`; `refund threshold and approval path enforced` at `backend/test/api.test.ts:297` |
| `POST /api/refunds/:id/approve` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/refunds.ts:29`; `refund threshold and approval path enforced` at `backend/test/api.test.ts:315` |
| `POST /api/refunds/import-confirmation` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/refunds.ts:40`; `refund confirmation import persists reconciliation record` at `backend/test/api.test.ts:1647` |
| `POST /api/reviews` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/reviews.ts:9`; `order, payment, completion, review, appeal flow works` at `backend/test/api.test.ts:253` |
| `POST /api/reviews/:id/appeal` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/appeals.ts:9`; `review image attach enforces max 5 and appeal duplicate rejected` at `backend/test/api.test.ts:829` |
| `POST /api/reviews/:id/images` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/reviews.ts:19`; `review image attach enforces max 5 and appeal duplicate rejected` at `backend/test/api.test.ts:822` |
| `PUT /api/media/upload-sessions/:sessionId/chunks/:chunkIndex` | yes | true no-mock HTTP | `backend/test/api.test.ts` | `backend/src/routes/media.ts:22`; `seller can create listing, upload media, and publish` at `backend/test/api.test.ts:161` |

## API Test Classification
1. **True No-Mock HTTP**
   - `backend/test/api.test.ts` (server bootstrapped via `buildServer()`, real socket listener `app.listen(...)`, requests routed through fetch/TCP wrapper; evidence `backend/test/api.test.ts:10`, `backend/test/api.test.ts:120`, `backend/test/api.test.ts:89`).
2. **HTTP with Mocking**
   - None detected in backend API tests.
3. **Non-HTTP (unit/integration without HTTP)**
   - `backend/test/domain.test.ts`
   - `backend/test/security.test.ts`
   - `backend/test/security-hardening.test.ts`
   - `backend/test/worker.test.ts`

## Mock Detection
- `vi.mock("node:child_process")`, `vi.mock("node:util")`, `vi.mock("../src/config.js")`, repository mocks, pool mock, storage mock, `vi.mock("sharp")` in `backend/test/worker.test.ts:39`, `backend/test/worker.test.ts:43`, `backend/test/worker.test.ts:47`, `backend/test/worker.test.ts:55`, `backend/test/worker.test.ts:64`, `backend/test/worker.test.ts:77`, `backend/test/worker.test.ts:83`, `backend/test/worker.test.ts:89`.
- Frontend unit tests use DI overrides and function stubs (`useValue`, `vi.fn`) by design, e.g. `frontend/src/app/features/upload/upload.component.spec.ts:48`, `frontend/src/app/features/auth/login.component.spec.ts:26`.
- No service/controller mocks found in `backend/test/api.test.ts`.

## Coverage Summary
- Total endpoints: **69**.
- Endpoints with HTTP tests (strict exact path evidence): **66**.
- Endpoints with true no-mock tests: **66**.
- HTTP coverage: **95.65%** (66/69).
- True API coverage: **95.65%** (66/69).

## Unit Test Summary
### Backend Unit Tests
- Test files:
  - `backend/test/domain.test.ts`
  - `backend/test/security.test.ts`
  - `backend/test/security-hardening.test.ts`
  - `backend/test/worker.test.ts`
- Modules covered:
  - Domain invariants/constants (`backend/src/domain.ts` via `backend/test/domain.test.ts:2`)
  - Security primitives/network/regex safety (`backend/src/security/*` via `backend/test/security.test.ts:3`, `backend/test/security-hardening.test.ts:2`)
  - Worker retry/scheduler logic (`backend/src/jobs/worker.ts` via `backend/test/worker.test.ts:99`)
- Important backend modules not directly unit-tested (only API-level exercised):
  - Services: `backend/src/services/auth-service.ts`, `backend/src/services/listing-service.ts`, `backend/src/services/order-service.ts`, `backend/src/services/payment-service.ts`, `backend/src/services/refund-service.ts`, `backend/src/services/review-service.ts`
  - Repositories: `backend/src/repositories/*.ts`
  - Auth/rate-limit/replay plugins: `backend/src/plugins/auth.ts`, `backend/src/plugins/rate-limit.ts`, `backend/src/plugins/replay-guard.ts`

### Frontend Unit Tests (STRICT REQUIREMENT)
- Frontend test files found:
  - `frontend/src/app/app.spec.ts`
  - `frontend/src/app/core/api.service.spec.ts`
  - `frontend/src/app/core/auth.guard.spec.ts`
  - `frontend/src/app/core/auth.service.spec.ts`
  - `frontend/src/app/features/auth/login.component.spec.ts`
  - `frontend/src/app/features/upload/upload.component.spec.ts`
  - `frontend/src/app/features/storefront/seller-storefront.component.spec.ts`
  - `frontend/src/app/features/orders/payment-capture.component.spec.ts`
  - `frontend/src/app/features/admin/user-management.component.spec.ts`
  - `frontend/src/app/features/admin/keyword-rules.component.spec.ts`
  - `frontend/src/app/features/admin/refund-approval.component.spec.ts`
- Frameworks/tools detected:
  - Angular TestBed (`frontend/src/app/features/auth/login.component.spec.ts:1`)
  - Vitest (`frontend/src/app/features/auth/login.component.spec.ts:4`)
- Frontend components/modules covered:
  - `LoginComponent`, `UploadComponent`, `SellerStorefrontComponent`, `PaymentCaptureComponent`, `UserManagementComponent`, `KeywordRulesComponent`, `RefundApprovalComponent`, app shell, `AuthService`, `ApiService`, auth guards.
- Important frontend components/modules not tested:
  - Auth pages: `RegisterComponent`, `ForgotPasswordComponent`, `ResetPasswordComponent`
  - Listings: `ListingBrowseComponent`, `ListingCreateComponent`, `ListingDetailComponent`, `MyListingsComponent`
  - Orders/Reviews: `OrderListComponent`, `OrderDetailComponent`, `ReviewFormComponent`, `ReviewListComponent`
  - Moderation/Arbitration/Admin: `ModerationQueueComponent`, `ModerationDecisionComponent`, `AppealQueueComponent`, `AppealDecisionComponent`, `AuditLogComponent`
  - Core network middleware: `jwt.interceptor.ts`, `token-refresh.interceptor.ts`, `toast.service.ts`

**Frontend unit tests: PRESENT**

### Cross-Layer Observation
- Backend API test depth is very high; frontend unit coverage is partial and module-skewed.
- Testing is backend-heavy; many route components and interceptors are untested.

## API Observability Check
- Strengths: API tests usually show method/path, request payload, auth headers, and response assertions (example: `backend/test/api.test.ts:135`-`backend/test/api.test.ts:201`).
- Weak points:
  - Some route hits are inferred through helper flow (e.g. login helper), reducing endpoint-level observability (`backend/test/api.test.ts:106`-`backend/test/api.test.ts:115`).
  - `/download/:assetId` call occurs via runtime URL variable in one test (`backend/test/api.test.ts:3077`-`backend/test/api.test.ts:3079`), but no strict literal path assertion exists.

## Tests Check
- Success/failure/edge/validation/auth are broadly covered in `backend/test/api.test.ts` (RBAC, replay/rate-limit, ownership checks, state machines, boundaries).
- Assertion depth: generally meaningful, not superficial.
- Over-mocking: concentrated in worker unit tests only, not in API suite.
- `run_tests.sh` assessment:
  - Docker usage present (`docker compose ... postgres`, optional `node:20-alpine` fallback): `repo/run_tests.sh:49`, `repo/run_tests.sh:88`.
  - Local dependency requirement present (`npm --prefix ... ci`, host Node check): `repo/run_tests.sh:52`, `repo/run_tests.sh:72`, `repo/run_tests.sh:68`.
  - Strict verdict: **FLAG** for local dependency reliance.

## End-to-End Expectations
- Fullstack expectation: real FE↔BE E2E should exist.
- Evidence found: no frontend E2E test suite in inspected frontend test files; frontend tests are unit-level with mocked API dependencies.
- Compensation: backend true no-mock API suite is strong, but does not replace FE↔BE journey coverage.

## Test Coverage Score (0-100)
- **84/100**

## Score Rationale
- High endpoint/API coverage with true no-mock execution path for most routes.
- Significant deductions for 3 uncovered endpoints (strict), no FE↔BE E2E coverage, and uneven frontend test breadth.

## Key Gaps
- Uncovered endpoints: `GET /api/admin/content-rules`, `PATCH /api/admin/webhooks/subscriptions/:id`, `GET /download/:assetId` (strict static evidence).
- Missing fullstack E2E tests.
- Large set of frontend route components/interceptors without tests.

## Confidence and Assumptions
- Confidence: **high** on backend endpoint inventory and strict static coverage mapping.
- Assumption: only `backend/src/routes/*.ts` plus `backend/src/server.ts` define HTTP endpoints.
- Strict rule applied: variable-driven URL call is not treated as exact endpoint coverage unless path literal is visible.

---

# README Audit

## README Location
- `repo/README.md` exists.

## Hard Gate Evaluation
### Formatting
- PASS: markdown structure is clear and readable (`repo/README.md`).

### Startup Instructions (backend/fullstack)
- PASS: includes `docker-compose up` (`repo/README.md:17`).

### Access Method
- PASS: explicit URLs and ports for frontend/API/docs/health endpoints (`repo/README.md:29`-`repo/README.md:35`).

### Verification Method
- PASS: API curl flow and UI flow provided (`repo/README.md:61`-`repo/README.md:93`).

### Environment Rules (STRICT)
- **FAIL (Hard Gate)**:
  - Includes host-side `npm --prefix backend install` and local test commands (`repo/README.md:111`-`repo/README.md:113`).
  - Includes host-side `npm --prefix frontend install` and local build/test commands (`repo/README.md:122`-`repo/README.md:125`).
  - States host-side npm install is optional but allowed (`repo/README.md:203`-`repo/README.md:205`).
  - Includes non-Docker restore step via host `psql` (`repo/README.md:186`).

### Demo Credentials (Conditional)
- PASS: auth is declared and credentials for all listed roles are provided (`repo/README.md:46`-`repo/README.md:53`).

## Engineering Quality
- Tech stack clarity: strong (`repo/README.md:5`-`repo/README.md:8`, `repo/README.md:237`).
- Architecture/operational explanations: good (backup/restore, troubleshooting, env policy sections).
- Testing instructions: detailed but conflict with strict Docker-only policy due host npm usage.
- Security/roles: explicitly documented (credentials/secret policy).

## High Priority Issues
- Hard-gate violation: README permits and instructs host-side dependency installation and non-containerized operations (`repo/README.md:111`-`repo/README.md:113`, `repo/README.md:122`-`repo/README.md:125`, `repo/README.md:203`-`repo/README.md:205`).

## Medium Priority Issues
- Fullstack verification lacks explicit FE↔BE automated E2E guidance despite claiming broad verification flow.

## Low Priority Issues
- None material beyond strict-gate findings.

## Hard Gate Failures
1. Environment rules violated by host runtime install/test/build commands.
2. Docker-contained-only requirement not met due explicit optional host npm workflow and host `psql` restore command.

## README Verdict
- **FAIL**

---

## Final Verdicts
- Test Coverage Audit Verdict: **PARTIAL PASS** (strong backend API coverage, but strict uncovered endpoints + frontend breadth + missing FE↔BE E2E).
- README Audit Verdict: **FAIL** (hard gate failures on Docker-only environment policy).
