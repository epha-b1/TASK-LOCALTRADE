import { pool, withTx } from "../db/pool.js";

export const paymentRepository = {
  async findByTransactionKey(transactionKey: string) {
    const result = await pool.query("SELECT * FROM payments WHERE transaction_key = $1", [transactionKey]);
    return result.rows[0] as Record<string, any> | undefined;
  },

  async capture(input: { orderId: string; tenderType: string; amountCents: number; transactionKey: string }) {
    return withTx(async (client) => {
      const existing = await client.query("SELECT 1 FROM payments WHERE transaction_key = $1", [input.transactionKey]);
      if (existing.rowCount) return { error: "IDEMPOTENCY_CONFLICT" as const };

      const order = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [input.orderId]);
      if (!order.rowCount) return { error: "ORDER_NOT_FOUND" as const };
      const o = order.rows[0];
      if (o.status !== "placed") return { error: "INVALID_STATE_TRANSITION" as const };
      if (o.total_cents !== input.amountCents) return { error: "AMOUNT_MISMATCH" as const };

      if (input.tenderType === "store_credit") {
        const bal = await client.query(
          `SELECT COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN amount_cents ELSE -amount_cents END), 0) AS balance
           FROM store_credit_ledger WHERE buyer_id = $1`,
          [o.buyer_id],
        );
        if (Number(bal.rows[0].balance) < input.amountCents) {
          return { error: "INSUFFICIENT_STORE_CREDIT" as const };
        }
      }

      const inserted = await client.query(
        `INSERT INTO payments(order_id, tender_type, amount_cents, transaction_key)
         VALUES($1, $2, $3, $4) RETURNING id`,
        [input.orderId, input.tenderType, input.amountCents, input.transactionKey],
      );

      if (input.tenderType === "store_credit") {
        await client.query(
          `INSERT INTO store_credit_ledger(buyer_id, entry_type, amount_cents, payment_id, note)
           VALUES($1, 'debit', $2, $3, 'order payment')`,
          [o.buyer_id, input.amountCents, inserted.rows[0].id],
        );
      }

      await client.query("UPDATE orders SET status = 'payment_captured', updated_at = NOW() WHERE id = $1", [input.orderId]);
      return { paymentId: inserted.rows[0].id as string };
    });
  },

  async importSettlement(records: Array<{ orderId: string; amountCents: number; tenderType: string; transactionKey: string }>) {
    let inserted = 0;
    let skipped = 0;
    for (const record of records) {
      const exists = await this.findByTransactionKey(record.transactionKey);
      if (exists) {
        skipped += 1;
      } else {
        await pool.query(
          `INSERT INTO payments(order_id, tender_type, amount_cents, transaction_key)
           VALUES($1, $2, $3, $4)`,
          [record.orderId, record.tenderType, record.amountCents, record.transactionKey],
        );
        inserted += 1;
      }
    }
    return { total: records.length, inserted, skipped };
  },

  async createImportedPayment(input: { orderId: string; amountCents: number; tenderType: string; transactionKey: string }) {
    const result = await pool.query(
      `INSERT INTO payments(order_id, tender_type, amount_cents, transaction_key)
       VALUES($1, $2, $3, $4)
       RETURNING id`,
      [input.orderId, input.tenderType, input.amountCents, input.transactionKey],
    );
    return result.rows[0].id as string;
  },

  async findDetail(paymentId: string) {
    const result = await pool.query(
      `SELECT p.id, p.order_id, p.tender_type, p.amount_cents, p.transaction_key, p.created_at,
              o.buyer_id, l.seller_id
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       JOIN listings l ON l.id = o.listing_id
       WHERE p.id = $1`,
      [paymentId],
    );
    return result.rows[0] as Record<string, any> | undefined;
  },
};
