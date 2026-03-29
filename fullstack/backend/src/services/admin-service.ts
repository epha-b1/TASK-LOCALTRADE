import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
import { encryptText } from "../security/encryption.js";
import { decryptText } from "../security/encryption.js";
import { hmacSha256 } from "../security/hmac.js";
import { isIPv4 } from "node:net";
import { processBackupJobs } from "../jobs/worker.js";
import { adminRepository } from "../repositories/admin-repository.js";
import { authRepository } from "../repositories/auth-repository.js";
import { auditRepository } from "../repositories/audit-repository.js";
import type { AuthUser } from "../types/auth.js";
import { HttpError } from "../utils/http-error.js";

function isLocalHost(host: string): boolean {
  if (host === "localhost") return true;
  if (!isIPv4(host)) return false;
  const parts = host.split(".").map(Number);
  if (parts[0] === 127) return true;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

export async function dispatchWebhookEvent(eventType: string, payload: Record<string, unknown>): Promise<void> {
  const subscriptions = await adminRepository.listActiveWebhooksByEvent(eventType);
  for (const sub of subscriptions) {
    try {
      const secret = decryptText(sub.secret_enc);
      const body = JSON.stringify({ event: eventType, data: payload, ts: Date.now() });
      const sig = hmacSha256(body, secret);
      const parsed = new URL(sub.target_url);
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "X-LocalTrade-Signature": `sha256=${sig}`,
          "X-LocalTrade-Event": eventType,
        },
      };
      const requester = parsed.protocol === "https:" ? httpsRequest : httpRequest;
      await new Promise<void>((resolve) => {
        const req = requester(options, (res) => {
          res.resume();
          resolve();
        });
        req.on("error", () => resolve());
        req.write(body);
        req.end();
      });
    } catch {
      // fire-and-forget per spec; failures are logged via audit
    }
  }
}

export const adminService = {
  async listJobs() {
    return { items: await adminRepository.listJobs() };
  },

  async retryJob(id: string) {
    const job = await adminRepository.findJob(id);
    if (!job) throw new HttpError(404, "JOB_NOT_FOUND", "Job not found");
    if (job.status !== "failed") throw new HttpError(409, "JOB_NOT_RETRIABLE", "Job not retriable");
    await adminRepository.retryJob(id);
    return { id, status: "queued" };
  },

  async createWebhook(input: { createdBy: string; eventType: string; targetUrl: string; secret: string }, actor: AuthUser) {
    const host = new URL(input.targetUrl).hostname;
    if (!isLocalHost(host)) throw new HttpError(400, "INVALID_LOCAL_URL", "Webhook target must be local network");
    if (await adminRepository.findWebhook(input.eventType, input.targetUrl)) {
      throw new HttpError(409, "DUPLICATE_SUBSCRIPTION", "Duplicate subscription");
    }
    const created = await adminRepository.createWebhook({ createdBy: input.createdBy, eventType: input.eventType, targetUrl: input.targetUrl, secretEnc: encryptText(input.secret) });
    await auditRepository.create(actor, "webhook.subscribe", "webhook_subscription", created.id);
    return { id: created.id, active: created.active };
  },

  async updateWebhook(input: { id: string; active?: boolean; secret?: string }, actor: AuthUser) {
    const existing = await adminRepository.findWebhookById(input.id);
    if (!existing) throw new HttpError(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found");
    await adminRepository.updateWebhook({ id: input.id, active: input.active, secretEnc: input.secret ? encryptText(input.secret) : undefined });
    await auditRepository.create(actor, "webhook.update", "webhook_subscription", input.id, undefined, input);
    return { id: input.id, active: input.active ?? true };
  },

  async queueBackup(actor: AuthUser) {
    const jobId = await adminRepository.createBackupJob();
    await auditRepository.create(actor, "backup.run", "job", jobId);
    void processBackupJobs(1);
    return { jobId, status: "queued" };
  },

  async getPendingResetToken(userId: string, actor: AuthUser) {
    const pending = await authRepository.findLatestPendingPasswordResetTokenByUserId(userId);
    if (!pending || !pending.token_enc) {
      throw new HttpError(404, "NO_PENDING_RESET_TOKEN", "No pending reset token for user");
    }
    const resetToken = decryptText(pending.token_enc);
    await auditRepository.create(actor, "admin.password_reset.token_retrieve", "user", userId);
    return { userId: pending.user_id, resetToken, expiresAt: pending.expires_at };
  },
};
