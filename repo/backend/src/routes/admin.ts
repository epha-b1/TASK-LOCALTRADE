import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../plugins/auth.js";
import type { AppRequest } from "../types/auth.js";
import { adminService } from "../services/admin-service.js";
import { orderService } from "../services/order-service.js";
import { userService } from "../services/user-service.js";
import { refundService } from "../services/refund-service.js";
import { handleRouteError } from "./_shared.js";

export async function adminRoutes(app: FastifyInstance) {
  app.get("/api/admin/users", { preHandler: [authenticate, authorize(["admin"])] }, async (req, reply) => {
    try {
      const query = z.object({ page: z.coerce.number().int().positive().default(1), pageSize: z.coerce.number().int().positive().max(100).default(20) }).parse(req.query);
      return await userService.listUsers(query.page, query.pageSize);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.get("/api/admin/users/:id/pending-reset-token", { preHandler: [authenticate, authorize(["admin"])] }, async (req, reply) => {
    try {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const actor = (req as AppRequest).authUser!;
      return await adminService.getPendingResetToken(params.id, actor);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.patch("/api/admin/users/:id/roles", { preHandler: [authenticate, authorize(["admin"])] }, async (req, reply) => {
    try {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = z.object({ roles: z.array(z.enum(["buyer", "seller", "moderator", "arbitrator", "admin"])) }).parse(req.body);
      const actor = (req as AppRequest).authUser!;
      return await userService.updateRoles({ userId: params.id, roles: body.roles }, actor);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.get("/api/admin/refunds/pending", { preHandler: [authenticate, authorize(["admin"])] }, async (_req, reply) => {
    try {
      return { items: await refundService.listPendingAdmin() };
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.get("/api/admin/refunds", { preHandler: [authenticate, authorize(["admin"])] }, async (_req, reply) => {
    try {
      return { items: await refundService.listAllAdmin() };
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/admin/users/:id/store-credit", { preHandler: [authenticate, authorize(["admin"])] }, async (req, reply) => {
    try {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = z.object({ amountCents: z.number().int().positive(), note: z.string().min(1) }).parse(req.body);
      const actor = (req as AppRequest).authUser!;
      return await userService.issueStoreCredit({ userId: params.id, amountCents: body.amountCents, note: body.note }, actor);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/admin/webhooks/subscriptions", { preHandler: [authenticate, authorize(["admin"])] }, async (req, reply) => {
    try {
      const body = z.object({ eventType: z.string().min(1), targetUrl: z.string().url(), secret: z.string().min(8) }).parse(req.body);
      const actor = (req as AppRequest).authUser!;
      return reply.code(201).send(await adminService.createWebhook({ ...body, createdBy: actor.id }, actor));
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.patch("/api/admin/webhooks/subscriptions/:id", { preHandler: [authenticate, authorize(["admin"])] }, async (req, reply) => {
    try {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = z.object({ active: z.boolean().optional(), secret: z.string().min(8).optional() }).parse(req.body);
      const actor = (req as AppRequest).authUser!;
      return await adminService.updateWebhook({ id: params.id, active: body.active, secret: body.secret }, actor);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/admin/orders/:id/force-complete", { preHandler: [authenticate, authorize(["admin"])] }, async (req, reply) => {
    try {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = z.object({ reason: z.string().min(1) }).parse(req.body);
      const actor = (req as AppRequest).authUser!;
      return await orderService.forceComplete(params.id, body.reason, actor);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/admin/backups/run", { preHandler: [authenticate, authorize(["admin"])] }, async (req, reply) => {
    try {
      const actor = (req as AppRequest).authUser!;
      return reply.code(202).send(await adminService.queueBackup(actor));
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });
}
