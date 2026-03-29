import { pool } from "../db/pool.js";

export const listingRepository = {
  async create(input: { sellerId: string; title: string; description: string; priceCents: number; quantity: number; status: string; flaggedRuleId?: string }) {
    const result = await pool.query(
      `INSERT INTO listings(seller_id, title, description, price_cents, quantity, status, flagged_rule_id)
       VALUES($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, status`,
      [input.sellerId, input.title, input.description, input.priceCents, input.quantity, input.status, input.flaggedRuleId ?? null],
    );
    return result.rows[0] as { id: string; status: string };
  },

  async findById(id: string) {
    const result = await pool.query("SELECT * FROM listings WHERE id = $1", [id]);
    return result.rows[0] as Record<string, any> | undefined;
  },

  async update(input: { id: string; title: string; description: string; priceCents: number; quantity: number; status: string; flaggedRuleId?: string }) {
    const result = await pool.query(
      `UPDATE listings
       SET title = $1, description = $2, price_cents = $3, quantity = $4, status = $5, flagged_rule_id = $6, updated_at = NOW()
       WHERE id = $7
       RETURNING id, status, title, description, price_cents, quantity`,
      [input.title, input.description, input.priceCents, input.quantity, input.status, input.flaggedRuleId ?? null, input.id],
    );
    return result.rows[0];
  },

  async setPublished(id: string) {
    await pool.query("UPDATE listings SET status = 'published', updated_at = NOW() WHERE id = $1", [id]);
  },

  async listPublished(sellerId?: string) {
    const result = sellerId
      ? await pool.query(
          `SELECT l.id, l.seller_id, l.title, l.description, l.price_cents, l.quantity, l.created_at,
                  u.display_name AS seller_display_name
           FROM listings l
           JOIN users u ON u.id = l.seller_id
           WHERE l.status = 'published' AND l.seller_id = $1
           ORDER BY l.created_at DESC`,
          [sellerId],
        )
      : await pool.query(
          `SELECT l.id, l.seller_id, l.title, l.description, l.price_cents, l.quantity, l.created_at,
                  u.display_name AS seller_display_name
           FROM listings l
           JOIN users u ON u.id = l.seller_id
           WHERE l.status = 'published'
           ORDER BY l.created_at DESC`,
        );
    return result.rows;
  },

  async listFlagged() {
    const result = await pool.query(
      `SELECT l.id, l.title, l.description, l.flagged_rule_id, l.updated_at,
              u.display_name AS seller_name,
              cr.pattern AS flagged_rule_pattern
       FROM listings l
       JOIN users u ON u.id = l.seller_id
       LEFT JOIN content_rules cr ON cr.id = l.flagged_rule_id
       WHERE l.status = 'flagged'
       ORDER BY l.updated_at ASC`,
    );
    return result.rows;
  },

  async setStatus(id: string, status: "draft" | "removed") {
    await pool.query("UPDATE listings SET status = $1, updated_at = NOW() WHERE id = $2", [status, id]);
  },

  async listOwn(sellerId: string, status?: string) {
    const result = status
      ? await pool.query(
          `SELECT l.id,
                  l.title,
                  l.status,
                  l.price_cents,
                  l.quantity,
                  COUNT(a.id)::int AS asset_count,
                  COUNT(*) FILTER (WHERE a.status <> 'ready')::int AS not_ready_count
           FROM listings l
           LEFT JOIN assets a ON a.listing_id = l.id
           WHERE l.seller_id = $1 AND l.status = $2
           GROUP BY l.id
           ORDER BY l.created_at DESC`,
          [sellerId, status],
        )
      : await pool.query(
          `SELECT l.id,
                  l.title,
                  l.status,
                  l.price_cents,
                  l.quantity,
                  COUNT(a.id)::int AS asset_count,
                  COUNT(*) FILTER (WHERE a.status <> 'ready')::int AS not_ready_count
           FROM listings l
           LEFT JOIN assets a ON a.listing_id = l.id
           WHERE l.seller_id = $1
           GROUP BY l.id
           ORDER BY l.created_at DESC`,
          [sellerId],
        );
    return result.rows;
  },

  async removeListing(id: string) {
    const result = await pool.query("UPDATE listings SET status = 'removed', updated_at = NOW() WHERE id = $1 RETURNING id, status", [id]);
    return result.rows[0] as { id: string; status: string } | undefined;
  },
};
