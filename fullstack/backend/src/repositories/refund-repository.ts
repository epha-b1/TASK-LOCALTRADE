import { pool, withTx } from "../db/pool.js";

export const refundRepository = {
  async create(input: { orderId: string; sellerId: string; amountCents: number; reason: string; status: "pending" | "approved"; requiresAdminApproval: boolean }) {
    const result = await pool.query(
      `INSERT INTO refunds(order_id, seller_id, amount_cents, reason, status, requires_admin_approval)
       VALUES($1, $2, $3, $4, $5, $6)
       RETURNING id, status, requires_admin_approval`,
      [input.orderId, input.sellerId, input.amountCents, input.reason, input.status, input.requiresAdminApproval],
    );
    return result.rows[0];
  },

  async findById(refundId: string) {
    const result = await pool.query("SELECT * FROM refunds WHERE id = $1", [refundId]);
    return result.rows[0] as Record<string, any> | undefined;
  },

  async setAdminDecision(refundId: string, adminId: string, status: "approved" | "rejected") {
    await pool.query("UPDATE refunds SET status = $1, approved_by = $2 WHERE id = $3", [status, adminId, refundId]);
  },

  async confirmRefund(input: { refundId: string; transactionKey: string; confirmedAt?: string }) {
    return withTx(async (client) => {
      const refund = await client.query("SELECT order_id FROM refunds WHERE id = $1", [input.refundId]);
      if (!refund.rowCount) return false;
      await client.query(
        "INSERT INTO payments(order_id, tender_type, amount_cents, transaction_key, status) VALUES($1, 'card_terminal_import', 1, $2, 'reversal_marker')",
        [refund.rows[0].order_id, input.transactionKey],
      );
      await client.query("UPDATE refunds SET status = 'confirmed', confirmed_at = COALESCE($1::timestamptz, NOW()) WHERE id = $2", [input.confirmedAt ?? null, input.refundId]);
      await client.query("UPDATE orders SET status = 'refunded', updated_at = NOW() WHERE id = $1", [refund.rows[0].order_id]);
      return true;
    });
  },

  async listByOrder(orderId: string) {
    const result = await pool.query(
      `SELECT r.id, r.order_id, r.seller_id, r.amount_cents, r.status, r.requires_admin_approval, r.created_at,
              o.buyer_id, l.seller_id AS listing_seller_id
       FROM refunds r
       JOIN orders o ON o.id = r.order_id
       JOIN listings l ON l.id = o.listing_id
       WHERE r.order_id = $1
       ORDER BY r.created_at DESC`,
      [orderId],
    );
    return result.rows;
  },

  async listPendingAdminRefunds() {
    const result = await pool.query(
      `SELECT r.id, r.order_id, r.seller_id, r.amount_cents, r.reason, r.status, r.requires_admin_approval, r.created_at,
              u.display_name AS seller_name
       FROM refunds r
       JOIN users u ON u.id = r.seller_id
       WHERE r.requires_admin_approval = true AND r.status = 'pending'
       ORDER BY r.created_at ASC`,
    );
    return result.rows;
  },

  async listAllAdminRefunds() {
    const result = await pool.query(
      `SELECT r.id, r.order_id, r.seller_id, r.amount_cents, r.reason, r.status, r.requires_admin_approval, r.created_at,
              u.display_name AS seller_name
       FROM refunds r
       JOIN users u ON u.id = r.seller_id
       ORDER BY r.created_at DESC`,
    );
    return result.rows;
  },
};
