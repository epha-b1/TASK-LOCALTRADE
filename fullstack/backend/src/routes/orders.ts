import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../plugins/auth.js";
import { orderService } from "../services/order-service.js";
import type { AppRequest } from "../types/auth.js";
import { handleRouteError } from "./_shared.js";

export async function orderRoutes(app: FastifyInstance) {
  app.get("/api/orders", { preHandler: [authenticate, authorize(["buyer", "seller", "admin"])] }, async (req, reply) => {
    try {
      const query = z
        .object({
          status: z.enum(["placed", "cancelled", "payment_captured", "completed"]).optional(),
        })
        .parse(req.query);
      const actor = (req as AppRequest).authUser!;
      return await orderService.listOrders(actor, query.status);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/orders", { preHandler: [authenticate, authorize(["buyer"])] }, async (req, reply) => {
    try {
      const body = z.object({ listingId: z.string().uuid(), quantity: z.number().int().positive() }).parse(req.body);
      const actor = (req as AppRequest).authUser!;
      return reply.code(201).send(await orderService.placeOrder({ buyerId: actor.id, listingId: body.listingId, quantity: body.quantity }, actor));
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.get("/api/orders/:id", { preHandler: [authenticate, authorize(["buyer", "seller", "admin"])], schema: { tags: ["orders"], security: [{ bearerAuth: [] }], response: { 200: { type: "object", additionalProperties: true } } } }, async (req, reply) => {
    try {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const actor = (req as AppRequest).authUser!;
      return await orderService.getOrderDetail(params.id, actor);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/orders/:id/cancel", { preHandler: [authenticate, authorize(["buyer"])] }, async (req, reply) => {
    try {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const actor = (req as AppRequest).authUser!;
      return await orderService.cancelOrder(params.id, actor.id, actor);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/orders/:id/complete", { preHandler: [authenticate, authorize(["seller"])] }, async (req, reply) => {
    try {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const actor = (req as AppRequest).authUser!;
      return await orderService.completeOrder(params.id, actor.id, actor);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });
}
