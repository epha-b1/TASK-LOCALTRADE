import { runMigrations } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";
import { runSeed } from "../src/db/seed.js";

export async function resetDb() {
  await runMigrations();
  await pool.query(`
    TRUNCATE TABLE
      review_media,
      appeals,
      reviews,
      refunds,
      payments,
      orders,
      upload_chunks,
      upload_sessions,
      assets,
      moderation_decisions,
      content_scan_results,
      listings,
      webhook_subscriptions,
      store_credit_ledger,
      jobs,
      request_nonces,
      rate_limit_buckets,
      public_rate_limit_buckets,
      audit_logs,
      content_rules,
      user_roles,
      users
    RESTART IDENTITY CASCADE
  `);
  await runSeed();
}

export async function closeDb() {
  await pool.end();
}
