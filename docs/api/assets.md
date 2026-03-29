# Assets API

## GET /api/assets/:id
- Required role: `seller|moderator|admin` (context-dependent)
- Request: none
- Success 200: `{ id, listingId, status, mimeType, sizeBytes, metadata }`
- Errors: `404 ASSET_NOT_FOUND`, `403 FORBIDDEN`
- Business rules: sellers can access only own listing assets.

## GET /api/assets/:id/metadata
- Required role: `seller|moderator|admin|buyer` (published visibility)
- Request: none
- Success 200: `{ width?, height?, durationSec?, codec? }`
- Errors: `409 METADATA_NOT_READY`, `404 ASSET_NOT_FOUND`
- Business rules: metadata shown only after job completion.

## GET /download/:assetId
- Required role: `public` (signed URL gate)
- Request: query `{ exp, sig }`
- Success 200: asset stream with source MIME type
- Errors: `403 INVALID_SIGNATURE`, `404 ASSET_NOT_FOUND`
- Business rules: signature is HMAC over `assetId:exp`; expired and tampered signatures are rejected.
