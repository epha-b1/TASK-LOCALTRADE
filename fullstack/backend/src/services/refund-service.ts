import { refundRequiresAdmin } from "../domain.js";
import { auditRepository } from "../repositories/audit-repository.js";
import { orderRepository } from "../repositories/order-repository.js";
import { refundRepository } from "../repositories/refund-repository.js";
import { dispatchWebhookEvent } from "./admin-service.js";
import { offlinePaymentGatewayAdapter } from "./payment-gateway-adapter.js";
import type { AuthUser } from "../types/auth.js";
import { HttpError } from "../utils/http-error.js";

export const refundService = {
  async create(input: { orderId: string; sellerId: string; amountCents: number; reason: string }, actor: AuthUser) {
    const order = await orderRepository.findWithListing(input.orderId);
    if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
    if (order.seller_id !== input.sellerId) throw new HttpError(403, "NOT_OWNER", "Not owner");
    if (!["payment_captured", "completed"].includes(order.status)) throw new HttpError(409, "INVALID_STATE_TRANSITION", "Invalid state");
    if (input.amountCents > order.total_cents) throw new HttpError(409, "REFUND_EXCEEDS_PAYMENT", "Refund exceeds payment");

    const requiresAdminApproval = refundRequiresAdmin(input.amountCents);
    const created = await refundRepository.create({
      orderId: input.orderId,
      sellerId: input.sellerId,
      amountCents: input.amountCents,
      reason: input.reason,
      status: requiresAdminApproval ? "pending" : "approved",
      requiresAdminApproval,
    });
    // auto-approved refunds on completed orders immediately move the order to refunded
    if (!requiresAdminApproval && order.status === "completed") {
      await orderRepository.setStatus(input.orderId, "refunded");
    }
    await auditRepository.create(actor, "refund.create", "refund", created.id);
    return { id: created.id, status: created.status, requiresAdminApproval: created.requires_admin_approval };
  },

  async adminDecision(input: { refundId: string; approve: boolean; note: string }, actor: AuthUser) {
    const refund = await refundRepository.findById(input.refundId);
    if (!refund) throw new HttpError(404, "REFUND_NOT_FOUND", "Refund not found");
    if (refund.status !== "pending") throw new HttpError(409, "REFUND_NOT_PENDING", "Refund not pending");
    const status = input.approve ? "approved" : "rejected";
    await refundRepository.setAdminDecision(input.refundId, actor.id, status);
    // when admin approves a completed order's refund, move it to refunded
    if (input.approve) {
      const order = await orderRepository.findById(refund.order_id);
      if (order?.status === "completed") {
        await orderRepository.setStatus(refund.order_id, "refunded");
      }
      void dispatchWebhookEvent("refund.approved", { refundId: input.refundId });
    }
    await auditRepository.create(actor, "refund.approve", "refund", input.refundId, { previous: refund.status }, { status, note: input.note });
    return { id: input.refundId, status };
  },

  async importConfirmation(input: { refundId: string; transactionKey: string; confirmedAt?: string }, actor: AuthUser) {
    const ok = await offlinePaymentGatewayAdapter.confirmRefund(input);
    if (!ok) throw new HttpError(404, "REFUND_NOT_FOUND", "Refund not found");
    await auditRepository.create(actor, "refund.confirm", "refund", input.refundId);
    return { refundId: input.refundId, status: "confirmed" };
  },

  async listByOrder(orderId: string, actor: AuthUser) {
    const rows = await refundRepository.listByOrder(orderId);
    if (!rows.length) return [];
    const canView = actor.roles.includes("admin") || rows[0].buyer_id === actor.id || rows[0].listing_seller_id === actor.id;
    if (!canView) throw new HttpError(403, "FORBIDDEN", "Forbidden");
    return rows.map((r) => ({
      id: r.id,
      orderId: r.order_id,
      sellerId: r.seller_id,
      amountCents: r.amount_cents,
      status: r.status,
      requiresAdminApproval: r.requires_admin_approval,
      createdAt: r.created_at,
    }));
  },

  async listPendingAdmin() {
    return refundRepository.listPendingAdminRefunds();
  },

  async listAllAdmin() {
    return refundRepository.listAllAdminRefunds();
  },
};
