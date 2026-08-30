import express, { type Application } from "express";
import cors from "cors";
import helmet, { type HelmetOptions } from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import compression from "compression";
import { apiLimiter } from "./config/rate-limit";
import { errorHandler, notFoundHandler } from "./common/middleware";
import { routes } from "./routes";
import { API_PREFIX } from "./common/constants";
import { prisma } from "./db";
import { UPLOADS_DIR } from "./common/utils/upload";
import { env } from "./config/env";
import { helmetOptions } from "./config/helmet";
import { corsOptions } from "./config/cors";
import { logger } from "./config/logger";

export function createApp(): Application {
  const app = express();

  // ─── Trust Proxy ──────────────────────────────────────────
  // Behind a single reverse proxy (nginx/caddy) trust the first hop so the
  // rate limiters key on real client IPs instead of the proxy's shared IP.
  // Never `true` — that would let anyone spoof X-Forwarded-For and bypass
  // rate limiting (express-rate-limit v8 also refuses permissive trust).
  // env.ts validates TRUST_PROXY and rejects the permissive "true" value.
  const trustProxyValue = env.TRUST_PROXY ?? (env.NODE_ENV === "production" ? "1" : "false");
  app.set(
    "trust proxy",
    trustProxyValue === "false"
      ? false
      : /^\d+$/.test(trustProxyValue)
        ? parseInt(trustProxyValue, 10)
        : trustProxyValue,
  );

  // ─── Security Middleware ──────────────────────────────────
  app.use(
    (helmet as unknown as (options?: HelmetOptions) => express.RequestHandler)(helmetOptions),
  );
  app.use(cors(corsOptions));

  // ─── Static Files (uploads) ───────────────────────────────
  app.use("/uploads", express.static(UPLOADS_DIR));

  // ─── Body Parsing ─────────────────────────────────────────
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  // ─── Cookie Parsing ───────────────────────────────────────
  app.use(cookieParser());

  // ─── Compression ──────────────────────────────────────────
  app.use(compression());

  // ─── Request Logging (Morgan) ─────────────────────────────
  if (env.NODE_ENV !== "test") {
    app.use(morgan("combined", { stream: logger.stream }));
  }

  // ─── Rate Limiting ────────────────────────────────────────
  app.use(API_PREFIX, apiLimiter);

  // ─── Health Check ─────────────────────────────────────────
  app.get(`${API_PREFIX}/health`, async (_req, res) => {
    let dbStatus = "disconnected";
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbStatus = "connected";
    } catch {
      dbStatus = "error";
    }

    res.json({
      success: true,
      data: {
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        environment: env.NODE_ENV,
        application: {
          name: env.APP_NAME,
          version: env.APP_VERSION,
        },
        database: {
          status: dbStatus,
        },
      },
    });
  });

  // ─── API Routes ───────────────────────────────────────────
  app.use(API_PREFIX, routes);

  // ─── Error Handling (must be last) ────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
