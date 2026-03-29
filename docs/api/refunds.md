# Refunds API

## GET /api/refunds
- Required role: `buyer|seller|admin`
- Request: query `{ orderId }`
- Success 200: `{ items[] }`
- Errors: `403 FORBIDDEN`
- Business rules: only order buyer, listing seller, or admin can view refund history for the order.

## POST /api/refunds
- Required role: `seller`
- Request: `{ orderId, amountCents, reason }`
- Success 201: `{ id, status:"pending"|"approved", requiresAdminApproval }`
- Errors: `409 INVALID_STATE_TRANSITION`, `409 REFUND_EXCEEDS_PAYMENT`
- Business rules: amount > 25000 cents requires admin approval; 25000 auto-approves.

## POST /api/refunds/:id/approve
- Required role: `admin`
- Request: `{ approve: boolean, note }`
- Success 200: `{ id, status:"approved"|"rejected" }`
- Errors: `404 REFUND_NOT_FOUND`, `409 REFUND_NOT_PENDING`
- Business rules: approval/rejection always audited.

## POST /api/refunds/import-confirmation
- Required role: `admin`
- Request: `{ transactionKey, refundId, confirmedAt }`
- Success 200: `{ refundId, status:"confirmed" }`
- Errors: `404 REFUND_NOT_FOUND`, `409 IDEMPOTENCY_CONFLICT`
- Business rules: uses same idempotent import model as payment settlement.
