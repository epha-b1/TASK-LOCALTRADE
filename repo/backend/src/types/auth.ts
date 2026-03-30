import type { FastifyRequest } from "fastify";

export type RoleCode = "buyer" | "seller" | "moderator" | "arbitrator" | "admin";

export interface AuthUser {
  id: string;
  roles: RoleCode[];
}

export interface AppRequest extends FastifyRequest {
  authUser?: AuthUser;
}
