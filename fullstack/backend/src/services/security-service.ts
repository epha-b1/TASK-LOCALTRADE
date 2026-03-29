import type { FastifyReply } from "fastify";
import { config } from "../config.js";
import { securityRepository } from "../repositories/security-repository.js";
import { HttpError } from "../utils/http-error.js";

export const securityService = {
  async enforceRateLimit(userId: string, reply?: FastifyReply) {
    const nowSec = Math.floor(Date.now() / 1000);
    await securityRepository.incrementRateLimit(userId, nowSec);
    await securityRepository.cleanupRateLimit(nowSec - 120);
    const count = await securityRepository.sumRateLimit(userId, nowSec - 59);
    if (count > config.rateLimitPerMin) {
      const retryAfter = 1;
      reply?.header("Retry-After", String(retryAfter));
      throw new HttpError(429, "RATE_LIMIT_EXCEEDED", "Rate limit exceeded");
    }
  },

  async enforcePublicRateLimit(clientKey: string, reply?: FastifyReply) {
    const nowSec = Math.floor(Date.now() / 1000);
    await securityRepository.incrementPublicRateLimit(clientKey, nowSec);
    await securityRepository.cleanupPublicRateLimit(nowSec - 120);
    const count = await securityRepository.sumPublicRateLimit(clientKey, nowSec - 59);
    if (count > config.rateLimitPerMin) {
      const retryAfter = 1;
      reply?.header("Retry-After", String(retryAfter));
      throw new HttpError(429, "RATE_LIMIT_EXCEEDED", "Rate limit exceeded");
    }
  },

  async enforceReplayProtection(nonce: string, timestamp: number) {
    const now = Math.floor(Date.now() / 1000);
    if (!nonce || !Number.isFinite(timestamp)) {
      throw new HttpError(400, "REPLAY_HEADERS_REQUIRED", "Nonce and timestamp headers are required");
    }
    if (Math.abs(now - timestamp) > config.nonceWindowSec) {
      throw new HttpError(400, "TIMESTAMP_OUT_OF_WINDOW", "Timestamp outside replay window");
    }
    try {
      await securityRepository.registerNonce(nonce);
      await securityRepository.cleanupNonces();
    } catch {
      throw new HttpError(409, "REPLAY_DETECTED", "Nonce already used");
    }
  },
};
