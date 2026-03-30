import { pool } from "../db/pool.js";

export const appealRepository = {
  async hasActiveForReview(reviewId: string) {
    const result = await pool.query("SELECT 1 FROM appeals WHERE review_id = $1 AND status = 'open'", [reviewId]);
    return Boolean(result.rowCount);
  },

  async create(input: { reviewId: string; sellerId: string; reason: string }) {
    const result = await pool.query(
      `INSERT INTO appeals(review_id, seller_id, status, reason)
       VALUES($1, $2, 'open', $3)
       RETURNING id`,
      [input.reviewId, input.sellerId, input.reason],
    );
    return result.rows[0].id as string;
  },

  async listOpen() {
    const result = await pool.query(
      `SELECT a.id,
              a.review_id,
              a.seller_id,
              a.reason,
              a.created_at,
              r.body AS review_text,
              r.rating,
              buyer.display_name AS buyer_name,
              seller.display_name AS seller_name
       FROM appeals a
       JOIN reviews r ON r.id = a.review_id
       JOIN users buyer ON buyer.id = r.buyer_id
       JOIN users seller ON seller.id = r.seller_id
       WHERE a.status = 'open'
       ORDER BY a.created_at ASC`,
    );
    return result.rows;
  },

  async findById(appealId: string) {
    const result = await pool.query("SELECT * FROM appeals WHERE id = $1", [appealId]);
    return result.rows[0] as Record<string, any> | undefined;
  },

  async resolve(input: { appealId: string; status: string; resolvedBy: string; note: string }) {
    await pool.query(
      `UPDATE appeals
       SET status = $1, resolved_by = $2, resolution_note = $3, resolved_at = NOW()
       WHERE id = $4`,
      [input.status, input.resolvedBy, input.note, input.appealId],
    );
  },
};
