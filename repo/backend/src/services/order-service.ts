import { canCancelOrder } from "../domain.js";
import { auditRepository } from "../repositories/audit-repository.js";
import { listingRepository } from "../repositories/listing-repository.js";
import { orderRepository } from "../repositories/order-repository.js";
import { dispatchWebhookEvent } from "./admin-service.js";
import type { AuthUser } from "../types/auth.js";
import { HttpError } from "../utils/http-error.js";

export const orderService = {
  async placeOrder(input: { buyerId: string; listingId: string; quantity: number }, actor: AuthUser) {
    const listing = await listingRepository.findById(input.listingId);
    if (!listing || listing.status !== "published") throw new HttpError(404, "LISTING_NOT_FOUND", "Listing not found");
    if (input.quantity > listing.quantity) throw new HttpError(409, "INSUFFICIENT_STOCK", "Insufficient stock");
    const order = await orderRepository.create({ buyerId: input.buyerId, listingId: input.listingId, quantity: input.quantity, totalCents: input.quantity * listing.price_cents });
    await auditRepository.create(actor, "order.create", "order", order.id);
    return { id: order.id, status: order.status, totalCents: order.total_cents };
  },

  async cancelOrder(orderId: string, buyerId: string, actor: AuthUser) {
    const order = await orderRepository.findById(orderId);
    if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
    if (order.buyer_id !== buyerId) throw new HttpError(403, "NOT_OWNER", "Not owner");
    if (!canCancelOrder(order.status)) {
      throw new HttpError(409, "INVALID_STATE_TRANSITION", "Order cannot be cancelled after payment is captured. Please initiate a refund.");
    }
    await orderRepository.setStatus(orderId, "cancelled");
    await auditRepository.create(actor, "order.cancel", "order", orderId);
    return { id: orderId, status: "cancelled" };
  },

  async completeOrder(orderId: string, sellerId: string, actor: AuthUser) {
    const order = await orderRepository.findWithListing(orderId);
    if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
    if (order.seller_id !== sellerId) throw new HttpError(403, "NOT_OWNER", "Not owner");
    if (order.status !== "payment_captured") throw new HttpError(409, "INVALID_STATE_TRANSITION", "Order state invalid");
    const row = await orderRepository.setStatus(orderId, "completed", true);
    await auditRepository.create(actor, "order.complete", "order", orderId);
    void dispatchWebhookEvent("order.completed", { orderId, completedAt: row?.completed_at });
    return { id: orderId, status: "completed", completedAt: row?.completed_at };
  },

  async forceComplete(orderId: string, reason: string, actor: AuthUser) {
    const order = await orderRepository.findById(orderId);
    if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
    if (order.status !== "payment_captured") throw new HttpError(409, "INVALID_STATE_TRANSITION", "Order state invalid");
    await orderRepository.setStatus(orderId, "completed", true);
    await auditRepository.create(actor, "admin.order.force_complete", "order", orderId, undefined, { reason });
    return { id: orderId, status: "completed" };
  },

  async listOrders(actor: AuthUser, status?: string) {
    let rows: Array<Record<string, any>> = [];
    if (actor.roles.includes("admin")) {
      rows = await orderRepository.listAll(status);
    } else if (actor.roles.includes("seller") && actor.roles.includes("buyer")) {
      const [sellerRows, buyerRows] = await Promise.all([orderRepository.listForSeller(actor.id, status), orderRepository.listForBuyer(actor.id, status)]);
      const map = new Map<string, Record<string, any>>();
      for (const row of [...sellerRows, ...buyerRows]) {
        map.set(row.id as string, row);
      }
      rows = [...map.values()].sort((a, b) => new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime());
    } else if (actor.roles.includes("seller")) {
      rows = await orderRepository.listForSeller(actor.id, status);
    } else if (actor.roles.includes("buyer")) {
      rows = await orderRepository.listForBuyer(actor.id, status);
    } else {
      throw new HttpError(403, "FORBIDDEN", "Forbidden");
    }

    return {
      items: rows.map((row) => ({
        id: row.id,
        listingTitle: row.listing_title,
        status: row.status,
        totalCents: Number(row.total_cents),
        createdAt: row.created_at,
      })),
    };
  },

  async getOrderDetail(orderId: string, actor: AuthUser) {
    const order = await orderRepository.findOrderDetail(orderId);
    if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
    const isAdmin = actor.roles.includes("admin");
    const isBuyer = order.buyer_id === actor.id;
    const isSeller = order.seller_id === actor.id;
    if (!isAdmin && !isBuyer && !isSeller) {
      throw new HttpError(403, "FORBIDDEN", "Forbidden");
    }
    return {
      id: order.id,
      listing: { id: order.listing_id, title: order.listing_title },
      status: order.status,
      quantity: Number(order.quantity),
      totalCents: Number(order.total_cents),
      createdAt: order.created_at,
      completedAt: order.completed_at,
      paymentStatus: order.payment_status ?? "unpaid",
      paymentTenderType: order.tender_type ?? null,
      refundStatus: order.refund_status ?? "none",
      refundAmountCents: order.refund_amount_cents ? Number(order.refund_amount_cents) : null,
      buyer: isSeller || isAdmin ? { id: order.buyer_id, email: order.buyer_email, displayName: order.buyer_display_name } : undefined,
    };
  },
};
