# Users API

## GET /api/users/me
- Required role: `authenticated`
- Request: none
- Success 200: `{ id, email, displayName, status, roles[] }`
- Errors: `401 UNAUTHORIZED`
- Business rules: returns caller profile only.

## GET /api/users/me/store-credit
- Required role: `buyer`
- Request: none
- Success 200: `{ balanceCents }`
- Errors: `401 UNAUTHORIZED`, `403 FORBIDDEN`
- Business rules: returns current buyer store-credit balance.

## POST /api/admin/users
- Required role: `admin`
- Request: `{ email, password, displayName, roles[] }`
- Success 201: `{ id, email, roles[] }`
- Errors: `400 VALIDATION_ERROR`, `409 EMAIL_EXISTS`
- Business rules: `admin` role exclusive; role assignment audited.

## PATCH /api/admin/users/:id/status
- Required role: `admin`
- Request: `{ status: "active"|"inactive", reason: string }`
- Success 200: `{ id, status, listingsRemovedCount? }`
- Errors: `404 USER_NOT_FOUND`, `409 INVALID_STATE_TRANSITION`
- Business rules: inactive seller has published listings moved to removed in same transaction.
