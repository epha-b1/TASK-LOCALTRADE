# Payments API

## POST /api/payments/capture
- Required role: `seller|admin`
- Request: `{ orderId, tenderType:"cash"|"check"|"store_credit"|"card_terminal_import", amountCents, transactionKey }`
- Success 201: `{ paymentId, orderStatus:"payment_captured" }`
- Errors: `409 IDEMPOTENCY_CONFLICT`, `409 AMOUNT_MISMATCH`, `409 INSUFFICIENT_STORE_CREDIT`
- Business rules: transaction key unique; store-credit uses internal ledger debit.

## POST /api/payments/import-settlement
- Required role: `admin`
- Request: multipart file or `{ records[] }`
- Success 200: `{ total, inserted, skipped }`
- Errors: `400 INVALID_FILE_FORMAT`, `422 RECORD_VALIDATION_FAILED`
- Business rules: duplicate transaction keys skipped, not fatal.

## GET /api/payments/:id
- Required role: `buyer|seller|admin` (context)
- Request: none
- Success 200: payment detail
- Errors: `404 PAYMENT_NOT_FOUND`, `403 FORBIDDEN`
- Business rules: buyers only own order; sellers own listing orders.
