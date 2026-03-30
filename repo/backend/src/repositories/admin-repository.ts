import { pool } from "../db/pool.js";

export const adminRepository = {
  async listJobs(limit = 200) {
    const result = await pool.query("SELECT id, type, status, retry_count, locked_at, created_at FROM jobs ORDER BY created_at DESC LIMIT $1", [limit]);
    return result.rows;
  },

  async findJob(id: string) {
    const result = await pool.query("SELECT * FROM jobs WHERE id = $1", [id]);
    return result.rows[0] as Record<string, any> | undefined;
  },

  async retryJob(id: string) {
    await pool.query("UPDATE jobs SET status = 'queued', retry_count = retry_count + 1, available_at = NOW(), updated_at = NOW() WHERE id = $1", [id]);
  },

  async createBackupJob() {
    const result = await pool.query("INSERT INTO jobs(type, payload_json, status) VALUES('backup', '{}'::jsonb, 'queued') RETURNING id");
    return result.rows[0].id as string;
  },

  async claimNextBackupJob() {
    const result = await pool.query(
      `UPDATE jobs j
       SET status = 'processing', locked_at = NOW(), updated_at = NOW()
       WHERE j.id = (
         SELECT id FROM jobs
         WHERE type = 'backup' AND status = 'queued'
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING j.id, j.payload_json`,
    );
    return result.rows[0] as { id: string; payload_json: Record<string, unknown> } | undefined;
  },

  async completeJob(jobId: string) {
    await pool.query("UPDATE jobs SET status = 'completed', locked_at = NULL, updated_at = NOW() WHERE id = $1", [jobId]);
  },

  async failJob(jobId: string, message: string) {
    await pool.query("UPDATE jobs SET status = 'failed', locked_at = NULL, last_error = $2, updated_at = NOW() WHERE id = $1", [jobId, message]);
  },

  async findWebhook(eventType: string, targetUrl: string) {
    const result = await pool.query("SELECT id FROM webhook_subscriptions WHERE event_type = $1 AND target_url = $2", [eventType, targetUrl]);
    return result.rows[0] as { id: string } | undefined;
  },

  async createWebhook(input: { createdBy: string; eventType: string; targetUrl: string; secretEnc: string }) {
    const result = await pool.query(
      `INSERT INTO webhook_subscriptions(created_by, event_type, target_url, secret_enc)
       VALUES($1, $2, $3, $4)
       RETURNING id, active`,
      [input.createdBy, input.eventType, input.targetUrl, input.secretEnc],
    );
    return result.rows[0] as { id: string; active: boolean };
  },

  async findWebhookById(id: string) {
    const result = await pool.query("SELECT id FROM webhook_subscriptions WHERE id = $1", [id]);
    return result.rows[0] as { id: string } | undefined;
  },

  async updateWebhook(input: { id: string; active?: boolean; secretEnc?: string }) {
    await pool.query(
      `UPDATE webhook_subscriptions
       SET active = COALESCE($1, active), secret_enc = COALESCE($2, secret_enc)
       WHERE id = $3`,
      [input.active ?? null, input.secretEnc ?? null, input.id],
    );
  },

  async listActiveWebhooksByEvent(eventType: string) {
    const result = await pool.query("SELECT id, target_url, secret_enc FROM webhook_subscriptions WHERE event_type = $1 AND active = TRUE", [eventType]);
    return result.rows as Array<{ id: string; target_url: string; secret_enc: string }>;
  },
};
