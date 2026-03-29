import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../plugins/auth.js";
import { paymentService } from "../services/payment-service.js";
import type { AppRequest } from "../types/auth.js";
import { handleRouteError } from "./_shared.js";

export async function paymentRoutes(app: FastifyInstance) {
  app.post("/api/payments/capture", { preHandler: [authenticate, authorize(["seller", "admin"])] }, async (req, reply) => {
    try {
      const body = z.object({ orderId: z.string().uuid(), tenderType: z.enum(["cash", "check", "store_credit", "card_terminal_import"]), amountCents: z.number().int().positive(), transactionKey: z.string().min(3) }).parse(req.body);
      const actor = (req as AppRequest).authUser!;
      return reply.code(201).send(await paymentService.capture(body, actor));
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/payments/import-settlement", { preHandler: [authenticate, authorize(["admin"])] }, async (req, reply) => {
    try {
      const body = z.object({ records: z.array(z.object({ orderId: z.string().uuid(), amountCents: z.number().int().positive(), tenderType: z.enum(["cash", "check", "store_credit", "card_terminal_import"]), transactionKey: z.string().min(3) })) }).parse(req.body);
      const actor = (req as AppRequest).authUser!;
      return await paymentService.importSettlement(body.records, actor);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.get("/api/payments/:id", { preHandler: [authenticate, authorize(["buyer", "seller", "admin"])] }, async (req, reply) => {
    try {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const actor = (req as AppRequest).authUser!;
      return await paymentService.getPayment(params.id, actor);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });
}
