import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../plugins/auth.js";
import { reviewService } from "../services/review-service.js";
import type { AppRequest } from "../types/auth.js";
import { handleRouteError } from "./_shared.js";

export async function reviewRoutes(app: FastifyInstance) {
  app.post("/api/reviews", { preHandler: [authenticate, authorize(["buyer"])] }, async (req, reply) => {
    try {
      const body = z.object({ orderId: z.string().uuid(), rating: z.number().int().min(1).max(5), body: z.string().max(1000), imageAssetIds: z.array(z.string().uuid()).max(5).optional() }).parse(req.body);
      const actor = (req as AppRequest).authUser!;
      return reply.code(201).send(await reviewService.create({ orderId: body.orderId, buyerId: actor.id, rating: body.rating, body: body.body, imageAssetIds: body.imageAssetIds ?? [] }, actor));
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/reviews/:id/images", { preHandler: [authenticate, authorize(["buyer"])] }, async (req, reply) => {
    try {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = z.object({ assetId: z.string().uuid() }).parse(req.body);
      const actor = (req as AppRequest).authUser!;
      return await reviewService.attachImage({ reviewId: params.id, buyerId: actor.id, assetId: body.assetId }, actor);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.get("/api/reviews/:id", async (req, reply) => {
    try {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      return await reviewService.getById(params.id);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });
}
