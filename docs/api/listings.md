# Listings API

## POST /api/listings
- Required role: `seller`
- Request: `{ title, description, priceCents, quantity, category }`
- Success 201: `{ id, status:"draft" }`
- Errors: `400 VALIDATION_ERROR`, `403 FORBIDDEN`
- Business rules: title/description pass content keyword scan.

## PATCH /api/listings/:id
- Required role: `seller` (owner)
- Request: partial listing fields
- Success 200: updated listing
- Errors: `404 LISTING_NOT_FOUND`, `403 NOT_OWNER`, `409 LISTING_LOCKED`
- Business rules: published listing edits may trigger re-scan and temporary flag.

## POST /api/listings/:id/publish
- Required role: `seller` (owner)
- Request: none
- Success 200: `{ id, status:"published" }`
- Errors: `409 LISTING_NOT_READY`, `409 LISTING_FLAGGED`, `403 NOT_OWNER`
- Business rules: all assets must be ready and listing unflagged.

## GET /api/listings
- Required role: `seller`
- Request: query `{ status? }`
- Success 200: `{ items:[{ id, title, status, priceCents, quantity, assetCount, readiness }] }`
- Errors: `400 VALIDATION_ERROR`
- Business rules: returns seller's own listings only.

## DELETE /api/listings/:id
- Required role: `seller|admin`
- Request: query `{ force? }`
- Success 200: `{ id, status:"removed" }`
- Errors: `404 LISTING_NOT_FOUND`, `409 ACTIVE_ORDERS_EXIST`, `403 NOT_OWNER`
- Business rules: seller cannot remove listings with active orders; admin can force remove with `force=true`.

## GET /api/storefront/listings
- Required role: `buyer|public`
- Request: query filters/sort
- Success 200: paginated published listings
- Errors: `400 VALIDATION_ERROR`
- Business rules: removed/flagged/draft listings excluded.
