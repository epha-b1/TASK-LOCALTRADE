# Delivery Acceptance / Project Architecture Review

Date: 2026-04-03
Scope: `./repo` (Angular frontend + Fastify backend + PostgreSQL schema/tests)

## Environment Restriction Notes / Verification Boundary

- I did not start Docker services during acceptance (per your hard rule).
- Verified by local static audit + local command execution (`npm`/tests/build) where possible.
- Confirmable now: source structure, DB schema, route/service logic, test suite quality, backend/frontend buildability.
- Unconfirmable now: full containerized runtime behavior under `docker compose up` and browser-level manual UX flow end-to-end.

---

## 1) Mandatory Thresholds

### 1.1 Can it run and be verified?

#### 1.1.a Clear startup/operation instructions
- Conclusion: **Pass**
- Reason (basis): README provides startup, service URLs, test command, role credentials, backup/restore procedure.
- Evidence: `repo/README.md:3`, `repo/README.md:13`, `repo/README.md:25`, `repo/README.md:38`, `repo/README.md:50`
- Reproducible verification method:
  - `docker compose up` (per README)
  - Expected: frontend `:4200`, API `:3000`, readiness at `/health/ready`.

#### 1.1.b Can start/run without core code modification
- Conclusion: **Pass**
- Reason (basis): Standard scripts and compose file exist; I executed install/test/build without code edits.
- Evidence: `repo/backend/package.json:6`, `repo/frontend/package.json:4`, `repo/docker-compose.yml:1`, `repo/run_tests.sh:46`
- Reproducible verification method:
  - `npm --prefix backend ci && npm --prefix backend test && npm --prefix backend run build`
  - `npm --prefix frontend ci && npm --prefix frontend test -- --watch=false && npm --prefix frontend run build`
  - Expected: tests and builds succeed.

#### 1.1.c Runtime result broadly matches delivery description
- Conclusion: **Pass (with boundary)**
- Reason (basis): Backend tests pass all integration/security scenarios; frontend unit tests pass and build succeeds.
- Evidence: backend test output `~/.local/share/opencode/tool-output/tool_d52e77dde001ehcfwJyWvn7LxY:1774`, `~/.local/share/opencode/tool-output/tool_d52e77dde001ehcfwJyWvn7LxY:1775`; backend API flow tests `repo/backend/test/api.test.ts:55`; frontend test/build scripts `repo/frontend/package.json:9`, `repo/frontend/package.json:7`
- Reproducible verification method:
  - Same commands as above.
  - Expected: backend `85 passed`, frontend `31 passed`, frontend build output generated.

### 1.3 Severe deviation from prompt theme?
- Conclusion: **Pass**
- Reason (basis): Delivery remains centered on LocalTrade marketplace ops, RBAC roles, listing/media workflow, order/payment/refund/review/appeal/moderation/admin, offline/on-prem architecture.
- Evidence: `repo/backend/src/server.ts:96`, `repo/backend/src/routes/listings.ts:29`, `repo/backend/src/routes/media.ts:11`, `repo/backend/src/routes/orders.ts:23`, `repo/backend/src/routes/reviews.ts:9`, `repo/frontend/src/app/app.routes.ts:34`
- Reproducible verification method:
  - Read route map and role-guarded frontend routes.
  - Expected: feature coverage aligns with prompt business flow.

---

## 2) Delivery Completeness

### 2.1 Core prompt requirements coverage

- Conclusion: **Partially Pass**
- Reason (basis): Vast majority implemented (upload/chunking, MIME sniffing, content safety, RBAC, payment/refund/review/appeal, signed URLs, backup, anti-replay/rate limit); however, key gaps exist in async queue behavior and crash-recovery cadence.
- Evidence:
  - Upload constraints/constants: `repo/backend/src/domain.ts:1`, `repo/backend/src/domain.ts:4`
  - MIME sniff + mismatch reject: `repo/backend/src/services/media-service.ts:15`, `repo/backend/src/services/media-service.ts:114`
  - Publish gate: `repo/backend/src/domain.ts:19`, `repo/backend/src/services/listing-service.ts:80`
  - Review window/limits: `repo/backend/src/domain.ts:10`, `repo/backend/src/routes/reviews.ts:11`
  - Refund threshold >$250: `repo/backend/src/domain.ts:6`
  - Signed URL TTL default 15m: `repo/backend/src/config.ts:26`, `repo/backend/src/services/media-service.ts:181`
  - Webhook CIDR + HMAC: `repo/backend/src/security/network.ts:42`, `repo/backend/src/services/admin-service.ts:39`
  - Nightly encrypted backup + 30-day prune: `repo/backend/src/jobs/worker.ts:13`, `repo/backend/src/jobs/worker.ts:192`
- Reproducible verification method:
  - Run backend integration tests: `npm --prefix backend test`
  - Expected: flow/security tests pass (uploads/orders/reviews/refunds/webhooks/rate-limit/replay/etc).

### 2.2 0->1 deliverable form (not fragment/demo-only)

#### 2.2.a Real logic vs hardcode/mock replacement
- Conclusion: **Pass**
- Reason (basis): Real DB-backed domain logic and API layers are implemented; payment adapter is offline-pluggable (acceptable for prompt).
- Evidence: `repo/backend/src/services/payment-gateway-adapter.ts:12`, `repo/backend/src/repositories/payment-repository.ts:9`, `repo/backend/src/db/migrate.ts:15`
- Reproducible verification method:
  - Inspect adapter + repository + integration tests.
  - Expected: real persistence/idempotency behavior, not static mock responses.

#### 2.2.b Complete project structure
- Conclusion: **Pass**
- Reason (basis): Backend/frontend split, migrations, repositories/services/routes, worker, tests, docs/readme all present.
- Evidence: `repo/backend/src/server.ts:1`, `repo/backend/migrations/001_init.sql:1`, `repo/frontend/src/app/app.routes.ts:1`, `repo/backend/test/api.test.ts:45`
- Reproducible verification method:
  - Tree scan + targeted reads.
  - Expected: coherent multi-module application, not single-file sample.

#### 2.2.c Basic documentation exists
- Conclusion: **Pass**
- Reason (basis): README includes startup, credentials, tests, backup/restore, production secret guard notes.
- Evidence: `repo/README.md:3`, `repo/README.md:17`, `repo/README.md:31`, `repo/README.md:61`
- Reproducible verification method:
  - Open README and execute listed commands.
  - Expected: commands map to project scripts/services.

#### 2.2.d Mock/stub handling judgment (mandatory)
- Conclusion: **Pass (Not an issue)**
- Reason (basis): Offline payment adapter is explicitly aligned with on-prem/offline prompt; no third-party gateway is required. Risk boundary: adapter is always local by design, not accidental mock fallback.
- Evidence: `repo/backend/src/services/payment-gateway-adapter.ts:12`, `repo/backend/src/services/payment-service.ts:16`
- Reproducible verification method:
  - Trigger `/api/payments/capture` and `/api/payments/import-settlement` in tests.
  - Expected: local DB-backed capture/import semantics.

---

## 3) Engineering & Architecture Quality

### 3.1 Structure/modularity reasonableness
- Conclusion: **Partially Pass**
- Reason (basis): Layering is generally clean (routes -> services -> repositories), but media postprocess queue is invoked synchronously in request flow, weakening decoupling.
- Evidence: good layering `repo/backend/src/routes/orders.ts:4`, `repo/backend/src/services/order-service.ts:9`, `repo/backend/src/repositories/order-repository.ts:3`; coupling concern `repo/backend/src/services/media-service.ts:142`
- Reproducible verification method:
  - Trace `finalizeUpload` call path.
  - Expected for true async queue: request returns after enqueue only; current code waits on worker function.

### 3.2 Maintainability/extensibility awareness
- Conclusion: **Partially Pass**
- Reason (basis): Good extensibility patterns exist (RBAC, adapter, repositories), but maintainability risks include oversized files and missing periodic stale-job watchdog scheduling.
- Evidence: extensible RBAC `repo/backend/src/plugins/auth.ts:37`; adapter `repo/backend/src/services/payment-gateway-adapter.ts:6`; large test file `repo/backend/test/api.test.ts:1`; watchdog only defined/called once `repo/backend/src/jobs/worker.ts:25`, `repo/backend/src/server.ts:120`
- Reproducible verification method:
  - Review worker scheduling and file organization.
  - Expected: periodic stale-job sweep + smaller focused test modules.

---

## 4) Engineering Details & Professionalism

### 4.1 Error handling, logging, validation, interface design

#### 4.1.a Error handling reliability/user-friendliness
- Conclusion: **Pass**
- Reason (basis): Typed `HttpError`, centralized route error helper, structured API error codes/messages.
- Evidence: `repo/backend/src/utils/http-error.ts:1`, `repo/backend/src/routes/_shared.ts:5`, `repo/backend/src/server.ts:83`
- Reproducible verification method:
  - Hit invalid path/state cases from tests (e.g., MIME mismatch, invalid transitions).
  - Expected: consistent `code` + message + status.

#### 4.1.b Logging for problem localization
- Conclusion: **Pass (with minor caution)**
- Reason (basis): Fastify structured request logs + audit log table for business actions; startup scripts still use `console.error` (acceptable but less structured).
- Evidence: `repo/backend/src/server.ts:30`, `repo/backend/src/repositories/audit-repository.ts:5`, `repo/backend/src/db/migrate.ts:47`
- Reproducible verification method:
  - Run backend tests and inspect logs/audit rows.
  - Expected: request lifecycle logs and persisted audit actions.

#### 4.1.c Key input/boundary validation
- Conclusion: **Pass**
- Reason (basis): Zod validation across route payloads/params, SQL parameterization, domain boundary checks (file size, chunk size, review window, thresholds, RBAC).
- Evidence: `repo/backend/src/routes/media.ts:13`, `repo/backend/src/routes/refunds.ts:21`, `repo/backend/src/repositories/listing-repository.ts:6`, `repo/backend/src/domain.ts:10`
- Reproducible verification method:
  - Execute negative tests in `api.test.ts` (400/409/403 cases).
  - Expected: invalid payloads/transitions rejected.

### 4.2 Product-level organization vs demo-level
- Conclusion: **Pass**
- Reason (basis): End-to-end role workflows, background jobs, RBAC, audit, moderation/arbitration/admin UX, and persistent data model indicate product form.
- Evidence: `repo/backend/migrations/001_init.sql:8`, `repo/backend/src/routes/admin.ts:11`, `repo/frontend/src/app/app.routes.ts:50`
- Reproducible verification method:
  - Run API integration tests and frontend build/tests.
  - Expected: complete multi-role feature surface.

---

## 5) Prompt Understanding & Fitness

### 5.1 Business goals, scenario, and constraints fitness
- Conclusion: **Partially Pass**
- Reason (basis): Core business semantics are implemented (including your clarifications: refund threshold boundary, review window boundary, cancel-state restrictions, appeal uniqueness, deactivation listing removal, settlement dedupe, signed URL scope), but queue execution/recovery details deviate from expected robust async worker behavior.
- Evidence:
  - Threshold/window/cancel semantics: `repo/backend/src/domain.ts:6`, `repo/backend/src/domain.ts:10`, `repo/backend/src/domain.ts:15`
  - Appeal uniqueness: `repo/backend/migrations/001_init.sql:170`, `repo/backend/src/services/review-service.ts:128`
  - Deactivation side effects: `repo/backend/src/repositories/user-repository.ts:84`
  - Settlement dedupe summary: `repo/backend/src/services/payment-gateway-adapter.ts:17`
  - Queue deviation: `repo/backend/src/services/media-service.ts:142`, `repo/backend/src/server.ts:120`
- Reproducible verification method:
  - Review above code paths + run integration tests for covered semantics.
  - Expected: most business rules pass; async watchdog cadence remains a gap.

---

## 6) Aesthetics / Interaction (frontend applicable)

### 6.1 Visual and interaction quality
- Conclusion: **Pass**
- Reason (basis): Role-distinguished visual language, responsive shell/sidebar, status chips/badges, upload progress/retry states, form feedback and toasts are implemented.
- Evidence: `repo/frontend/src/styles.css:21`, `repo/frontend/src/app/app.css:253`, `repo/frontend/src/app/features/upload/upload.component.ts:97`, `repo/frontend/src/app/features/storefront/seller-storefront.component.ts:115`
- Reproducible verification method:
  - `npm --prefix frontend run build` then serve app.
  - Expected: desktop/mobile layout adapts; interactive feedback visible.

---

## Security-Focused Acceptance (Priority)

### Authentication entry points
- Conclusion: **Pass**
- Basis: JWT login/refresh, password hashing, refresh-token rotation/revocation, inactive-user block.
- Evidence: `repo/backend/src/auth.ts:31`, `repo/backend/src/services/auth-service.ts:13`, `repo/backend/src/services/auth-service.ts:26`
- Reproduction idea:
  - `POST /api/auth/login`, `POST /api/auth/refresh`, stale refresh rejection in tests (`repo/backend/test/api.test.ts:1384`).

### Route-level authorization
- Conclusion: **Pass**
- Basis: route preHandlers consistently use `authenticate` + `authorize([...])` per role.
- Evidence: `repo/backend/src/routes/admin.ts:12`, `repo/backend/src/routes/reviews.ts:9`, `repo/backend/src/routes/moderation.ts:9`
- Reproduction idea:
  - Use wrong-role tokens on protected routes; expect `403` (covered in `repo/backend/test/api.test.ts:1280`).

### Object-level authorization (ownership/resource checks)
- Conclusion: **Pass (with one medium gap listed below)**
- Basis: ownership checks implemented on listings/orders/payments/refunds/assets/review appeals.
- Evidence: `repo/backend/src/services/listing-service.ts:50`, `repo/backend/src/services/order-service.ts:22`, `repo/backend/src/services/payment-service.ts:14`, `repo/backend/src/services/refund-service.ts:14`, `repo/backend/src/services/media-service.ts:175`
- Reproduction idea:
  - Cross-user operations in tests (`repo/backend/test/api.test.ts:1330`, `repo/backend/test/api.test.ts:1604`).

### Data isolation
- Conclusion: **Pass**
- Basis: payment/order/refund/resource reads are scoped to actor role and ownership.
- Evidence: `repo/backend/src/services/payment-service.ts:43`, `repo/backend/src/services/order-service.ts:87`, `repo/backend/src/services/refund-service.ts:63`
- Reproduction idea:
  - unrelated buyer reading payment/refund should fail (`repo/backend/test/api.test.ts:2064`).

### Admin/debug interface protection
- Conclusion: **Partially Pass**
- Basis: admin APIs are protected; API docs endpoint is open by default.
- Evidence: admin protection `repo/backend/src/routes/admin.ts:12`; docs open `repo/backend/src/server.ts:79`
- Reproduction idea:
  - `GET /api/admin/users` without token -> `401/403`; `GET /docs` without auth -> currently accessible.

---

## Unit Tests / API Functional Tests / Log Categorization

### Unit tests
- Conclusion: **Pass**
- Basis: backend unit tests for domain/security/worker primitives and frontend component/service/guard tests exist and run.
- Evidence: `repo/backend/test/domain.test.ts:11`, `repo/backend/test/security.test.ts:5`, `repo/backend/test/worker.test.ts:60`, `repo/frontend/src/app/core/auth.service.spec.ts:7`
- Verification command:
  - `npm --prefix backend test`
  - `npm --prefix frontend test -- --watch=false`

### API interface functional tests
- Conclusion: **Pass**
- Basis: extensive backend integration suite covers multi-step business flows and many error/security paths.
- Evidence: `repo/backend/test/api.test.ts:45`, `repo/backend/test/api.test.ts:2125`
- Verification command:
  - `npm --prefix backend test`

### Log printing categorization and sensitive-leak risk
- Conclusion: **Partially Pass**
- Basis: structured request logs + DB audit categories are strong; no direct token/password logging observed in app code, but no dedicated automated assertions for log redaction.
- Evidence: `repo/backend/src/server.ts:30`, `repo/backend/src/repositories/audit-repository.ts:5`, `repo/backend/test/api.test.ts:1551`
- Verification command:
  - Run backend tests and inspect runtime logs + `audit_logs` table.

---

## Test Coverage Assessment (Static Audit)

### Test Overview

- Backend framework/entry: Vitest + Node env (`repo/backend/vitest.config.ts:1`, `repo/backend/package.json:10`)
- Frontend framework/entry: Angular unit-test builder + `ng test` (`repo/frontend/angular.json:73`, `repo/frontend/package.json:9`)
- README test command present: `repo/README.md:25`
- Test inventory examples:
  - backend: `repo/backend/test/api.test.ts:45`, `repo/backend/test/domain.test.ts:11`, `repo/backend/test/security-hardening.test.ts:5`
  - frontend: `repo/frontend/src/app/features/upload/upload.component.spec.ts:12`, `repo/frontend/src/app/core/auth.guard.spec.ts:8`

### Requirement Checklist (extracted from prompt + implicit constraints)

1. AuthN/AuthZ/RBAC with anti-privilege escalation
2. Object-level ownership/data isolation
3. Upload constraints + resumable chunks + idempotent retry + server MIME sniff
4. Publish gate with moderation block
5. Orders/payment/refund state transitions + idempotency
6. Review window/limits/media restrictions + appeals
7. Storefront ranking + 90-day metrics + badges
8. Signed URLs + webhook security + anti-replay + rate limiting
9. Encryption/masking sensitive fields
10. Queue/retry/watchdog/backups
11. Boundary/error paths (401/403/404/409/duplicates)
12. Concurrency/data consistency risk areas

### Coverage Mapping Table

| Requirement / Risk Point | Corresponding Test Case (file:line) | Key Assertion / Fixture / Mock (file:line) | Coverage Judgment | Gap | Minimal Test Addition Suggestion |
|---|---|---|---|---|---|
| Auth login/refresh/logout | `repo/backend/test/api.test.ts:1363`, `repo/backend/test/api.test.ts:1384` | stale refresh rejected `INVALID_REFRESH_TOKEN` (`repo/backend/test/api.test.ts:1395`) | Sufficient | none major | add explicit refresh expiry boundary test |
| Route-level RBAC | `repo/backend/test/api.test.ts:1280`, `repo/backend/test/api.test.ts:1508` | wrong-role 403 matrix (`repo/backend/test/api.test.ts:1524`) | Sufficient | none major | keep matrix updated when adding routes |
| Object-level authorization | `repo/backend/test/api.test.ts:1330`, `repo/backend/test/api.test.ts:1638` | NOT_OWNER/FORBIDDEN checks (`repo/backend/test/api.test.ts:1343`) | Sufficient | none major | add negative tests for every new write endpoint |
| Data isolation (payments/orders/refunds/assets) | `repo/backend/test/api.test.ts:2064`, `repo/backend/test/api.test.ts:1604` | unrelated buyer blocked (`repo/backend/test/api.test.ts:2082`) | Sufficient | none major | add list endpoint leakage snapshots |
| Anti-replay nonce + timestamp window | `repo/backend/test/api.test.ts:406`, `repo/backend/test/api.test.ts:1764` | REPLAY_DETECTED/TIMESTAMP_OUT_OF_WINDOW (`repo/backend/test/api.test.ts:1777`) | Sufficient | none major | add high-frequency collision simulation |
| Rate limiting 60/min | `repo/backend/test/api.test.ts:1195`, `repo/backend/test/api.test.ts:1780` | 429 + `Retry-After` (`repo/backend/test/api.test.ts:1788`) | Sufficient | none major | add per-user isolation rate-limit test |
| Upload MIME sniff mismatch | `repo/backend/test/api.test.ts:293`, `repo/backend/test/api.test.ts:1687` | `MIME_TYPE_MISMATCH` assertions (`repo/backend/test/api.test.ts:330`) | Sufficient | small-file bypass path not explicitly tested with failed-status attach coupling | add test: failed asset cannot be attached to review |
| Chunk idempotency/retry | `repo/backend/test/api.test.ts:96`, `repo/backend/test/api.test.ts:333` | `already_received` + retry success (`repo/backend/test/api.test.ts:107`) | Sufficient | none major | add multi-chunk out-of-order upload test |
| Publish gate blocking rules | `repo/backend/test/api.test.ts:1026` | LISTING_NOT_READY reasons (`repo/backend/test/api.test.ts:1041`) | Sufficient | none major | add combined flagged+pending assets case |
| Order state machine | `repo/backend/test/api.test.ts:2125`, `repo/backend/test/api.test.ts:1992` | invalid cancel after capture (`repo/backend/test/api.test.ts:2009`) | Sufficient | none major | add admin force-complete negative path test |
| Payment idempotency + settlement dedupe | `repo/backend/test/api.test.ts:1816`, `repo/backend/test/api.test.ts:1399` | duplicate tx key 409 (`repo/backend/test/api.test.ts:1835`) | Sufficient | concurrent import race not covered | add parallel import race test |
| Refund threshold + approval/confirm | `repo/backend/test/api.test.ts:203`, `repo/backend/test/api.test.ts:1435`, `repo/backend/test/api.test.ts:1464` | 25000 vs 25001 boundary (`repo/backend/test/api.test.ts:226`) | Sufficient | none major | add reject-then-reconfirm negative test |
| Review window and duplicate review | `repo/backend/test/domain.test.ts:17`, `repo/backend/test/api.test.ts:431`, `repo/backend/test/api.test.ts:1839` | REVIEW_WINDOW_EXPIRED (`repo/backend/test/api.test.ts:455`) | Sufficient | none major | add exactly-at-boundary API test |
| Review image constraints and appeal uniqueness | `repo/backend/test/api.test.ts:715`, `repo/backend/test/api.test.ts:792` | max-5 + type checks (`repo/backend/test/api.test.ts:748`) | Basic Coverage | missing assertion that asset must be `ready` | add test for `asset.status != ready` rejection |
| Storefront ranking/metrics/badges | `repo/backend/test/api.test.ts:498`, `repo/backend/test/api.test.ts:1699`, `repo/backend/test/api.test.ts:2012`, `repo/backend/test/api.test.ts:2179` | sort + metric values + badges (`repo/backend/test/api.test.ts:2037`) | Sufficient | none major | add empty-seller no-review rendering API test |
| Webhook security (CIDR + signature headers) | `repo/backend/test/security-hardening.test.ts:6`, `repo/backend/test/api.test.ts:611`, `repo/backend/test/api.test.ts:669` | blocked CIDR and signature headers (`repo/backend/test/api.test.ts:709`) | Sufficient | retry policy not tested (by design fire-and-forget) | add explicit no-retry behavior assertion |
| Sensitive field encryption/masking | `repo/backend/test/security.test.ts:6`, `repo/backend/test/api.test.ts:2041` | AES-GCM + masked output (`repo/backend/test/api.test.ts:2055`) | Sufficient | none major | add key-rotation migration test |
| Backup retention/worker jobs | `repo/backend/test/worker.test.ts:72` | prune old backups + complete job (`repo/backend/test/worker.test.ts:89`) | Basic Coverage | stale-job watchdog periodic behavior not tested | add watchdog scheduler cadence + retry-count tests |
| Pagination/filter/time boundaries | partial in admin users list | basic page query usage (`repo/backend/src/routes/admin.ts:14`) | Insufficient | limited tests for page bounds, empty pages, time filters | add API tests for pageSize max/min and empty result pages |
| Concurrency/data consistency (store credit debit race) | none found | store-credit logic under test is single-threaded (`repo/backend/src/repositories/payment-repository.ts:21`) | Missing | no concurrent capture race tests | add parallel capture test on same buyer balance |
| Tenant isolation | single-tenant on-prem design | N/A | Not Applicable | no tenant model in schema | if multi-tenant introduced, add tenant boundary tests |

### Security Coverage Audit (mandatory)

- Authentication: **Covered** (login/refresh/logout/tamper/expiry) -> sufficient.
- Route authorization: **Covered** (role matrix and forbidden paths) -> sufficient.
- Object-level authorization: **Covered** for key resources -> sufficient.
- Data isolation: **Covered** for payment/assets/orders/refunds -> sufficient.
- Admin/debug interface protection: **Partially covered**; open `/docs` remains a risk.

### Overall judgment: can tests catch vast majority of problems?

- Conclusion: **Partially Pass**
- Boundary explanation:
  - Covered well: core happy paths, major role/security gates, many boundary/error paths, integration chains.
  - Not fully covered: concurrency/race conditions (store credit), queue-crash recovery cadence, and some maintainability/security edge behaviors (open docs, non-ready review asset attach). These gaps can allow severe defects while tests remain green.

---

## Prioritized Issues (with impact and minimal actionable fix)

### [High] Asset postprocess queue is not truly decoupled async
- Evidence: `repo/backend/src/services/media-service.ts:142` (awaits worker in request path), heavy work in `repo/backend/src/jobs/worker.ts:65`
- Impact: upload finalize latency/timeouts under load; weak high-concurrency behavior vs prompt.
- Repro path:
  1. Upload large mp4 and call finalize.
  2. Observe request waits while optimization/transcoding runs.
- Minimal fix:
  1. Keep enqueue only in finalize.
  2. Return `202` immediately.
  3. Run dedicated background worker loop separate from request thread.

### [High] Stale-job watchdog recovery is not periodic (only startup call)
- Evidence: startup one-shot `repo/backend/src/server.ts:120`; recovery logic exists `repo/backend/src/jobs/worker.ts:25`; no periodic scheduler for it.
- Impact: worker crash can leave jobs stuck in `processing` until restart.
- Repro path:
  1. Force job to `processing` with old `locked_at`.
  2. Keep app running without restart.
  3. Observe no automatic requeue/failed transition.
- Minimal fix:
  1. Add `setInterval(recoverStaleJobs, 5 * 60 * 1000)`.
  2. Keep current retry threshold logic.

### [High] Store-credit capture has concurrency/race risk and no reserve stage
- Evidence: balance check then debit without reservation/locking across buyer ledger `repo/backend/src/repositories/payment-repository.ts:21`, `repo/backend/src/repositories/payment-repository.ts:39`
- Impact: concurrent captures may overspend credit; data consistency risk under concurrent payment requests.
- Repro path:
  1. Issue limited store credit to buyer.
  2. Send parallel capture requests for separate orders consuming same balance.
  3. Potential double-spend under read-committed race.
- Minimal fix:
  1. Introduce reserve/hold rows per order.
  2. Serialize buyer ledger updates (advisory lock or stricter transaction strategy).
  3. Add concurrent integration tests.

### [Medium] API documentation endpoint exposed without authentication
- Evidence: Swagger UI registration has no auth guard `repo/backend/src/server.ts:79`
- Impact: endpoint/contract discovery for admin/internal APIs by unauthenticated users.
- Repro path:
  1. `GET /docs` without token.
  2. Observe docs are accessible.
- Minimal fix:
  1. Protect `/docs` behind admin auth in non-dev.
  2. Optionally disable in production.

### [Medium] Review image attach path does not require `asset.status = ready`
- Evidence: attach validation checks listing/type but not asset readiness `repo/backend/src/services/review-service.ts:107`, `repo/backend/src/services/review-service.ts:115`
- Impact: failed/unprocessed assets may be attached, causing broken review media UX/integrity.
- Repro path:
  1. Create asset with valid ext/mime but `status='failed'`.
  2. Attach via `/api/reviews/:id/images`.
  3. Observe acceptance if ownership/type checks pass.
- Minimal fix:
  1. Enforce `asset.status === 'ready'` in create/attach review image flows.
  2. Add tests for failed/processing status rejection.

### [Low] Orders status filter omits `refunded`
- Evidence: status enum excludes refunded in list query parser `repo/backend/src/routes/orders.ts:13`
- Impact: cannot directly filter refunded orders through API query.
- Repro path:
  1. Create refunded order.
  2. Call `/api/orders?status=refunded`.
  3. Observe validation rejection.
- Minimal fix:
  1. Add `refunded` to route status enum.
  2. Add one API filter test.

---

## Final Acceptance Verdict

- Overall project acceptance: **Partially Pass**
- Rationale: strong functional breadth, strong RBAC/auth/object-authorization baseline, substantial integration tests, and runnable build/test pipeline. Fails full pass due high-priority async queue/recovery/data-consistency gaps that can manifest as production defects despite passing tests.
