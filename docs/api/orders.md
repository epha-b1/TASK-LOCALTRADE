# Orders API

## POST /api/orders
- Required role: `buyer`
- Request: `{ listingId, quantity }`
- Success 201: `{ id, status:"placed", totalCents }`
- Errors: `404 LISTING_NOT_FOUND`, `409 INSUFFICIENT_STOCK`, `403 ROLE_NOT_ALLOWED`
- Business rules: only published listings can be ordered.

## POST /api/orders/:id/cancel
- Required role: `buyer` (owner)
- Request: `{ reason? }`
- Success 200: `{ id, status:"cancelled" }`
- Errors: `409 INVALID_STATE_TRANSITION`, `403 NOT_OWNER`
- Business rules: cancellation allowed only in `placed`.

## POST /api/orders/:id/complete
- Required role: `seller` (listing owner)
- Request: `{ note? }`
- Success 200: `{ id, status:"completed", completedAt }`
- Errors: `409 INVALID_STATE_TRANSITION`, `403 NOT_OWNER`
- Business rules: seller confirms fulfillment; admin override separate endpoint.

## GET /api/orders/:id
- Required role: `buyer|seller|admin` with object-level authorization
- Request: none
- Success 200: order detail including listing title, payment/refund status, and buyer info for seller/admin
- Errors: `404 ORDER_NOT_FOUND`, `403 FORBIDDEN`
- Business rules: buyers can only view own orders; sellers only orders for own listings.
