import { paymentRepository } from "../repositories/payment-repository.js";
import { reconciliationRepository } from "../repositories/reconciliation-repository.js";
import { refundRepository } from "../repositories/refund-repository.js";
import { HttpError } from "../utils/http-error.js";

export interface PaymentGatewayAdapter {
  capturePayment(input: { orderId: string; tenderType: "cash" | "check" | "store_credit" | "card_terminal_import"; amountCents: number; transactionKey: string }): Promise<{ paymentId: string } | { error: string }>;
  importSettlement(records: Array<{ orderId: string; amountCents: number; tenderType: "cash" | "check" | "store_credit" | "card_terminal_import"; transactionKey: string }>): Promise<{ total: number; inserted: number; skipped: number }>;
  confirmRefund(input: { refundId: string; transactionKey: string; confirmedAt?: string }): Promise<boolean>;
}

export const offlinePaymentGatewayAdapter: PaymentGatewayAdapter = {
  async capturePayment(input) {
    return paymentRepository.capture(input);
  },

  async importSettlement(records) {
    let inserted = 0;
    let skipped = 0;

    for (const record of records) {
      const exists = await paymentRepository.findByTransactionKey(record.transactionKey);
      if (exists) {
        skipped += 1;
        await reconciliationRepository.createRecord({
          recordType: "settlement_import",
          externalKey: `settlement:${record.transactionKey}`,
          status: "skipped_duplicate",
          orderId: record.orderId,
          payload: record,
        });
        continue;
      }

      await paymentRepository.createImportedPayment(record);
      inserted += 1;
      await reconciliationRepository.createRecord({
        recordType: "settlement_import",
        externalKey: `settlement:${record.transactionKey}`,
        status: "inserted",
        orderId: record.orderId,
        payload: record,
      });
    }

    return { total: records.length, inserted, skipped };
  },

  async confirmRefund(input) {
    const existing = await paymentRepository.findByTransactionKey(input.transactionKey);
    if (existing) {
      throw new HttpError(409, "IDEMPOTENCY_CONFLICT", "Duplicate transaction key");
    }
    const ok = await refundRepository.confirmRefund(input);
    if (ok) {
      await reconciliationRepository.createRecord({
        recordType: "refund_confirmation",
        externalKey: `refund:${input.transactionKey}`,
        status: "confirmed",
        refundId: input.refundId,
        payload: { refundId: input.refundId, transactionKey: input.transactionKey, confirmedAt: input.confirmedAt ?? null },
      });
    }
    return ok;
  },
};
