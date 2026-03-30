import { createRefreshToken, hashPassword, hashRefreshToken, signAccessToken, verifyPassword } from "../auth.js";
import { createHash, randomUUID } from "node:crypto";
import { authRepository } from "../repositories/auth-repository.js";
import { auditRepository } from "../repositories/audit-repository.js";
import { userRepository } from "../repositories/user-repository.js";
import { encryptText } from "../security/encryption.js";
import type { AuthUser } from "../types/auth.js";
import { HttpError } from "../utils/http-error.js";

const passwordPolicy = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

export const authService = {
  async login(email: string, password: string) {
    const user = await userRepository.findByEmail(email);
    if (!user) throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid credentials");
    if (user.status !== "active") throw new HttpError(423, "USER_INACTIVE", "User is inactive");
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid credentials");
    const accessToken = await signAccessToken({ sub: user.id, roles: user.roles });
    const refreshToken = createRefreshToken();
    await authRepository.createRefreshToken(hashRefreshToken(refreshToken), user.id);
    await auditRepository.create({ id: user.id, roles: user.roles }, "auth.login", "user", user.id);
    return { accessToken, refreshToken, roles: user.roles };
  },

  async refresh(refreshToken: string) {
    const found = await authRepository.findValidRefreshToken(hashRefreshToken(refreshToken));
    if (!found) throw new HttpError(401, "INVALID_REFRESH_TOKEN", "Refresh token invalid");
    if (found.status !== "active") throw new HttpError(423, "USER_INACTIVE", "User is inactive");
    const roles = await userRepository.getRoles(found.user_id);
    await authRepository.revokeRefreshToken(hashRefreshToken(refreshToken));
    const newRefreshToken = createRefreshToken();
    await authRepository.createRefreshToken(hashRefreshToken(newRefreshToken), found.user_id);
    const accessToken = await signAccessToken({ sub: found.user_id, roles });
    return { accessToken, refreshToken: newRefreshToken };
  },

  async logout(refreshToken: string) {
    await authRepository.revokeRefreshToken(hashRefreshToken(refreshToken));
  },

  async register(input: { email: string; password: string; displayName: string; roles: AuthUser["roles"] }) {
    if (input.roles.some((role) => !["buyer", "seller"].includes(role))) {
      throw new HttpError(400, "ROLE_NOT_SELF_ASSIGNABLE", "Privileged roles are not self-assignable");
    }
    if (input.roles.includes("admin") && input.roles.length > 1) {
      throw new HttpError(400, "ADMIN_ROLE_EXCLUSIVE", "Admin role must be exclusive");
    }
    if (await userRepository.emailExists(input.email)) {
      throw new HttpError(409, "EMAIL_EXISTS", "Email already exists");
    }
    if (!passwordPolicy.test(input.password)) {
      throw new HttpError(400, "WEAK_PASSWORD", "Password must be at least 8 characters and include letters and numbers");
    }
    const created = await userRepository.createUser({
      email: input.email,
      passwordHash: await hashPassword(input.password),
      displayName: input.displayName,
      roles: input.roles,
    });
    await auditRepository.create(null, "auth.register", "user", created.id, undefined, { roles: input.roles });
    return created;
  },

  async forgotPassword(email: string) {
    const resetToken = randomUUID();
    const tokenHash = createHash("sha256").update(resetToken).digest("hex");
    const tokenEnc = encryptText(resetToken);
    const user = await userRepository.findByEmail(email);
    if (user) {
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await authRepository.createPasswordResetToken({ userId: user.id, tokenHash, tokenEnc, expiresAtIso: expiresAt });
      await auditRepository.create({ id: user.id, roles: user.roles }, "auth.password_reset.request", "user", user.id);
    } else {
      await auditRepository.create(null, "auth.password_reset.request.unknown_email", "user", email);
    }
    return { message: "If the account exists, reset instructions have been issued" };
  },

  async resetPassword(input: { resetToken: string; newPassword: string }) {
    if (!passwordPolicy.test(input.newPassword)) {
      throw new HttpError(400, "WEAK_PASSWORD", "Password must be at least 8 characters and include letters and numbers");
    }
    const tokenHash = createHash("sha256").update(input.resetToken).digest("hex");
    const token = await authRepository.findValidPasswordResetToken(tokenHash);
    if (!token) throw new HttpError(400, "INVALID_RESET_TOKEN", "Reset token is invalid or expired");
    const passwordHash = await hashPassword(input.newPassword);
    await userRepository.setPasswordHash(token.user_id, passwordHash);
    await authRepository.usePasswordResetToken(token.id);
    const roles = await userRepository.getRoles(token.user_id);
    await auditRepository.create({ id: token.user_id, roles }, "auth.password_reset.complete", "user", token.user_id);
  },

  async createUser(input: { email: string; password: string; displayName: string; roles: AuthUser["roles"] }, actor: AuthUser) {
    if (input.roles.includes("admin") && input.roles.length > 1) {
      throw new HttpError(400, "ADMIN_ROLE_EXCLUSIVE", "Admin role must be exclusive");
    }
    if (!passwordPolicy.test(input.password)) {
      throw new HttpError(400, "WEAK_PASSWORD", "Password must be at least 8 characters and include letters and numbers");
    }
    if (await userRepository.emailExists(input.email)) {
      throw new HttpError(409, "EMAIL_EXISTS", "Email already exists");
    }
    const created = await userRepository.createUser({
      email: input.email,
      passwordHash: await hashPassword(input.password),
      displayName: input.displayName,
      roles: input.roles,
    });
    await auditRepository.create(actor, "admin.user.create", "user", created.id, undefined, { roles: input.roles });
    return created;
  },
};
