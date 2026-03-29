import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../plugins/auth.js";
import { adminService } from "../services/admin-service.js";
import { handleRouteError } from "./_shared.js";

export async function jobRoutes(app: FastifyInstance) {
  app.get("/api/admin/jobs", { preHandler: [authenticate, authorize(["admin"])] }, async (_req, reply) => {
    try {
      return await adminService.listJobs();
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/admin/jobs/:id/retry", { preHandler: [authenticate, authorize(["admin"])] }, async (req, reply) => {
    try {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      return await adminService.retryJob(params.id);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });
}
