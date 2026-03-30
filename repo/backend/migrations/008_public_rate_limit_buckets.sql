CREATE TABLE IF NOT EXISTS public_rate_limit_buckets (
  client_key TEXT NOT NULL,
  bucket_ts BIGINT NOT NULL,
  request_count INT NOT NULL,
  PRIMARY KEY (client_key, bucket_ts)
);
