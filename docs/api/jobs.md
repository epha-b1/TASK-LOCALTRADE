# Jobs API

## GET /api/admin/jobs
- Required role: `admin`
- Request: query `{ status?, type?, page? }`
- Success 200: paginated jobs
- Errors: `400 VALIDATION_ERROR`
- Business rules: operational visibility only.

## POST /api/admin/jobs/:id/retry
- Required role: `admin`
- Request: none
- Success 200: `{ id, status:"queued" }`
- Errors: `404 JOB_NOT_FOUND`, `409 JOB_NOT_RETRIABLE`
- Business rules: only failed jobs retriable manually.
