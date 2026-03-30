import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../plugins/auth.js";
import { auditRepository } from "../repositories/audit-repository.js";
import { handleRouteError } from "./_shared.js";

export async function auditLogRoutes(app: FastifyInstance) {
  app.get("/api/admin/audit-logs", { preHandler: [authenticate, authorize(["admin"])], schema: { tags: ["audit-logs"], security: [{ bearerAuth: [] }], response: { 200: { type: "object", additionalProperties: true } } } }, async (req, reply) => {
    try {
      const query = z
        .object({
          page: z.coerce.number().int().positive().default(1),
          pageSize: z.coerce.number().int().positive().max(200).default(50),
          action: z.string().min(1).optional(),
          targetType: z.string().min(1).optional(),
          actorId: z.string().uuid().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
        })
        .parse(req.query);
      const result = await auditRepository.listFiltered(query);
      return { items: result.items, total: result.total, page: query.page, pageSize: query.pageSize };
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.get("/api/admin/audit-logs/:id", { preHandler: [authenticate, authorize(["admin"])] }, async (req, reply) => {
    try {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const row = await auditRepository.findById(params.id);
      if (!row) return reply.code(404).send({ code: "AUDIT_LOG_NOT_FOUND", message: "Audit log not found" });
      return row;
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });
}
