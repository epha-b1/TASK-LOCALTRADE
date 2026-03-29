import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../plugins/auth.js";
import type { AppRequest } from "../types/auth.js";
import { authService } from "../services/auth-service.js";
import { userService } from "../services/user-service.js";
import { handleRouteError } from "./_shared.js";

export async function userRoutes(app: FastifyInstance) {
  app.get("/api/users/me", { preHandler: [authenticate] }, async (req, reply) => {
    try {
      const user = (req as AppRequest).authUser!;
      return await userService.me(user.id);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.get("/api/users/me/store-credit", { preHandler: [authenticate, authorize(["buyer"])] }, async (req, reply) => {
    try {
      const actor = (req as AppRequest).authUser!;
      return await userService.getStoreCreditBalance(actor.id);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.patch("/api/users/me/seller-profile", { preHandler: [authenticate, authorize(["seller", "admin"])] }, async (req, reply) => {
    try {
      const body = z
        .object({
          taxId: z.string().min(4).optional(),
          bankRouting: z.string().min(4).optional(),
          bankAccount: z.string().min(4).optional(),
        })
        .refine((v) => Boolean(v.taxId || v.bankRouting || v.bankAccount), { message: "At least one sensitive field is required" })
        .parse(req.body);
      const actor = (req as AppRequest).authUser!;
      return await userService.updateSellerSensitiveProfile({ userId: actor.id, ...body }, actor);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/admin/users", { preHandler: [authenticate, authorize(["admin"])] }, async (req, reply) => {
    try {
      const body = z.object({
        email: z.string().email(),
        password: z.string().min(8).regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "Password must include letters and numbers"),
        displayName: z.string().min(1),
        roles: z.array(z.enum(["buyer", "seller", "moderator", "arbitrator", "admin"])).min(1),
      }).parse(req.body);
      const actor = (req as AppRequest).authUser!;
      const created = await authService.createUser(body, actor);
      return reply.code(201).send(created);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.patch("/api/admin/users/:id/status", { preHandler: [authenticate, authorize(["admin"])] }, async (req, reply) => {
    try {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = z.object({ status: z.enum(["active", "inactive"]), reason: z.string().min(1) }).parse(req.body);
      const actor = (req as AppRequest).authUser!;
      return await userService.setStatus({ userId: params.id, status: body.status }, actor);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });
}
