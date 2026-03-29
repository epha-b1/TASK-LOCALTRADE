import { securityService } from "../services/security-service.js";

export async function rateLimitByUser(userId: string) {
  await securityService.enforceRateLimit(userId);
}
