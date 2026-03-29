import { pool, withTx } from "../db/pool.js";
import type { RoleCode } from "../types/auth.js";

export const userRepository = {
  async findByEmail(email: string) {
    const result = await pool.query(
      `SELECT u.id, u.email, u.password_hash, u.status, array_agg(r.code) AS roles
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE u.email = $1
       GROUP BY u.id`,
      [email],
    );
    return result.rows[0] as { id: string; email: string; password_hash: string; status: string; roles: RoleCode[] } | undefined;
  },

  async findMe(id: string) {
    const result = await pool.query(
      `SELECT u.id, u.email, u.display_name, u.status, u.tax_id_enc, u.bank_routing_enc, u.bank_account_enc, array_agg(r.code) AS roles
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE u.id = $1
       GROUP BY u.id`,
      [id],
    );
    return result.rows[0] as {
      id: string;
      email: string;
      display_name: string;
      status: string;
      roles: RoleCode[];
      tax_id_enc: string | null;
      bank_routing_enc: string | null;
      bank_account_enc: string | null;
    } | undefined;
  },

  async updateSellerSensitiveFields(input: { userId: string; taxIdEnc?: string | null; bankRoutingEnc?: string | null; bankAccountEnc?: string | null }) {
    const result = await pool.query(
      `UPDATE users
       SET tax_id_enc = COALESCE($1, tax_id_enc),
           bank_routing_enc = COALESCE($2, bank_routing_enc),
           bank_account_enc = COALESCE($3, bank_account_enc),
           updated_at = NOW()
       WHERE id = $4
       RETURNING id`,
      [input.taxIdEnc ?? null, input.bankRoutingEnc ?? null, input.bankAccountEnc ?? null, input.userId],
    );
    return result.rows[0] as { id: string } | undefined;
  },

  async createUser(input: { email: string; passwordHash: string; displayName: string; roles: RoleCode[] }) {
    return withTx(async (client) => {
      const user = await client.query(
        "INSERT INTO users(email, password_hash, display_name) VALUES($1, $2, $3) RETURNING id, email",
        [input.email, input.passwordHash, input.displayName],
      );
      for (const role of input.roles) {
        await client.query("INSERT INTO user_roles(user_id, role_id) SELECT $1, id FROM roles WHERE code = $2", [user.rows[0].id, role]);
      }
      return { id: user.rows[0].id as string, email: user.rows[0].email as string, roles: input.roles };
    });
  },

  async emailExists(email: string) {
    const result = await pool.query("SELECT 1 FROM users WHERE email = $1", [email]);
    return Boolean(result.rowCount);
  },

  async setPasswordHash(userId: string, passwordHash: string) {
    await pool.query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2", [passwordHash, userId]);
  },

  async setStatus(userId: string, status: "active" | "inactive") {
    return withTx(async (client) => {
      const existing = await client.query("SELECT id FROM users WHERE id = $1", [userId]);
      if (!existing.rowCount) {
        return null;
      }
      await client.query("UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2", [status, userId]);
      let listingsRemovedCount = 0;
      if (status === "inactive") {
        const updated = await client.query("UPDATE listings SET status = 'removed', updated_at = NOW() WHERE seller_id = $1 AND status = 'published'", [userId]);
        listingsRemovedCount = Number(updated.rowCount ?? 0);
      }
      return { id: userId, status, listingsRemovedCount };
    });
  },

  async getRoles(userId: string) {
    const result = await pool.query("SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1", [userId]);
    return result.rows.map((r) => r.code as RoleCode);
  },

  async listUsers(page: number, pageSize: number) {
    const offset = (page - 1) * pageSize;
    const totalResult = await pool.query("SELECT COUNT(*)::int AS c FROM users");
    const rows = await pool.query(
      `SELECT u.id, u.email, u.display_name, u.status, COALESCE(array_agg(r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       GROUP BY u.id
       ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    );
    return { items: rows.rows, total: Number(totalResult.rows[0].c) };
  },

  async updateRoles(userId: string, roles: RoleCode[]) {
    return withTx(async (client) => {
      const exists = await client.query("SELECT id FROM users WHERE id = $1", [userId]);
      if (!exists.rowCount) return null;
      await client.query("DELETE FROM user_roles WHERE user_id = $1", [userId]);
      for (const role of roles) {
        await client.query("INSERT INTO user_roles(user_id, role_id) SELECT $1, id FROM roles WHERE code = $2", [userId, role]);
      }
      return { id: userId, roles };
    });
  },

  async getStoreCreditBalance(userId: string) {
    const result = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN amount_cents ELSE -amount_cents END), 0) AS balance
       FROM store_credit_ledger WHERE buyer_id = $1`,
      [userId],
    );
    return Number(result.rows[0].balance);
  },

  async addStoreCredit(userId: string, amountCents: number, note: string) {
    await pool.query(
      `INSERT INTO store_credit_ledger(buyer_id, entry_type, amount_cents, note)
       VALUES($1, 'credit', $2, $3)`,
      [userId, amountCents, note],
    );
  },
};
