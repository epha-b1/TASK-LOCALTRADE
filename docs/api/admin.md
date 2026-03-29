# Admin API

## GET /api/admin/users
- Required role: `admin`
- Request: query `{ page?, pageSize? }`
- Success 200: paginated users with roles and status
- Errors: `400 VALIDATION_ERROR`
- Business rules: pagination defaults apply when omitted.

## PATCH /api/admin/users/:id/roles
- Required role: `admin`
- Request: `{ roles[] }`
- Success 200: `{ id, roles[] }`
- Errors: `404 USER_NOT_FOUND`, `400 ADMIN_ROLE_EXCLUSIVE`
- Business rules: `admin` role is exclusive and cannot be combined with non-admin roles.

## GET /api/admin/refunds/pending
- Required role: `admin`
- Request: none
- Success 200: `{ items[] }`
- Errors: none
- Business rules: returns only refunds with `requiresAdminApproval=true` and `status=pending`.

## POST /api/admin/users/:id/store-credit
- Required role: `admin`
- Request: `{ amountCents, note }`
- Success 200: `{ userId, amountCents }`
- Errors: `404 USER_NOT_FOUND`, `409 USER_NOT_BUYER`
- Business rules: store credit can only be issued to users with buyer role.

## POST /api/admin/webhooks/subscriptions
- Required role: `admin`
- Request: `{ eventType, targetUrl, secret }`
- Success 201: `{ id, active:true }`
- Errors: `400 INVALID_LOCAL_URL`, `409 DUPLICATE_SUBSCRIPTION`
- Business rules: target URL must be in allowed local CIDR ranges.

## PATCH /api/admin/webhooks/subscriptions/:id
- Required role: `admin`
- Request: `{ active?, secret? }`
- Success 200: updated subscription
- Errors: `404 SUBSCRIPTION_NOT_FOUND`
- Business rules: secret rotation supported; updates audited.

## POST /api/admin/orders/:id/force-complete
- Required role: `admin`
- Request: `{ reason }`
- Success 200: `{ id, status:"completed" }`
- Errors: `409 INVALID_STATE_TRANSITION`, `400 REASON_REQUIRED`
- Business rules: operational override only; mandatory audit reason.

## POST /api/admin/backups/run
- Required role: `admin`
- Request: none
- Success 202: `{ jobId, status:"queued" }`
- Errors: `503 BACKUP_LOCKED`
- Business rules: one backup job at a time.
