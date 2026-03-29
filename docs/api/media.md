# Media API

## POST /api/media/upload-sessions
- Required role: `seller`
- Request: `{ listingId, fileName, sizeBytes, extension, totalChunks, chunkSizeBytes }`
- Success 201: `{ sessionId, assetId, accepted:true }`
- Errors: `400 INVALID_FILE_TYPE`, `400 FILE_TOO_LARGE`, `409 FILE_LIMIT_REACHED`
- Business rules: max 20 files/listing, max 2 GB/file, allowed extensions only.

## PUT /api/media/upload-sessions/:sessionId/chunks/:chunkIndex
- Required role: `seller` (owner)
- Request: binary chunk body
- Success 200: `{ status:"received"|"already_received" }`
- Errors: `400 CHUNK_OUT_OF_RANGE`, `404 SESSION_NOT_FOUND`, `409 SESSION_REJECTED`
- Business rules: chunks are idempotent by `(session, index)` unique key.

## POST /api/media/upload-sessions/:sessionId/finalize
- Required role: `seller` (owner)
- Request: `{ checksum? }`
- Success 202: `{ assetId, status:"processing" }`
- Errors: `400 MIME_TYPE_MISMATCH`, `400 MISSING_CHUNKS`, `409 FINGERPRINT_BLOCKED`
- Business rules: server-side MIME sniff authoritative; failed assembly discarded; blocked fingerprint detection uses existing `assets` rows with `status='blocked'` as source of truth.

## GET /api/media/assets/:assetId/signed-url
- Required role: `authenticated` with read permission
- Request: none
- Success 200: `{ url, expiresAt }`
- Errors: `404 ASSET_NOT_FOUND`, `403 FORBIDDEN`
- Business rules: signed URL TTL default 15 minutes.
