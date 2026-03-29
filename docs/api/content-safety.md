# Content Safety API

## GET /api/admin/content-rules
- Required role: `admin`
- Request: none
- Success 200: `{ items:[{id, ruleType, pattern, active}] }`
- Errors: `401 UNAUTHORIZED`
- Business rules: rules are evaluated case-insensitive across title+description.

## POST /api/admin/content-rules
- Required role: `admin`
- Request: `{ ruleType:"keyword"|"regex", pattern, active }`
- Success 201: created rule
- Errors: `400 INVALID_REGEX`, `409 DUPLICATE_RULE`
- Business rules: keyword patterns auto-wrapped with word boundaries when needed.

## POST /api/admin/content-rules/:id/test
- Required role: `admin`
- Request: `{ text }`
- Success 200: `{ matched: boolean, matchDetail? }`
- Errors: `404 RULE_NOT_FOUND`
- Business rules: deterministic local regex engine with timeout guard.

## PATCH /api/admin/content-rules/:id
- Required role: `admin`
- Request: `{ ruleType?, pattern?, active? }`
- Success 200: updated rule
- Errors: `404 RULE_NOT_FOUND`, `400 INVALID_REGEX`
- Business rules: supports partial update; changes are audited.

## DELETE /api/admin/content-rules/:id
- Required role: `admin`
- Request: none
- Success 200: `{ id, active:false }`
- Errors: `404 RULE_NOT_FOUND`
- Business rules: soft delete only (`active=false`, `deleted_at` set); operation is audited.
