import { pool, withTx } from "../db/pool.js";

export const reviewRepository = {
  async existsForOrder(orderId: string) {
    const result = await pool.query("SELECT 1 FROM reviews WHERE order_id = $1", [orderId]);
    return Boolean(result.rowCount);
  },

  async create(input: { orderId: string; buyerId: string; sellerId: string; rating: number; body: string; imageAssetIds: string[] }) {
    return withTx(async (client) => {
      const result = await client.query(
        `INSERT INTO reviews(order_id, buyer_id, seller_id, rating, body)
         VALUES($1, $2, $3, $4, $5)
         RETURNING id`,
        [input.orderId, input.buyerId, input.sellerId, input.rating, input.body],
      );
      for (const assetId of input.imageAssetIds) {
        await client.query("INSERT INTO review_media(review_id, asset_id) VALUES($1, $2)", [result.rows[0].id, assetId]);
      }
      return result.rows[0].id as string;
    });
  },

  async listBySeller(sellerId: string, orderByClause: string) {
    const result = await pool.query(
      `SELECT r.id, r.rating, r.body, r.under_appeal, r.removed_by_arbitration, r.created_at, u.display_name AS reviewer_name
       FROM reviews r
       JOIN users u ON u.id = r.buyer_id
       WHERE r.seller_id = $1
       ORDER BY ${orderByClause}`,
      [sellerId],
    );
    return result.rows;
  },

  async listStorefrontReviews(sellerId: string, ranking: "verified_purchase_first" | "most_recent" | "highest_rated") {
    const orderBy =
      ranking === "highest_rated"
        ? "r.rating DESC, r.created_at DESC"
        : ranking === "most_recent"
          ? "r.created_at DESC"
          : "is_verified_purchase DESC, r.created_at DESC";
    const result = await pool.query(
      `SELECT r.id, r.order_id, r.rating, r.body, r.created_at,
               r.under_appeal, r.removed_by_arbitration,
               u.display_name AS reviewer_name,
               (o.status = 'completed') AS is_verified_purchase
       FROM reviews r
       JOIN orders o ON o.id = r.order_id
       JOIN users u ON u.id = r.buyer_id
       WHERE r.seller_id = $1
       ORDER BY ${orderBy}`,
      [sellerId],
    );
    return result.rows;
  },

  async listRatingsBySeller(sellerId: string) {
    const result = await pool.query("SELECT rating, created_at FROM reviews WHERE seller_id = $1", [sellerId]);
    return result.rows as Array<{ rating: number; created_at: Date }>;
  },

  async findById(reviewId: string) {
    const result = await pool.query("SELECT * FROM reviews WHERE id = $1", [reviewId]);
    return result.rows[0] as Record<string, any> | undefined;
  },

  async setAppealFlags(reviewId: string, underAppeal: boolean, removedByArbitration?: boolean) {
    await pool.query(
      "UPDATE reviews SET under_appeal = $1, removed_by_arbitration = COALESCE($2, removed_by_arbitration) WHERE id = $3",
      [underAppeal, removedByArbitration ?? null, reviewId],
    );
  },

  async countImages(reviewId: string) {
    const result = await pool.query("SELECT COUNT(*)::int AS c FROM review_media WHERE review_id = $1", [reviewId]);
    return Number(result.rows[0].c);
  },

  async attachImage(reviewId: string, assetId: string) {
    await pool.query("INSERT INTO review_media(review_id, asset_id) VALUES($1, $2) ON CONFLICT DO NOTHING", [reviewId, assetId]);
  },
};
