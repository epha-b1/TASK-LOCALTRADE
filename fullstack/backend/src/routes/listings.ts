import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../plugins/auth.js";
import type { AppRequest } from "../types/auth.js";
import { listingService } from "../services/listing-service.js";
import { handleRouteError } from "./_shared.js";

export async function listingRoutes(app: FastifyInstance) {
  app.get("/api/listings", { preHandler: [authenticate, authorize(["seller"])], schema: { tags: ["listings"], security: [{ bearerAuth: [] }], response: { 200: { type: "object", additionalProperties: true } } } }, async (req, reply) => {
    try {
      const query = z.object({ status: z.enum(["draft", "flagged", "published", "removed"]).optional() }).parse(req.query);
      const actor = (req as AppRequest).authUser!;
      return await listingService.listOwn(actor, query.status);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.get("/api/listings/:id", { preHandler: [authenticate, authorize(["seller", "admin"])] }, async (req, reply) => {
    try {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const actor = (req as AppRequest).authUser!;
      return await listingService.getReadiness(params.id, actor);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/listings", { preHandler: [authenticate, authorize(["seller"])] }, async (req, reply) => {
    try {
      const body = z.object({ title: z.string().min(1), description: z.string().min(1), priceCents: z.number().int().positive(), quantity: z.number().int().nonnegative(), category: z.string().optional() }).parse(req.body);
      const actor = (req as AppRequest).authUser!;
      const listing = await listingService.create({ sellerId: actor.id, title: body.title, description: body.description, priceCents: body.priceCents, quantity: body.quantity }, actor);
      return reply.code(201).send(listing);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.patch("/api/listings/:id", { preHandler: [authenticate, authorize(["seller"])] }, async (req, reply) => {
    try {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = z.object({ title: z.string().min(1).optional(), description: z.string().min(1).optional(), priceCents: z.number().int().positive().optional(), quantity: z.number().int().nonnegative().optional() }).parse(req.body);
      const actor = (req as AppRequest).authUser!;
      const current = await listingService.update({ listingId: params.id, sellerId: actor.id, ...body }, actor);
      return current;
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/listings/:id/publish", { preHandler: [authenticate, authorize(["seller"])] }, async (req, reply) => {
    try {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const actor = (req as AppRequest).authUser!;
      return await listingService.publish(params.id, actor.id, actor);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.delete("/api/listings/:id", { preHandler: [authenticate, authorize(["seller", "admin"])], schema: { tags: ["listings"], security: [{ bearerAuth: [] }], response: { 200: { type: "object", additionalProperties: true } } } }, async (req, reply) => {
    try {
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const query = z.object({ force: z.coerce.boolean().optional().default(false) }).parse(req.query);
      const actor = (req as AppRequest).authUser!;
      return await listingService.remove(params.id, actor, query.force);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.get("/api/storefront/listings", async (req, reply) => {
    try {
      const query = z
        .object({
          ranking: z.enum(["verified_purchase_first", "most_recent", "highest_rated"]).optional(),
          sellerId: z.string().uuid().optional(),
        })
        .parse(req.query);
      return { items: await listingService.listStorefront({ ranking: query.ranking ?? "verified_purchase_first", sellerId: query.sellerId }) };
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });
}
