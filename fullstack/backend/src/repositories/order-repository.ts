import { pool } from "../db/pool.js";

export const orderRepository = {
  async create(input: { buyerId: string; listingId: string; quantity: number; totalCents: number }) {
    const result = await pool.query(
      `INSERT INTO orders(buyer_id, listing_id, quantity, total_cents)
       VALUES($1, $2, $3, $4)
       RETURNING id, status, total_cents`,
      [input.buyerId, input.listingId, input.quantity, input.totalCents],
    );
    return result.rows[0];
  },

  async findById(orderId: string) {
    const result = await pool.query("SELECT * FROM orders WHERE id = $1", [orderId]);
    return result.rows[0] as Record<string, any> | undefined;
  },

  async findWithListing(orderId: string) {
    const result = await pool.query(
      `SELECT o.*, l.seller_id
       FROM orders o JOIN listings l ON l.id = o.listing_id
       WHERE o.id = $1`,
      [orderId],
    );
    return result.rows[0] as Record<string, any> | undefined;
  },

  async setStatus(orderId: string, status: string, completed = false) {
    if (completed) {
      const result = await pool.query("UPDATE orders SET status = $1, completed_at = NOW(), updated_at = NOW() WHERE id = $2 RETURNING completed_at", [status, orderId]);
      return result.rows[0];
    }
    await pool.query("UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2", [status, orderId]);
    return undefined;
  },

  async listForBuyer(buyerId: string, status?: string) {
    const result = status
      ? await pool.query(
          `SELECT o.id, l.title AS listing_title, o.status, o.total_cents, o.created_at
           FROM orders o
           JOIN listings l ON l.id = o.listing_id
           WHERE o.buyer_id = $1 AND o.status = $2
           ORDER BY o.created_at DESC`,
          [buyerId, status],
        )
      : await pool.query(
          `SELECT o.id, l.title AS listing_title, o.status, o.total_cents, o.created_at
           FROM orders o
           JOIN listings l ON l.id = o.listing_id
           WHERE o.buyer_id = $1
           ORDER BY o.created_at DESC`,
          [buyerId],
        );
    return result.rows;
  },

  async listForSeller(sellerId: string, status?: string) {
    const result = status
      ? await pool.query(
          `SELECT o.id, l.title AS listing_title, o.status, o.total_cents, o.created_at
           FROM orders o
           JOIN listings l ON l.id = o.listing_id
           WHERE l.seller_id = $1 AND o.status = $2
           ORDER BY o.created_at DESC`,
          [sellerId, status],
        )
      : await pool.query(
          `SELECT o.id, l.title AS listing_title, o.status, o.total_cents, o.created_at
           FROM orders o
           JOIN listings l ON l.id = o.listing_id
           WHERE l.seller_id = $1
           ORDER BY o.created_at DESC`,
          [sellerId],
        );
    return result.rows;
  },

  async listAll(status?: string) {
    const result = status
      ? await pool.query(
          `SELECT o.id, l.title AS listing_title, o.status, o.total_cents, o.created_at
           FROM orders o
           JOIN listings l ON l.id = o.listing_id
           WHERE o.status = $1
           ORDER BY o.created_at DESC`,
          [status],
        )
      : await pool.query(
          `SELECT o.id, l.title AS listing_title, o.status, o.total_cents, o.created_at
           FROM orders o
           JOIN listings l ON l.id = o.listing_id
           ORDER BY o.created_at DESC`,
        );
    return result.rows;
  },

  async countActiveForListing(listingId: string) {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM orders
       WHERE listing_id = $1
         AND status IN ('placed', 'payment_captured')`,
      [listingId],
    );
    return Number(result.rows[0].c);
  },

  async findOrderDetail(orderId: string) {
    const result = await pool.query(
      `SELECT o.id,
              o.status,
              o.quantity,
              o.total_cents,
              o.created_at,
              o.completed_at,
              o.buyer_id,
              l.id AS listing_id,
              l.title AS listing_title,
              l.seller_id,
              bu.email AS buyer_email,
              bu.display_name AS buyer_display_name,
              pay.status AS payment_status,
              pay.tender_type,
              ref.status AS refund_status,
              ref.amount_cents AS refund_amount_cents
       FROM orders o
       JOIN listings l ON l.id = o.listing_id
       JOIN users bu ON bu.id = o.buyer_id
       LEFT JOIN LATERAL (
         SELECT p.status, p.tender_type
         FROM payments p
         WHERE p.order_id = o.id
         ORDER BY p.created_at DESC
         LIMIT 1
       ) pay ON TRUE
       LEFT JOIN LATERAL (
         SELECT r.status, r.amount_cents
         FROM refunds r
         WHERE r.order_id = o.id
         ORDER BY r.created_at DESC
         LIMIT 1
       ) ref ON TRUE
       WHERE o.id = $1`,
      [orderId],
    );
    return result.rows[0] as Record<string, any> | undefined;
  },
};
