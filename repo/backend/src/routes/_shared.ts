import type { FastifyReply } from "fastify";
import { ZodError } from "zod";
import { HttpError } from "../utils/http-error.js";

export function handleRouteError(reply: FastifyReply, error: unknown) {
  if (error instanceof HttpError) {
    return reply.code(error.statusCode).send({ code: error.code, message: error.message });
  }
  if (error instanceof ZodError) {
    return reply.code(400).send({ code: "VALIDATION_ERROR", message: "Validation error", details: error.flatten() });
  }
  return reply.code(500).send({ code: "INTERNAL_SERVER_ERROR", message: "Internal server error" });
}
