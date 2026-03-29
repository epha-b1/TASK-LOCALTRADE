# Reviews API

## POST /api/reviews
- Required role: `buyer`
- Request: `{ orderId, rating(1-5), body(max1000), imageAssetIds[]<=5 }`
- Success 201: `{ id, status:"published" }`
- Errors: `409 REVIEW_WINDOW_EXPIRED`, `409 ORDER_NOT_COMPLETED`, `409 REVIEW_ALREADY_EXISTS`
- Business rules: review allowed only within 14 days inclusive from order completion.

## POST /api/reviews/:id/images
- Required role: `buyer`
- Request: `{ assetId }`
- Success 200: `{ reviewId, assetId }`
- Errors: `404 REVIEW_NOT_FOUND`, `404 ASSET_NOT_FOUND`, `403 NOT_OWNER`, `409 REVIEW_IMAGE_LIMIT_REACHED`
- Business rules: only review owner can attach; max 5 images per review.

## GET /api/storefront/sellers/:sellerId/reviews
- Required role: `public|buyer`
- Request: query `{ sortRule }`
- Success 200: `{ items[], creditMetrics }`
- Errors: `400 INVALID_SORT_RULE`
- Business rules: supports ranking rules: verified_purchase_first, most_recent, highest_rated.

## GET /api/reviews/:id
- Required role: `authenticated|public` (if published)
- Request: none
- Success 200: review detail + badges
- Errors: `404 REVIEW_NOT_FOUND`
- Business rules: include badges for `under_appeal` and `removed_by_arbitration`.
