import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authService } from "../services/auth-service.js";
import { config } from "../config.js";
import { enforcePublicWriteSecurity } from "../plugins/auth.js";
import { HttpError } from "../utils/http-error.js";
import { handleRouteError } from "./_shared.js";

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/register", {
    preHandler: [enforcePublicWriteSecurity],
    schema: {
      tags: ["auth"],
      body: {
        type: "object",
        required: ["email", "password", "displayName"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 8 },
          displayName: { type: "string", minLength: 1 },
          roles: { type: "array", items: { type: "string" } },
        },
      },
      response: { 201: { type: "object", additionalProperties: true } },
    },
  }, async (req, reply) => {
    try {
      const rawRoles = (req.body as any)?.roles;
      if (Array.isArray(rawRoles) && rawRoles.some((role) => ["moderator", "arbitrator", "admin"].includes(String(role)))) {
        throw new HttpError(400, "ROLE_NOT_SELF_ASSIGNABLE", "Privileged roles are not self-assignable");
      }
      const body = z
        .object({
          email: z.string().email(),
          password: z.string().min(8).regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "Password must include letters and numbers"),
          displayName: z.string().min(1),
          roles: z.array(z.enum(["buyer", "seller"])).min(1).optional(),
        })
        .parse(req.body);
      const created = await authService.register({
        email: body.email,
        password: body.password,
        displayName: body.displayName,
        roles: body.roles ?? ["buyer"],
      });
      return reply.code(201).send({ id: created.id, email: created.email, displayName: body.displayName, roles: created.roles });
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/auth/forgot-password", {
    preHandler: [enforcePublicWriteSecurity],
    schema: {
      tags: ["auth"],
      body: {
        type: "object",
        required: ["email"],
        properties: { email: { type: "string", format: "email" } },
      },
      response: { 200: { type: "object", additionalProperties: true } },
    },
  }, async (req, reply) => {
    try {
      const body = z.object({ email: z.string().email() }).parse(req.body);
      return await authService.forgotPassword(body.email);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/auth/reset-password", {
    preHandler: [enforcePublicWriteSecurity],
    schema: {
      tags: ["auth"],
      body: {
        type: "object",
        required: ["resetToken", "newPassword"],
        properties: {
          resetToken: { type: "string", minLength: 10 },
          newPassword: { type: "string", minLength: 8 },
        },
      },
      response: { 204: { type: "null" } },
    },
  }, async (req, reply) => {
    try {
      const body = z
        .object({
          resetToken: z.string().min(10),
          newPassword: z.string().min(8).regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "Password must include letters and numbers"),
        })
        .parse(req.body);
      await authService.resetPassword(body);
      return reply.code(204).send();
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/auth/login", { preHandler: [enforcePublicWriteSecurity], schema: { tags: ["auth"], body: { type: "object", additionalProperties: true }, response: { 200: { type: "object", additionalProperties: true } } } }, async (req, reply) => {
    try {
      const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
      const auth = await authService.login(body.email, body.password);
      return { accessToken: auth.accessToken, refreshToken: auth.refreshToken, expiresIn: config.jwtAccessTtlSec, roles: auth.roles };
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/auth/refresh", { preHandler: [enforcePublicWriteSecurity], schema: { tags: ["auth"], body: { type: "object", additionalProperties: true }, response: { 200: { type: "object", additionalProperties: true } } } }, async (req, reply) => {
    try {
      const body = z.object({ refreshToken: z.string().min(20) }).parse(req.body);
      const token = await authService.refresh(body.refreshToken);
      return { accessToken: token.accessToken, refreshToken: token.refreshToken, expiresIn: config.jwtAccessTtlSec };
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post("/api/auth/logout", { preHandler: [enforcePublicWriteSecurity], schema: { tags: ["auth"], body: { type: "object", additionalProperties: true }, response: { 204: { type: "null" } }, security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    try {
      const body = z.object({ refreshToken: z.string().min(20) }).parse(req.body);
      await authService.logout(body.refreshToken);
      return reply.code(204).send();
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });
}
