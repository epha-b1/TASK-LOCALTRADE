const defaultJwtSecret = "localtrade-dev-secret";
const defaultSignedUrlSecret = "signed-url-secret";
const defaultEncryptionKeyHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const nodeEnv = process.env.NODE_ENV ?? "development";
const jwtSecret = process.env.JWT_SECRET ?? defaultJwtSecret;
const signedUrlSecret = process.env.SIGNED_URL_SECRET ?? defaultSignedUrlSecret;
const encryptionKeyHex = process.env.ENCRYPTION_KEY_HEX ?? defaultEncryptionKeyHex;

if (!["development", "test"].includes(nodeEnv)) {
  const insecureDefaultsDetected = jwtSecret === defaultJwtSecret || signedUrlSecret === defaultSignedUrlSecret || encryptionKeyHex === defaultEncryptionKeyHex;
  if (insecureDefaultsDetected) {
    throw new Error("Production startup blocked: insecure default secrets detected. Set JWT_SECRET, SIGNED_URL_SECRET, and ENCRYPTION_KEY_HEX environment variables.");
  }
}

export const config = {
  nodeEnv,
  apiPort: Number(process.env.API_PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://localtrade:localtrade@localhost:5432/localtrade",
  jwtSecret,
  jwtAccessTtlSec: Number(process.env.JWT_ACCESS_TTL_SEC ?? 900),
  rateLimitPerMin: Number(process.env.RATE_LIMIT_PER_MIN ?? 60),
  nonceWindowSec: Number(process.env.NONCE_WINDOW_SEC ?? 300),
  signedUrlSecret,
  signedUrlTtlMin: Number(process.env.SIGNED_URL_TTL_MIN ?? 15),
  encryptionKeyHex,
  mediaRootPath: process.env.MEDIA_ROOT_PATH ?? "/tmp/localtrade-media",
  chunkRootPath: process.env.CHUNK_ROOT_PATH ?? "/tmp/localtrade-chunks",
  webhookAllowedCidrs: (process.env.WEBHOOK_ALLOWED_CIDRS ?? "127.0.0.1/32,10.0.0.0/8,192.168.0.0/16").split(","),
};
