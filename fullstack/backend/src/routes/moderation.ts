import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../plugins/auth.js";
import { moderationService } from "../services/moderation-service.js";
import type { AppRequest } from "../types/auth.js";
import { handleRouteError } from "./_shared.js";

export async function moderationRoutes(app: FastifyInstance) {
  app.get("/api/moderation/queue", { preHandler: [authenticate, authorize(["moderator"])] }, async (_req, reply) => {
    try {
      return await moderationService.queue();
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/moderation/listings/:listingId/decision", { preHandler: [authenticate, authorize(["moderator"])] }, async (req, reply) => {
    try {
      const params = z.object({ listingId: z.string().uuid() }).parse(req.params);
      const body = z.object({ decision: z.enum(["approve", "reject"]), notes: z.string().min(1) }).parse(req.body);
      const actor = (req as AppRequest).authUser!;
      return await moderationService.decide({ listingId: params.listingId, moderatorId: actor.id, decision: body.decision, notes: body.notes }, actor);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });
}
