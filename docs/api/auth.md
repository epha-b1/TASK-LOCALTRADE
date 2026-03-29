# Auth API

## POST /api/auth/login
- Required role: `public`
- Request: `{ email: string, password: string }`
- Success 200: `{ accessToken, refreshToken, expiresIn, roles[] }`
- Errors: `401 INVALID_CREDENTIALS`, `423 USER_INACTIVE`, `429 RATE_LIMIT_EXCEEDED`
- Business rules: deactivated users cannot log in; login attempts audited.

## POST /api/auth/refresh
- Required role: `public` (valid refresh token)
- Request: `{ refreshToken: string }`
- Success 200: `{ accessToken, refreshToken, expiresIn }`
- Errors: `401 INVALID_REFRESH_TOKEN`, `409 TOKEN_REUSED`
- Business rules: refresh token rotation invalidates prior token.

## POST /api/auth/logout
- Required role: `authenticated`
- Request: `{ refreshToken: string }`
- Success 204
- Errors: `401 UNAUTHORIZED`
- Business rules: invalidates refresh token and logs audit event.

## POST /api/auth/forgot-password
- Required role: `public`
- Request: `{ email }`
- Success 200: `{ message: "Reset request created", resetToken }`
- Errors: `400 VALIDATION_ERROR`
- Business rules: offline mode returns reset token directly; token expires in 1 hour.

## POST /api/auth/reset-password
- Required role: `public`
- Request: `{ resetToken, newPassword }`
- Success 204
- Errors: `400 INVALID_RESET_TOKEN`, `400 VALIDATION_ERROR`
- Business rules: token must be valid and unexpired; token is invalidated after successful reset.
