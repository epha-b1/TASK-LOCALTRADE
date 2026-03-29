# Moderation API

## GET /api/moderation/queue
- Required role: `moderator`
- Request: query `{ status?, page? }`
- Success 200: flagged items queue
- Errors: `400 VALIDATION_ERROR`
- Business rules: deterministic ordering by oldest flagged first.

## POST /api/moderation/listings/:listingId/decision
- Required role: `moderator`
- Request: `{ decision:"approve"|"reject", notes }`
- Success 200: `{ listingId, status:"draft"|"removed", decisionId }`
- Errors: `404 LISTING_NOT_FOUND`, `409 LISTING_NOT_FLAGGED`
- Business rules: decision must include notes and timestamp; audited.
