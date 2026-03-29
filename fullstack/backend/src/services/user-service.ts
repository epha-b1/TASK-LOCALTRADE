import { auditRepository } from "../repositories/audit-repository.js";
import { userRepository } from "../repositories/user-repository.js";
import { decryptText, encryptText } from "../security/encryption.js";
import type { AuthUser } from "../types/auth.js";
import { HttpError } from "../utils/http-error.js";

function maskLast4(value: string | null | undefined) {
  if (!value) return null;
  const cleaned = value.trim();
  if (!cleaned) return null;
  const last4 = cleaned.slice(-4);
  return `****${last4}`;
}

function decryptAndMask(value: string | null | undefined) {
  if (!value) return null;
  return maskLast4(decryptText(value));
}

export const userService = {
  async me(userId: string) {
    const user = await userRepository.findMe(userId);
    if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
    const roles = user.roles;
    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      status: user.status,
      roles,
      sensitiveProfile:
        roles.includes("seller")
          ? {
              taxIdMasked: decryptAndMask(user.tax_id_enc),
              bankRoutingMasked: decryptAndMask(user.bank_routing_enc),
              bankAccountMasked: decryptAndMask(user.bank_account_enc),
            }
          : undefined,
    };
  },

  async updateSellerSensitiveProfile(
    input: { userId: string; taxId?: string; bankRouting?: string; bankAccount?: string },
    actor: AuthUser,
  ) {
    if (!actor.roles.includes("seller") && !actor.roles.includes("admin")) {
      throw new HttpError(403, "FORBIDDEN", "Forbidden");
    }
    const updated = await userRepository.updateSellerSensitiveFields({
      userId: input.userId,
      taxIdEnc: input.taxId ? encryptText(input.taxId) : undefined,
      bankRoutingEnc: input.bankRouting ? encryptText(input.bankRouting) : undefined,
      bankAccountEnc: input.bankAccount ? encryptText(input.bankAccount) : undefined,
    });
    if (!updated) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
    await auditRepository.create(actor, "seller.profile.sensitive.update", "user", input.userId, undefined, {
      taxIdUpdated: Boolean(input.taxId),
      bankRoutingUpdated: Boolean(input.bankRouting),
      bankAccountUpdated: Boolean(input.bankAccount),
    });
    return { ok: true };
  },

  async setStatus(input: { userId: string; status: "active" | "inactive" }, actor: AuthUser) {
    const updated = await userRepository.setStatus(input.userId, input.status);
    if (!updated) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
    await auditRepository.create(actor, "admin.user.status", "user", input.userId, undefined, input);
    return updated;
  },

  async listUsers(page: number, pageSize: number) {
    const data = await userRepository.listUsers(page, pageSize);
    return { items: data.items, page, pageSize, total: data.total };
  },

  async updateRoles(input: { userId: string; roles: AuthUser["roles"] }, actor: AuthUser) {
    if (input.roles.includes("admin") && input.roles.length > 1) {
      throw new HttpError(400, "ADMIN_ROLE_EXCLUSIVE", "Admin role must be exclusive");
    }
    const updated = await userRepository.updateRoles(input.userId, input.roles);
    if (!updated) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
    await auditRepository.create(actor, "admin.user.roles", "user", input.userId, undefined, { roles: input.roles });
    return updated;
  },

  async getStoreCreditBalance(userId: string) {
    const balance = await userRepository.getStoreCreditBalance(userId);
    return { balanceCents: balance };
  },

  async issueStoreCredit(input: { userId: string; amountCents: number; note: string }, actor: AuthUser) {
    const roles = await userRepository.getRoles(input.userId);
    if (!roles.includes("buyer")) {
      throw new HttpError(409, "USER_NOT_BUYER", "Store credit can only be issued to buyers");
    }
    await userRepository.addStoreCredit(input.userId, input.amountCents, input.note);
    await auditRepository.create(actor, "admin.store_credit.issue", "user", input.userId, undefined, input);
    return { userId: input.userId, amountCents: input.amountCents };
  },
};
