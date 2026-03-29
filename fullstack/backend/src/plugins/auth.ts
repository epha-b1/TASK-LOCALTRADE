import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppRequest, AuthUser, RoleCode } from "../types/auth.js";
import { verifyAccessToken } from "../auth.js";
import { securityService } from "../services/security-service.js";
import { HttpError } from "../utils/http-error.js";

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing token");
  }
  let payload;
  try {
    payload = await verifyAccessToken(header.slice(7));
  } catch {
    throw new HttpError(401, "UNAUTHORIZED", "Invalid token");
  }
  const user: AuthUser = { id: payload.sub, roles: payload.roles };
  (req as AppRequest).authUser = user;
  await securityService.enforceRateLimit(user.id, reply);
  const nonce = String(req.headers["x-request-nonce"] ?? "").trim();
  const timestamp = Number(req.headers["x-request-timestamp"] ?? 0);
  await securityService.enforceReplayProtection(nonce, timestamp);
}

export async function enforcePublicWriteSecurity(req: FastifyRequest, reply: FastifyReply) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return;
  }
  const nonce = String(req.headers["x-request-nonce"] ?? "").trim();
  const timestamp = Number(req.headers["x-request-timestamp"] ?? 0);
  await securityService.enforceReplayProtection(nonce, timestamp);
  const clientKey = req.ip || "unknown";
  await securityService.enforcePublicRateLimit(`public:${clientKey}`, reply);
}

export function authorize(allowed: RoleCode[]) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const user = (req as AppRequest).authUser;
    if (!user) throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    if (!allowed.some((r) => user.roles.includes(r))) {
      throw new HttpError(403, "FORBIDDEN", "Insufficient role");
    }
  };
}
