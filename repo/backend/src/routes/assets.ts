import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { z } from "zod";
import { authenticate, authorize } from "../plugins/auth.js";
import type { AppRequest } from "../types/auth.js";
import { mediaService } from "../services/media-service.js";
import { config } from "../config.js";
import { hmacSha256 } from "../security/hmac.js";
import { handleRouteError } from "./_shared.js";

export async function assetRoutes(app: FastifyInstance) {
  app.get("/api/assets/:id", { preHandler: [authenticate, authorize(["seller", "moderator", "admin"])] }, async (req, reply) => {
    try {
      const actor = (req as AppRequest).authUser!;
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const asset = await mediaService.getAsset(params.id);
      if (actor.roles.includes("seller") && !actor.roles.includes("admin") && asset.seller_id !== actor.id) {
        return reply.code(403).send({ code: "FORBIDDEN", message: "Forbidden" });
      }
      return {
        id: asset.id,
        listingId: asset.listing_id,
        status: asset.status,
        mimeType: asset.mime_type,
        sizeBytes: Number(asset.size_bytes),
        metadata: asset.metadata_json,
      };
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.get("/api/assets/:id/metadata", { preHandler: [authenticate, authorize(["seller", "moderator", "admin", "buyer"])] }, async (req, reply) => {
    try {
      const actor = (req as AppRequest).authUser!;
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const asset = await mediaService.canActorAccessAsset(params.id, actor);
      if (asset.status !== "ready") {
        return reply.code(409).send({ code: "METADATA_NOT_READY", message: "Metadata not ready" });
      }
      return asset.metadata_json ?? {};
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.get("/download/:assetId", async (req, reply) => {
    try {
      const params = z.object({ assetId: z.string().uuid() }).parse(req.params);
      const query = z.object({ exp: z.coerce.number(), sig: z.string() }).parse(req.query);
      if (Math.floor(Date.now() / 1000) > query.exp) {
        return reply.code(403).send({ code: "INVALID_SIGNATURE", message: "URL expired" });
      }
      const expectedSig = hmacSha256(`${params.assetId}:${query.exp}`, config.signedUrlSecret);
      if (query.sig !== expectedSig) {
        return reply.code(403).send({ code: "INVALID_SIGNATURE", message: "Signature mismatch" });
      }
      const asset = await mediaService.getAsset(params.assetId);
      reply.header("Content-Type", asset.mime_type);
      return reply.send(createReadStream(asset.storage_path));
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });
}
