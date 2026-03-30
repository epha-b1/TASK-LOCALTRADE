import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../plugins/auth.js";
import { contentService } from "../services/content-service.js";
import type { AppRequest } from "../types/auth.js";
import { handleRouteError } from "./_shared.js";

export async function contentSafetyRoutes(app: FastifyInstance) {
  app.get("/api/admin/content-rules", { preHandler: [authenticate, authorize(["admin"])], schema: { tags: ["content-safety"], security: [{ bearerAuth: [] }], response: { 200: { type: "object", additionalProperties: true } } } }, async (_req, reply) => {
    try {
      return await contentService.listRules();
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/admin/content-rules", { preHandler: [authenticate, authorize(["admin"])], schema: { tags: ["content-safety"], security: [{ bearerAuth: [] }], body: { type: "object", additionalProperties: true }, response: { 201: { type: "object", additionalProperties: true } } } }, async (req, reply) => {
    try {
      const body = z.object({ ruleType: z.enum(["keyword", "regex"]), pattern: z.string().min(1), active: z.boolean() }).parse(req.body);
      const actor = (req as AppRequest).authUser!;
      return reply.code(201).send(await contentService.createRule(body, actor));
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.patch("/api/admin/content-rules/:id", { preHandler: [authenticate, authorize(["admin"])], schema: { tags: ["content-safety"], security: [{ bearerAuth: [] }], body: { type: "object", additionalProperties: true }, response: { 200: { type: "object", additionalProperties: true } } } }, async (req, reply) => {
    try {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = z
        .object({
          ruleType: z.enum(["keyword", "regex"]).optional(),
          pattern: z.string().min(1).optional(),
          active: z.boolean().optional(),
        })
        .refine((x) => x.ruleType !== undefined || x.pattern !== undefined || x.active !== undefined, "At least one field is required")
        .parse(req.body);
      const actor = (req as AppRequest).authUser!;
      return await contentService.updateRule({ id: params.id, ...body }, actor);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.delete("/api/admin/content-rules/:id", { preHandler: [authenticate, authorize(["admin"])], schema: { tags: ["content-safety"], security: [{ bearerAuth: [] }], response: { 200: { type: "object", additionalProperties: true } } } }, async (req, reply) => {
    try {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const actor = (req as AppRequest).authUser!;
      return await contentService.deleteRule(params.id, actor);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/admin/content-rules/:id/test", { preHandler: [authenticate, authorize(["admin"])], schema: { tags: ["content-safety"], security: [{ bearerAuth: [] }], body: { type: "object", additionalProperties: true }, response: { 200: { type: "object", additionalProperties: true } } } }, async (req, reply) => {
    try {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = z.object({ text: z.string() }).parse(req.body);
      return await contentService.testRule(params.id, body.text);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });
}
