import { pool } from "../db/pool.js";

export const authRepository = {
  async createRefreshToken(tokenHash: string, userId: string) {
    await pool.query("INSERT INTO refresh_tokens(token_hash, user_id, expires_at) VALUES($1, $2, NOW() + INTERVAL '7 days')", [tokenHash, userId]);
  },

  async revokeRefreshToken(tokenHash: string) {
    await pool.query("UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1", [tokenHash]);
  },

  async findValidRefreshToken(tokenHash: string) {
    const result = await pool.query(
      `SELECT rt.user_id, u.status
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND rt.expires_at > NOW()`,
      [tokenHash],
    );
    return result.rows[0] as { user_id: string; status: string } | undefined;
  },

  async createPasswordResetToken(input: { userId: string; tokenHash: string; expiresAtIso: string; tokenEnc?: string }) {
    await pool.query(
      `INSERT INTO password_reset_tokens(user_id, token_hash, token_enc, expires_at)
       VALUES($1, $2, $3, $4::timestamptz)`,
      [input.userId, input.tokenHash, input.tokenEnc ?? null, input.expiresAtIso],
    );
  },

  async findLatestPendingPasswordResetTokenByUserId(userId: string) {
    const result = await pool.query(
      `SELECT user_id, token_enc, expires_at
       FROM password_reset_tokens
       WHERE user_id = $1
         AND used_at IS NULL
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId],
    );
    return result.rows[0] as { user_id: string; token_enc: string | null; expires_at: string } | undefined;
  },

  async findValidPasswordResetToken(tokenHash: string) {
    const result = await pool.query(
      `SELECT prt.id, prt.user_id
       FROM password_reset_tokens prt
       WHERE prt.token_hash = $1
         AND prt.used_at IS NULL
         AND prt.expires_at > NOW()`,
      [tokenHash],
    );
    return result.rows[0] as { id: string; user_id: string } | undefined;
  },

  async usePasswordResetToken(id: string) {
    await pool.query("UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1", [id]);
  },
};
