import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../plugins/auth.js";
import { refundService } from "../services/refund-service.js";
import type { AppRequest } from "../types/auth.js";
import { handleRouteError } from "./_shared.js";

export async function refundRoutes(app: FastifyInstance) {
  app.get("/api/refunds", { preHandler: [authenticate, authorize(["buyer", "seller", "admin"])] }, async (req, reply) => {
    try {
      const query = z.object({ orderId: z.string().uuid() }).parse(req.query);
      const actor = (req as AppRequest).authUser!;
      return { items: await refundService.listByOrder(query.orderId, actor) };
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/refunds", { preHandler: [authenticate, authorize(["seller"])] }, async (req, reply) => {
    try {
      const body = z.object({ orderId: z.string().uuid(), amountCents: z.number().int().positive(), reason: z.string().min(1) }).parse(req.body);
      const actor = (req as AppRequest).authUser!;
      return reply.code(201).send(await refundService.create({ orderId: body.orderId, sellerId: actor.id, amountCents: body.amountCents, reason: body.reason }, actor));
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/refunds/:id/approve", { preHandler: [authenticate, authorize(["admin"])] }, async (req, reply) => {
    try {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = z.object({ approve: z.boolean(), note: z.string().min(1) }).parse(req.body);
      const actor = (req as AppRequest).authUser!;
      return await refundService.adminDecision({ refundId: params.id, approve: body.approve, note: body.note }, actor);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/refunds/import-confirmation", { preHandler: [authenticate, authorize(["admin"])] }, async (req, reply) => {
    try {
      const body = z.object({ transactionKey: z.string().min(3), refundId: z.string().uuid(), confirmedAt: z.string().optional() }).parse(req.body);
      const actor = (req as AppRequest).authUser!;
      return await refundService.importConfirmation(body, actor);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });
}
