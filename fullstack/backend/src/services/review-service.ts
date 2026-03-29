import { calcSellerCreditMetrics, reviewWindowOpen } from "../domain.js";
import { appealRepository } from "../repositories/appeal-repository.js";
import { auditRepository } from "../repositories/audit-repository.js";
import { orderRepository } from "../repositories/order-repository.js";
import { reviewRepository } from "../repositories/review-repository.js";
import { userRepository } from "../repositories/user-repository.js";
import { mediaRepository } from "../repositories/media-repository.js";
import type { AuthUser } from "../types/auth.js";
import { HttpError } from "../utils/http-error.js";

function toIsoDate(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  const fallback = new Date(value as any);
  if (!Number.isNaN(fallback.getTime())) return fallback.toISOString();
  throw new HttpError(500, "INVALID_REVIEW_TIMESTAMP", "Invalid review timestamp");
}

export const reviewService = {
  async create(input: { orderId: string; buyerId: string; rating: number; body: string; imageAssetIds: string[] }, actor: AuthUser) {
    const order = await orderRepository.findWithListing(input.orderId);
    if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
    if (order.buyer_id !== input.buyerId) throw new HttpError(403, "NOT_OWNER", "Not owner");
    if (order.status !== "completed" || !order.completed_at) throw new HttpError(409, "ORDER_NOT_COMPLETED", "Order not completed");
    if (!reviewWindowOpen(order.completed_at.toISOString(), new Date())) throw new HttpError(409, "REVIEW_WINDOW_EXPIRED", "Review window expired");
    if (await reviewRepository.existsForOrder(input.orderId)) throw new HttpError(409, "REVIEW_ALREADY_EXISTS", "Review already exists");
    for (const assetId of input.imageAssetIds) {
      const asset = await mediaRepository.findAssetById(assetId);
      if (!asset) {
        throw new HttpError(404, "ASSET_NOT_FOUND", `Asset ${assetId} not found`);
      }
      if (asset.listing_id !== order.listing_id) {
        throw new HttpError(403, "ASSET_NOT_ACCESSIBLE", "Asset does not belong to this listing");
      }
    }

    const reviewId = await reviewRepository.create({
      orderId: input.orderId,
      buyerId: input.buyerId,
      sellerId: order.seller_id,
      rating: input.rating,
      body: input.body,
      imageAssetIds: input.imageAssetIds,
    });
    await auditRepository.create(actor, "review.create", "review", reviewId);
    return { id: reviewId, status: "published" };
  },

  async listBySeller(sellerId: string, sortRule: "verified_purchase_first" | "most_recent" | "highest_rated") {
    try {
      const rows = await reviewRepository.listStorefrontReviews(sellerId, sortRule);
      if (!rows.length) {
        return {
          items: [],
          creditMetrics: { avgRating90d: null, positiveRate90d: null, reviewCount90d: 0 },
        };
      }
      const metrics = calcSellerCreditMetrics(rows.map((r) => ({ rating: Number(r.rating), createdAt: toIsoDate(r.created_at) })), new Date());
      return {
        items: rows.map((r) => ({
          id: r.id,
          rating: Number(r.rating),
          body: r.body,
          createdAt: toIsoDate(r.created_at),
          reviewerName: r.reviewer_name ?? null,
          underAppeal: Boolean(r.under_appeal),
          removedByArbitration: Boolean(r.removed_by_arbitration),
        })),
        creditMetrics: metrics,
      };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(500, "STOREFRONT_REVIEWS_FAILED", "Failed to load storefront reviews");
    }
  },

  async getById(reviewId: string) {
    const row = await reviewRepository.findById(reviewId);
    if (!row) throw new HttpError(404, "REVIEW_NOT_FOUND", "Review not found");
    return {
      ...row,
      badges: { underAppeal: row.under_appeal, removedByArbitration: row.removed_by_arbitration },
    };
  },

  async attachImage(input: { reviewId: string; buyerId: string; assetId: string }, actor: AuthUser) {
    const review = await reviewRepository.findById(input.reviewId);
    if (!review) throw new HttpError(404, "REVIEW_NOT_FOUND", "Review not found");
    if (review.buyer_id !== input.buyerId) throw new HttpError(403, "NOT_OWNER", "Not owner");
    const imageCount = await reviewRepository.countImages(input.reviewId);
    if (imageCount >= 5) throw new HttpError(409, "REVIEW_IMAGE_LIMIT_REACHED", "Review image limit reached");

    const asset = await mediaRepository.findAssetById(input.assetId);
    if (!asset) throw new HttpError(404, "ASSET_NOT_FOUND", "Asset not found");

    const order = await orderRepository.findWithListing(review.order_id);
    if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
    if (asset.listing_id !== order.listing_id) {
      throw new HttpError(403, "ASSET_NOT_ACCESSIBLE", "Asset does not belong to this listing");
    }

    await reviewRepository.attachImage(input.reviewId, input.assetId);
    await auditRepository.create(actor, "review.image.attach", "review", input.reviewId, undefined, { assetId: input.assetId });
    return { reviewId: input.reviewId, assetId: input.assetId };
  },

  async createAppeal(input: { reviewId: string; sellerId: string; reason: string }, actor: AuthUser) {
    const review = await reviewRepository.findById(input.reviewId);
    if (!review) throw new HttpError(404, "REVIEW_NOT_FOUND", "Review not found");
    if (review.seller_id !== input.sellerId) throw new HttpError(403, "NOT_REVIEW_OWNER", "Not review owner");
    if (await appealRepository.hasActiveForReview(input.reviewId)) throw new HttpError(409, "APPEAL_ALREADY_ACTIVE", "Appeal already active");
    const appealId = await appealRepository.create(input);
    await reviewRepository.setAppealFlags(input.reviewId, true);
    await auditRepository.create(actor, "appeal.create", "appeal", appealId);
    return { id: appealId, status: "open" };
  },

  async resolveAppeal(input: { appealId: string; outcome: "uphold" | "modify" | "remove"; note: string }, actor: AuthUser) {
    const appeal = await appealRepository.findById(input.appealId);
    if (!appeal) throw new HttpError(404, "APPEAL_NOT_FOUND", "Appeal not found");
    if (appeal.status !== "open") throw new HttpError(409, "APPEAL_NOT_OPEN", "Appeal not open");
    const resolvedStatus = `resolved_${input.outcome}`;
    await appealRepository.resolve({ appealId: input.appealId, status: resolvedStatus, resolvedBy: actor.id, note: input.note });
    await reviewRepository.setAppealFlags(appeal.review_id, false, input.outcome === "remove");
    await auditRepository.create(actor, "appeal.resolve", "appeal", input.appealId, undefined, input);
    return { id: input.appealId, status: resolvedStatus, reviewStatus: input.outcome === "remove" ? "removed" : "published" };
  },

  async listAppeals() {
    return { items: await appealRepository.listOpen() };
  },

  async sellerMetrics(sellerId: string) {
    try {
      const seller = await userRepository.getRoles(sellerId);
      if (!seller.includes("seller")) throw new HttpError(404, "SELLER_NOT_FOUND", "Seller not found");
      const rows = await reviewRepository.listRatingsBySeller(sellerId);
      if (!rows.length) {
        return { avgRating90d: null, positiveRate90d: null, reviewCount90d: 0 };
      }
      return calcSellerCreditMetrics(rows.map((r) => ({ rating: Number(r.rating), createdAt: toIsoDate(r.created_at) })), new Date());
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(500, "STOREFRONT_METRICS_FAILED", "Failed to load seller metrics");
    }
  },
};
