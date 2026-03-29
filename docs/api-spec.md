# LocalTrade API Specification Index

## Domain Files
- Auth: `docs/api/auth.md`
- Users: `docs/api/users.md`
- Listings: `docs/api/listings.md`
- Media: `docs/api/media.md`
- Assets: `docs/api/assets.md`
- Jobs: `docs/api/jobs.md`
- Orders: `docs/api/orders.md`
- Payments: `docs/api/payments.md`
- Refunds: `docs/api/refunds.md`
- Reviews: `docs/api/reviews.md`
- Appeals: `docs/api/appeals.md`
- Moderation: `docs/api/moderation.md`
- Content Safety: `docs/api/content-safety.md`
- Storefront: `docs/api/storefront.md`
- Audit Logs: `docs/api/audit-logs.md`
- Admin: `docs/api/admin.md`

## Cross-Cutting Conventions
- Base URL: `/api`
- Auth: Bearer JWT unless endpoint marked public.
- Error format:
  - `{ code: string, message: string, details?: object, requestId: string }`
- Pagination:
  - query: `page`, `pageSize`
  - response: `{ items, page, pageSize, total }`
- Idempotency:
  - payments/refunds/imports use unique `transactionKey`.
- CORS:
  - enabled for browser clients with methods `GET,POST,PUT,PATCH,DELETE,OPTIONS`.
  - allowed headers include `Authorization`, `Content-Type`, `X-Request-Nonce`, `X-Request-Timestamp`.
- Security headers:
  - signed webhook headers and signed URL verification as documented in `docs/security.md`.
- OpenAPI/Swagger:
  - OpenAPI 3.0 spec is exposed via Fastify Swagger UI at `http://localhost:3000/docs`.
