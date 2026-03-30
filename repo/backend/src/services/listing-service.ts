import { auditRepository } from "../repositories/audit-repository.js";
import { contentRepository } from "../repositories/content-repository.js";
import { listingRepository } from "../repositories/listing-repository.js";
import { mediaRepository } from "../repositories/media-repository.js";
import { reviewRepository } from "../repositories/review-repository.js";
import { orderRepository } from "../repositories/order-repository.js";
import { dispatchWebhookEvent } from "./admin-service.js";
import type { AuthUser } from "../types/auth.js";
import { HttpError } from "../utils/http-error.js";
import { listingReadyToPublish } from "../domain.js";

async function detectRule(title: string, description: string) {
  const text = `${title} ${description}`;
  const rules = await contentRepository.listActiveRules();
  for (const rule of rules) {
    if (new RegExp(rule.pattern, "i").test(text)) {
      return rule;
    }
  }
  return undefined;
}

export const listingService = {
  async create(input: { sellerId: string; title: string; description: string; priceCents: number; quantity: number }, actor: AuthUser) {
    const rule = await detectRule(input.title, input.description);
    const listing = await listingRepository.create({
      sellerId: input.sellerId,
      title: input.title,
      description: input.description,
      priceCents: input.priceCents,
      quantity: input.quantity,
      status: rule ? "flagged" : "draft",
      flaggedRuleId: rule?.id,
    });
    if (rule) {
      await contentRepository.createScanResult({ listingId: listing.id, ruleId: rule.id, verdict: "flagged", detail: "Matched content rule" });
    }
    await auditRepository.create(actor, "listing.create", "listing", listing.id);
    if (rule) {
      void dispatchWebhookEvent("listing.flagged", { listingId: listing.id });
    }
    return listing;
  },

  async update(input: { listingId: string; sellerId: string; title?: string; description?: string; priceCents?: number; quantity?: number }, actor: AuthUser) {
    const current = await listingRepository.findById(input.listingId);
    if (!current) throw new HttpError(404, "LISTING_NOT_FOUND", "Listing not found");
    if (current.seller_id !== input.sellerId) throw new HttpError(403, "NOT_OWNER", "Not owner");
    const next = {
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      priceCents: input.priceCents ?? current.price_cents,
      quantity: input.quantity ?? current.quantity,
    };
    const rule = await detectRule(next.title, next.description);
    const status = rule ? "flagged" : current.status === "flagged" ? "draft" : current.status;
    const updated = await listingRepository.update({
      id: input.listingId,
      title: next.title,
      description: next.description,
      priceCents: next.priceCents,
      quantity: next.quantity,
      status,
      flaggedRuleId: rule?.id,
    });
    await auditRepository.create(actor, "listing.update", "listing", input.listingId, current, updated);
    if (status === "flagged") {
      void dispatchWebhookEvent("listing.flagged", { listingId: input.listingId });
    }
    return updated;
  },

  async publish(listingId: string, sellerId: string, actor: AuthUser) {
    const listing = await listingRepository.findById(listingId);
    if (!listing) throw new HttpError(404, "LISTING_NOT_FOUND", "Listing not found");
    if (listing.seller_id !== sellerId) throw new HttpError(403, "NOT_OWNER", "Not owner");
    const assets = await mediaRepository.listAssetStatusesForListing(listingId);
    const ready = listingReadyToPublish(listing.status, assets);
    if (!ready.ok) throw new HttpError(409, "LISTING_NOT_READY", ready.reason ?? "Not ready");
    await listingRepository.setPublished(listingId);
    await auditRepository.create(actor, "listing.publish", "listing", listingId);
    void dispatchWebhookEvent("listing.published", { listingId });
    return { id: listingId, status: "published" };
  },

  async listStorefront(input: { ranking: "verified_purchase_first" | "most_recent" | "highest_rated"; sellerId?: string }) {
    const listings = await listingRepository.listPublished(input.sellerId);
    const sellerIds = [...new Set(listings.map((l) => l.seller_id as string))];
    const reviewsBySeller = new Map<string, any[]>();
    for (const sellerId of sellerIds) {
      const reviews = await reviewRepository.listStorefrontReviews(sellerId, input.ranking);
      reviewsBySeller.set(
        sellerId,
        reviews.map((r) => ({
          id: r.id,
          orderId: r.order_id,
          rating: r.rating,
          body: r.body,
          createdAt: r.created_at,
          isVerifiedPurchase: r.is_verified_purchase,
          badges: {
            underAppeal: r.under_appeal,
            removedByArbitration: r.removed_by_arbitration,
          },
        })),
      );
    }
    return listings.map((l) => ({
      ...l,
      reviews: reviewsBySeller.get(l.seller_id as string) ?? [],
    }));
  },

  async getReadiness(listingId: string, actor: AuthUser) {
    const listing = await listingRepository.findById(listingId);
    if (!listing) throw new HttpError(404, "LISTING_NOT_FOUND", "Listing not found");
    if (!actor.roles.includes("admin") && listing.seller_id !== actor.id) {
      throw new HttpError(403, "NOT_OWNER", "Not owner");
    }
    const assets = await mediaRepository.listAssetStatusesForListing(listingId);
    const ready = listingReadyToPublish(listing.status, assets);
    return {
      id: listing.id,
      status: listing.status,
      readyToPublish: ready.ok,
      blockedReason: ready.ok ? null : ready.reason ?? "LISTING_NOT_READY",
      assets: assets.map((a) => ({ status: a.status })),
    };
  },

  async listOwn(actor: AuthUser, status?: "draft" | "flagged" | "published" | "removed") {
    const rows = await listingRepository.listOwn(actor.id, status);
    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        priceCents: Number(row.price_cents),
        quantity: Number(row.quantity),
        assetCount: Number(row.asset_count),
        readiness: row.status !== "flagged" && Number(row.asset_count) > 0 && Number(row.not_ready_count) === 0,
        blockedReason:
          row.status === "flagged"
            ? "Listing flagged by moderation rules"
            : Number(row.asset_count) === 0
              ? "Upload at least one asset"
              : Number(row.not_ready_count) > 0
                ? "Wait for all media assets to finish processing"
                : null,
      })),
    };
  },

  async remove(listingId: string, actor: AuthUser, force: boolean) {
    const listing = await listingRepository.findById(listingId);
    if (!listing) throw new HttpError(404, "LISTING_NOT_FOUND", "Listing not found");
    const isAdmin = actor.roles.includes("admin");
    if (!isAdmin && listing.seller_id !== actor.id) {
      throw new HttpError(403, "NOT_OWNER", "Not owner");
    }
    const activeOrders = await orderRepository.countActiveForListing(listingId);
    if (activeOrders > 0 && !(isAdmin && force)) {
      throw new HttpError(409, "ACTIVE_ORDERS_EXIST", "Listing has active orders");
    }
    const removed = await listingRepository.removeListing(listingId);
    if (!removed) throw new HttpError(404, "LISTING_NOT_FOUND", "Listing not found");
    await auditRepository.create(actor, isAdmin && force ? "admin.listing.force_remove" : "listing.remove", "listing", listingId);
    return removed;
  },
};
