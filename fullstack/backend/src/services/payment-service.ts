import { auditRepository } from "../repositories/audit-repository.js";
import { orderRepository } from "../repositories/order-repository.js";
import { paymentRepository } from "../repositories/payment-repository.js";
import { dispatchWebhookEvent } from "./admin-service.js";
import { offlinePaymentGatewayAdapter } from "./payment-gateway-adapter.js";
import type { AuthUser } from "../types/auth.js";
import { HttpError } from "../utils/http-error.js";

export const paymentService = {
  async capture(input: { orderId: string; tenderType: "cash" | "check" | "store_credit" | "card_terminal_import"; amountCents: number; transactionKey: string }, actor: AuthUser) {
    if (!actor.roles.includes("admin")) {
      const order = await orderRepository.findWithListing(input.orderId);
      if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
      if (order.seller_id !== actor.id) throw new HttpError(403, "FORBIDDEN", "Forbidden");
    }
    const captured = await offlinePaymentGatewayAdapter.capturePayment(input);
    if ("error" in captured) {
      const map: Record<string, [number, string]> = {
        ORDER_NOT_FOUND: [404, "ORDER_NOT_FOUND"],
        INVALID_STATE_TRANSITION: [409, "INVALID_STATE_TRANSITION"],
        AMOUNT_MISMATCH: [409, "AMOUNT_MISMATCH"],
        IDEMPOTENCY_CONFLICT: [409, "IDEMPOTENCY_CONFLICT"],
        INSUFFICIENT_STORE_CREDIT: [409, "INSUFFICIENT_STORE_CREDIT"],
      };
      const key = String(captured.error);
      const [status, code] = map[key] ?? [500, "INTERNAL_ERROR"];
      throw new HttpError(status, code, code);
    }
    await auditRepository.create(actor, "payment.capture", "payment", captured.paymentId);
    void dispatchWebhookEvent("payment.captured", { paymentId: captured.paymentId, orderId: input.orderId });
    return { paymentId: captured.paymentId, orderStatus: "payment_captured" };
  },

  async importSettlement(records: Array<{ orderId: string; amountCents: number; tenderType: "cash" | "check" | "store_credit" | "card_terminal_import"; transactionKey: string }>, actor: AuthUser) {
    const summary = await offlinePaymentGatewayAdapter.importSettlement(records);
    await auditRepository.create(actor, "payment.import", "payment_import", "settlement");
    return summary;
  },

  async getPayment(paymentId: string, actor: AuthUser) {
    const payment = await paymentRepository.findDetail(paymentId);
    if (!payment) throw new HttpError(404, "PAYMENT_NOT_FOUND", "Payment not found");
    if (!actor.roles.includes("admin") && payment.buyer_id !== actor.id && payment.seller_id !== actor.id) {
      throw new HttpError(403, "FORBIDDEN", "Forbidden");
    }
    return {
      id: payment.id,
      orderId: payment.order_id,
      tenderType: payment.tender_type,
      amountCents: payment.amount_cents,
      transactionKey: payment.transaction_key,
      createdAt: payment.created_at,
    };
  },
};
