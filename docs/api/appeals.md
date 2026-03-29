# Appeals API

## POST /api/reviews/:id/appeal
- Required role: `seller`
- Request: `{ reason }`
- Success 201: `{ id, status:"open" }`
- Errors: `409 APPEAL_ALREADY_ACTIVE`, `403 NOT_REVIEW_OWNER`
- Business rules: seller must own the review's order context; one active appeal per review.

## POST /api/appeals
- Required role: `seller`
- Request: `{ reviewId, reason }`
- Success 201: `{ id, status:"open" }`
- Errors: `409 APPEAL_ALREADY_ACTIVE`, `403 NOT_REVIEW_OWNER`
- Business rules: one active appeal per review; seller may have many active appeals across reviews.

## GET /api/arbitration/appeals
- Required role: `arbitrator`
- Request: query filters
- Success 200: paginated appeal queue
- Errors: `400 VALIDATION_ERROR`
- Business rules: includes review context and prior moderation data.

## POST /api/arbitration/appeals/:id/resolve
- Required role: `arbitrator`
- Request: `{ outcome:"uphold"|"modify"|"remove", note }`
- Success 200: `{ id, status, reviewStatus }`
- Errors: `404 APPEAL_NOT_FOUND`, `409 APPEAL_NOT_OPEN`
- Business rules: decision updates review badges/status and writes audit log.
