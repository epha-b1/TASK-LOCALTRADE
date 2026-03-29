import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { reviewService } from "../services/review-service.js";
import { handleRouteError } from "./_shared.js";

export async function storefrontRoutes(app: FastifyInstance) {
  app.get("/api/storefront/sellers/:sellerId/credit-metrics", async (req, reply) => {
    try {
      const params = z.object({ sellerId: z.string().uuid() }).parse(req.params);
      return await reviewService.sellerMetrics(params.sellerId);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.get("/api/storefront/sellers/:sellerId/reviews", async (req, reply) => {
    try {
      const params = z.object({ sellerId: z.string().uuid() }).parse(req.params);
      const query = z.object({ sortRule: z.enum(["verified_purchase_first", "most_recent", "highest_rated"]).optional() }).parse(req.query);
      const response = await reviewService.listBySeller(params.sellerId, query.sortRule ?? "verified_purchase_first");
      const items = response.items ?? [];
      return {
        ...response,
        creditMetrics: response.creditMetrics ?? { avgRating90d: null, positiveRate90d: null, reviewCount90d: 0 },
        items: items.map((item: any) => ({
          ...item,
          underAppeal: Boolean(item.underAppeal ?? item.under_appeal),
          removedByArbitration: Boolean(item.removedByArbitration ?? item.removed_by_arbitration),
        })),
      };
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });
}
