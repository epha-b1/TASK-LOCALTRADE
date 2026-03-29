import Fastify from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { readFileSync } from "node:fs";
import { config } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { pool } from "./db/pool.js";
import { runSeed } from "./db/seed.js";
import { processAssetPostprocessJobs, processBackupJobs, recoverStaleJobs, startNightlyBackupScheduler } from "./jobs/worker.js";
import { fileStorage } from "./storage/file-storage.js";
import { adminRoutes } from "./routes/admin.js";
import { appealRoutes } from "./routes/appeals.js";
import { assetRoutes } from "./routes/assets.js";
import { auditLogRoutes } from "./routes/audit-logs.js";
import { authRoutes } from "./routes/auth.js";
import { contentSafetyRoutes } from "./routes/content-safety.js";
import { jobRoutes } from "./routes/jobs.js";
import { listingRoutes } from "./routes/listings.js";
import { mediaRoutes } from "./routes/media.js";
import { moderationRoutes } from "./routes/moderation.js";
import { orderRoutes } from "./routes/orders.js";
import { paymentRoutes } from "./routes/payments.js";
import { refundRoutes } from "./routes/refunds.js";
import { reviewRoutes } from "./routes/reviews.js";
import { storefrontRoutes } from "./routes/storefront.js";
import { userRoutes } from "./routes/users.js";

export function buildServer() {
  const app = Fastify({ logger: true });
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "http://localhost:4200")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  app.addHook("onRoute", (routeOptions) => {
    const existing = routeOptions.schema ?? {};
    const requiresAuth = routeOptions.url.startsWith("/api/") && !routeOptions.url.startsWith("/api/auth/") && !routeOptions.url.startsWith("/api/storefront/") && !routeOptions.url.startsWith("/api/storefront") && !routeOptions.url.startsWith("/api/reviews/") && !routeOptions.url.startsWith("/api/storefront/sellers/") && !routeOptions.url.startsWith("/api/storefront/listings");
    routeOptions.schema = {
      ...existing,
      tags: (existing as any).tags ?? [routeOptions.url.split("/")[2] || "general"],
      security: (existing as any).security ?? (requiresAuth ? [{ bearerAuth: [] }] : []),
      response: (existing as any).response ?? { 200: { type: "object", additionalProperties: true } },
    } as any;
  });

  app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error("CORS origin not allowed"), false);
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "X-Request-Nonce", "X-Request-Timestamp", "Content-Type"],
  });

  app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "LocalTrade Marketplace API",
        version: pkg.version ?? "1.0.0",
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
    },
  });

  app.register(swaggerUi, {
    routePrefix: "/docs",
  });

  app.setErrorHandler((error, _req, reply) => {
    if ((error as any).statusCode && (error as any).code) {
      return reply.code((error as any).statusCode).send({ code: (error as any).code, message: (error as Error).message });
    }
    return reply.code(500).send({ code: "INTERNAL_SERVER_ERROR", message: "Internal server error" });
  });

  app.get("/health/live", async () => ({ ok: true }));
  app.get("/health/ready", async () => {
    await pool.query("SELECT 1");
    return { ok: true };
  });

  app.register(authRoutes);
  app.register(userRoutes);
  app.register(listingRoutes);
  app.register(mediaRoutes);
  app.register(assetRoutes);
  app.register(jobRoutes);
  app.register(orderRoutes);
  app.register(paymentRoutes);
  app.register(refundRoutes);
  app.register(reviewRoutes);
  app.register(appealRoutes);
  app.register(moderationRoutes);
  app.register(contentSafetyRoutes);
  app.register(storefrontRoutes);
  app.register(auditLogRoutes);
  app.register(adminRoutes);

  return app;
}

async function start() {
  await runMigrations();
  await runSeed();
  await fileStorage.ensureRoots();
  await recoverStaleJobs();
  await processAssetPostprocessJobs();
  await processBackupJobs();
  startNightlyBackupScheduler();
  const app = buildServer();
  await app.listen({ port: config.apiPort, host: "0.0.0.0" });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
}
