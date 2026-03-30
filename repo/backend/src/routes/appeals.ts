import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../plugins/auth.js";
import { reviewService } from "../services/review-service.js";
import type { AppRequest } from "../types/auth.js";
import { handleRouteError } from "./_shared.js";

export async function appealRoutes(app: FastifyInstance) {
  app.post("/api/reviews/:id/appeal", { preHandler: [authenticate, authorize(["seller"])] }, async (req, reply) => {
    try {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = z.object({ reason: z.string().min(1) }).parse(req.body);
      const actor = (req as AppRequest).authUser!;
      return reply.code(201).send(await reviewService.createAppeal({ reviewId: params.id, sellerId: actor.id, reason: body.reason }, actor));
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/appeals", { preHandler: [authenticate, authorize(["seller"])] }, async (req, reply) => {
    try {
      const body = z.object({ reviewId: z.string().uuid(), reason: z.string().min(1) }).parse(req.body);
      const actor = (req as AppRequest).authUser!;
      return reply.code(201).send(await reviewService.createAppeal({ reviewId: body.reviewId, sellerId: actor.id, reason: body.reason }, actor));
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.get("/api/arbitration/appeals", { preHandler: [authenticate, authorize(["arbitrator"])] }, async (_req, reply) => {
    try {
      return await reviewService.listAppeals();
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/arbitration/appeals/:id/resolve", { preHandler: [authenticate, authorize(["arbitrator"])] }, async (req, reply) => {
    try {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = z.object({ outcome: z.enum(["uphold", "modify", "remove"]), note: z.string().min(1) }).parse(req.body);
      const actor = (req as AppRequest).authUser!;
      return await reviewService.resolveAppeal({ appealId: params.id, outcome: body.outcome, note: body.note }, actor);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });
}
