import type { FastifyReply, FastifyRequest } from "fastify";
import { securityService } from "../services/security-service.js";

export async function replayGuard(req: FastifyRequest, _reply: FastifyReply) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return;
  }
  const nonce = String(req.headers["x-request-nonce"] ?? "").trim();
  const timestamp = Number(req.headers["x-request-timestamp"] ?? 0);
  await securityService.enforceReplayProtection(nonce, timestamp);
}
