import { hash, verify } from "@node-rs/argon2";
import { SignJWT, jwtVerify } from "jose";
import { createHash, randomBytes } from "node:crypto";
import { config } from "./config.js";

const secret = new TextEncoder().encode(config.jwtSecret);

export type RoleCode = "buyer" | "seller" | "moderator" | "arbitrator" | "admin";

export interface AuthPayload {
  sub: string;
  roles: RoleCode[];
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return verify(passwordHash, password);
}

export async function signAccessToken(payload: AuthPayload): Promise<string> {
  return new SignJWT({ roles: payload.roles })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${config.jwtAccessTtlSec}s`)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AuthPayload> {
  const verified = await jwtVerify(token, secret);
  return {
    sub: String(verified.payload.sub),
    roles: (verified.payload.roles as RoleCode[]) ?? [],
  };
}

export function createRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
