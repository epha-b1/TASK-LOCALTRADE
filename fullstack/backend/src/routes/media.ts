import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../plugins/auth.js";
import type { AppRequest } from "../types/auth.js";
import { mediaService } from "../services/media-service.js";
import { handleRouteError } from "./_shared.js";

export async function mediaRoutes(app: FastifyInstance) {
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.post("/api/media/upload-sessions", { preHandler: [authenticate, authorize(["seller", "buyer"])] }, async (req, reply) => {
    try {
      const body = z.object({ listingId: z.string().uuid(), fileName: z.string().min(1), sizeBytes: z.number().int().positive(), extension: z.string().min(1), mimeType: z.string().min(1), totalChunks: z.number().int().positive(), chunkSizeBytes: z.number().int().positive() }).parse(req.body);
      const actor = (req as AppRequest).authUser!;
      const session = await mediaService.createUploadSession({ ...body, sellerId: actor.id }, actor);
      return reply.code(201).send({ ...session, accepted: true });
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.put("/api/media/upload-sessions/:sessionId/chunks/:chunkIndex", { preHandler: [authenticate, authorize(["seller", "buyer"])] }, async (req, reply) => {
    try {
      const params = z.object({ sessionId: z.string().uuid(), chunkIndex: z.coerce.number().int().nonnegative() }).parse(req.params);
      const actor = (req as AppRequest).authUser!;
      const result = await mediaService.uploadChunk({ sessionId: params.sessionId, sellerId: actor.id, chunkIndex: params.chunkIndex, body: (req.body as Buffer) ?? Buffer.alloc(0) });
      return result;
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/media/upload-sessions/:sessionId/finalize", { preHandler: [authenticate, authorize(["seller", "buyer"])] }, async (req, reply) => {
    try {
      const params = z.object({ sessionId: z.string().uuid() }).parse(req.params);
      const body = z.object({ detectedMime: z.string().optional() }).parse(req.body ?? {});
      const actor = (req as AppRequest).authUser!;
      return reply.code(202).send(await mediaService.finalizeUpload({ sessionId: params.sessionId, sellerId: actor.id, detectedMime: body.detectedMime }, actor));
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.get("/api/media/assets/:assetId/signed-url", { preHandler: [authenticate] }, async (req, reply) => {
    try {
      const params = z.object({ assetId: z.string().uuid() }).parse(req.params);
      const actor = (req as AppRequest).authUser!;
      await mediaService.canActorAccessAsset(params.assetId, actor);
      return await mediaService.createSignedUrl(params.assetId);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });
}
