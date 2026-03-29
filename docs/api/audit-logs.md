# Audit Logs API

## GET /api/admin/audit-logs
- Required role: `admin`
- Request: query `{ page=1, pageSize=50, action?, targetType?, actorId?, from?, to? }`
- Success 200: `{ items, total, page, pageSize }`
- Errors: `400 VALIDATION_ERROR`
- Business rules: all sensitive actions are recorded and cannot be edited/deleted.

## GET /api/admin/audit-logs/:id
- Required role: `admin`
- Request: none
- Success 200: audit row detail
- Errors: `404 AUDIT_LOG_NOT_FOUND`
- Business rules: includes before/after snapshots and role context.
