import { pool } from "../db/pool.js";

export const securityRepository = {
  async incrementRateLimit(userId: string, bucketTs: number) {
    const result = await pool.query(
      `INSERT INTO rate_limit_buckets(user_id, bucket_ts, request_count)
       VALUES($1, $2, 1)
       ON CONFLICT (user_id, bucket_ts) DO UPDATE SET request_count = rate_limit_buckets.request_count + 1
       RETURNING request_count`,
      [userId, bucketTs],
    );
    return Number(result.rows[0].request_count);
  },

  async cleanupRateLimit(minBucketTs: number) {
    await pool.query("DELETE FROM rate_limit_buckets WHERE bucket_ts < $1", [minBucketTs]);
  },

  async sumRateLimit(userId: string, minBucketTs: number) {
    const result = await pool.query(
      "SELECT COALESCE(SUM(request_count), 0)::int AS total FROM rate_limit_buckets WHERE user_id = $1 AND bucket_ts >= $2",
      [userId, minBucketTs],
    );
    return Number(result.rows[0].total);
  },

  async incrementPublicRateLimit(clientKey: string, bucketTs: number) {
    const result = await pool.query(
      `INSERT INTO public_rate_limit_buckets(client_key, bucket_ts, request_count)
       VALUES($1, $2, 1)
       ON CONFLICT (client_key, bucket_ts) DO UPDATE SET request_count = public_rate_limit_buckets.request_count + 1
       RETURNING request_count`,
      [clientKey, bucketTs],
    );
    return Number(result.rows[0].request_count);
  },

  async cleanupPublicRateLimit(minBucketTs: number) {
    await pool.query("DELETE FROM public_rate_limit_buckets WHERE bucket_ts < $1", [minBucketTs]);
  },

  async sumPublicRateLimit(clientKey: string, minBucketTs: number) {
    const result = await pool.query(
      "SELECT COALESCE(SUM(request_count), 0)::int AS total FROM public_rate_limit_buckets WHERE client_key = $1 AND bucket_ts >= $2",
      [clientKey, minBucketTs],
    );
    return Number(result.rows[0].total);
  },

  async registerNonce(nonce: string) {
    await pool.query("INSERT INTO request_nonces(nonce) VALUES($1)", [nonce]);
  },

  async cleanupNonces() {
    await pool.query("DELETE FROM request_nonces WHERE created_at < NOW() - INTERVAL '10 minutes'");
  },
};
