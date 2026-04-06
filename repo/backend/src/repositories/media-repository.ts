import { pool, withTx } from "../db/pool.js";

export const mediaRepository = {
  async countAssetsForListing(listingId: string) {
    const result = await pool.query("SELECT COUNT(*)::int AS c FROM assets WHERE listing_id = $1", [listingId]);
    return Number(result.rows[0].c);
  },

  async createAssetAndSession(input: {
    listingId: string;
    sellerId: string;
    fileName: string;
    extension: string;
    mimeType: string;
    sizeBytes: number;
    totalChunks: number;
    chunkSizeBytes: number;
  }) {
    return withTx(async (client) => {
      const asset = await client.query(
        `INSERT INTO assets(listing_id, seller_id, file_name, extension, mime_type, size_bytes, status)
         VALUES($1, $2, $3, $4, $5, $6, 'uploading') RETURNING id`,
        [input.listingId, input.sellerId, input.fileName, input.extension, input.mimeType, input.sizeBytes],
      );
      const session = await client.query(
        `INSERT INTO upload_sessions(asset_id, seller_id, total_chunks, chunk_size_bytes)
         VALUES($1, $2, $3, $4) RETURNING id`,
        [asset.rows[0].id, input.sellerId, input.totalChunks, input.chunkSizeBytes],
      );
      return { assetId: asset.rows[0].id as string, sessionId: session.rows[0].id as string };
    });
  },

  async findSession(sessionId: string) {
    const result = await pool.query(
      `SELECT us.id, us.seller_id, us.total_chunks, us.status, us.asset_id,
              a.extension, a.mime_type
       FROM upload_sessions us
       JOIN assets a ON a.id = us.asset_id
       WHERE us.id = $1`,
      [sessionId],
    );
    return result.rows[0] as Record<string, any> | undefined;
  },

  async insertChunk(input: { sessionId: string; chunkIndex: number; chunkPath: string; sizeBytes: number }) {
    await pool.query(
      `INSERT INTO upload_chunks(session_id, chunk_index, chunk_path, size_bytes)
       VALUES($1, $2, $3, $4)`,
      [input.sessionId, input.chunkIndex, input.chunkPath, input.sizeBytes],
    );
  },

  async listChunks(sessionId: string) {
    const result = await pool.query("SELECT chunk_index, chunk_path FROM upload_chunks WHERE session_id = $1 ORDER BY chunk_index ASC", [sessionId]);
    return result.rows as Array<{ chunk_index: number; chunk_path: string }>;
  },

  async rejectSessionDeleteAsset(sessionId: string, assetId: string) {
    await withTx(async (client) => {
      await client.query("UPDATE upload_sessions SET status = 'rejected' WHERE id = $1", [sessionId]);
      await client.query("DELETE FROM assets WHERE id = $1", [assetId]);
    });
  },

  async findBlockedByFingerprint(fingerprint: string) {
    const result = await pool.query("SELECT id FROM assets WHERE fingerprint_sha256 = $1 AND status = 'blocked' LIMIT 1", [fingerprint]);
    return result.rows[0] as { id: string } | undefined;
  },

  async finalizeAsset(input: { sessionId: string; assetId: string; storagePath: string; fingerprint: string; metadata: unknown }) {
    await withTx(async (client) => {
      await client.query(
        `UPDATE assets
         SET status = 'processing', storage_path = $1, fingerprint_sha256 = $2, metadata_json = $3, updated_at = NOW()
         WHERE id = $4`,
        [input.storagePath, input.fingerprint, JSON.stringify(input.metadata), input.assetId],
      );
      await client.query("UPDATE upload_sessions SET status = 'finalized' WHERE id = $1", [input.sessionId]);
      await client.query("INSERT INTO jobs(type, payload_json, status) VALUES('asset_postprocess', $1, 'queued')", [JSON.stringify({ assetId: input.assetId })]);
    });
  },

  async markAssetReady(assetId: string, metadata: Record<string, unknown>) {
    await pool.query(
      `UPDATE assets
       SET status = 'ready',
           metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1
         AND status = 'processing'`,
      [assetId, JSON.stringify(metadata)],
    );
  },

  async markAssetFailed(assetId: string) {
    await pool.query(
      `UPDATE assets
       SET status = 'failed', updated_at = NOW()
       WHERE id = $1`,
      [assetId],
    );
  },

  async claimNextAssetPostprocessJob() {
    const result = await pool.query(
      `UPDATE jobs j
       SET status = 'processing', locked_at = NOW(), updated_at = NOW()
       WHERE j.id = (
         SELECT id FROM jobs
         WHERE type = 'asset_postprocess' AND status = 'queued'
           AND available_at <= NOW()
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING j.id, j.payload_json, j.retry_count`,
    );
    return result.rows[0] as { id: string; payload_json: Record<string, any>; retry_count: number } | undefined;
  },

  async completeJob(jobId: string) {
    await pool.query("UPDATE jobs SET status = 'completed', locked_at = NULL, updated_at = NOW() WHERE id = $1", [jobId]);
  },

  async failJob(jobId: string, message: string) {
    await pool.query("UPDATE jobs SET status = 'failed', locked_at = NULL, last_error = $2, updated_at = NOW() WHERE id = $1", [jobId, message]);
  },

  async requeueJob(jobId: string, errorMessage: string, delayMs: number) {
    await pool.query(
      `UPDATE jobs
       SET status = 'queued',
           retry_count = retry_count + 1,
           locked_at = NULL,
           last_error = $2,
           available_at = NOW() + ($3 || ' milliseconds')::interval,
           updated_at = NOW()
       WHERE id = $1`,
      [jobId, errorMessage, delayMs],
    );
  },

  async listAssetStatusesForListing(listingId: string) {
    const result = await pool.query("SELECT status FROM assets WHERE listing_id = $1", [listingId]);
    return result.rows as Array<{ status: string }>;
  },

  async findAssetById(assetId: string) {
    const result = await pool.query("SELECT * FROM assets WHERE id = $1", [assetId]);
    return result.rows[0] as Record<string, any> | undefined;
  },

  async buyerHasCompletedOrderForListing(input: { buyerId: string; listingId: string }) {
    const result = await pool.query(
      `SELECT 1
       FROM orders
       WHERE buyer_id = $1
         AND listing_id = $2
         AND status IN ('completed', 'refunded')
       LIMIT 1`,
      [input.buyerId, input.listingId],
    );
    return Boolean(result.rowCount);
  },

  async countBuyerPendingAssetsForListing(buyerId: string, listingId: string) {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS c FROM assets a
       WHERE a.seller_id = $1 AND a.listing_id = $2
         AND NOT EXISTS (SELECT 1 FROM review_media rm WHERE rm.asset_id = a.id)`,
      [buyerId, listingId],
    );
    return Number(result.rows[0].c);
  },

  async deleteStaleUnattachedBuyerAssets(maxAgeMs: number) {
    const result = await pool.query(
      `DELETE FROM assets a
       WHERE a.created_at < NOW() - ($1 || ' milliseconds')::interval
         AND a.seller_id != (SELECT l.seller_id FROM listings l WHERE l.id = a.listing_id)
         AND NOT EXISTS (SELECT 1 FROM review_media rm WHERE rm.asset_id = a.id)
       RETURNING a.id, a.storage_path`,
      [maxAgeMs],
    );
    return result.rows as Array<{ id: string; storage_path: string | null }>;
  },
};
