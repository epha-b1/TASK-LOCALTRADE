import { pool } from "../db/pool.js";

export const reconciliationRepository = {
  async createRecord(input: {
    recordType: "settlement_import" | "refund_confirmation";
    externalKey: string;
    status: "inserted" | "skipped_duplicate" | "confirmed";
    orderId?: string;
    refundId?: string;
    payload: Record<string, unknown>;
  }) {
    await pool.query(
      `INSERT INTO reconciliation_records(record_type, external_key, status, order_id, refund_id, payload_json)
       VALUES($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (external_key) DO NOTHING`,
      [input.recordType, input.externalKey, input.status, input.orderId ?? null, input.refundId ?? null, JSON.stringify(input.payload)],
    );
  },
};
