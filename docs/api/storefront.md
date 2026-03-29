# Storefront API

## GET /api/storefront/listings
- Required role: `public|buyer`
- Request: query `{ ranking?, sellerId? }`
- Success 200: `{ items[] }` where items include listing data and seller review slice
- Errors: `400 VALIDATION_ERROR`
- Business rules: only published and not removed listings visible; `ranking` supports `verified_purchase_first|most_recent|highest_rated`.

## GET /api/storefront/sellers/:sellerId/credit-metrics
- Required role: `public|buyer`
- Request: none
- Success 200: `{ avgRating90d, positiveRate90d, reviewCount90d }`
- Errors: `404 SELLER_NOT_FOUND`
- Business rules: positive rate uses 4-5 stars over total reviews in 90-day window; null if zero reviews.
