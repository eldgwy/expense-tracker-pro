import express, { type Application } from "express";
import cors from "cors";
import helmet, { type HelmetOptions } from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import compression from "compression";
import { apiLimiter } from "./config/rate-limit.js";
import { errorHandler, notFoundHandler } from "./common/middleware/index.js";
import { routes } from "./routes/index.js";
import { API_PREFIX } from "./common/constants/index.js";
import { prisma } from "./db/index.js";
import { UPLOADS_DIR } from "./common/utils/upload.js";
import { env } from "./config/env.js";
import { helmetOptions } from "./config/helmet.js";
import { corsOptions } from "./config/cors.js";
import { logger } from "./config/logger.js";

export function createApp(): Application {
  const app = express();

  // ─── Trust Proxy ──────────────────────────────────────────
  // Behind reverse proxies (e.g. Vercel Edge / Nginx / Caddy), trust the
  // first hop so rate limiters key on real client IPs.
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

  // ─── Root & Fast Health Checks (Unthrottled, No DB dependency) ─
  const quickHealthHandler = (_req: express.Request, res: express.Response) => {
    res.status(200).json({
      success: true,
      message: "API is healthy",
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      environment: env.NODE_ENV,
      application: {
        name: env.APP_NAME,
        version: env.APP_VERSION,
      },
    });
  };

  app.get("/", quickHealthHandler);
  app.get("/health", quickHealthHandler);
  app.get(`${API_PREFIX}/health`, quickHealthHandler);

  // ─── Database Health Check (Isolates DB connection from app boot) ─
  const dbHealthHandler = async (_req: express.Request, res: express.Response) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.status(200).json({
        status: "ok",
        database: "connected",
        timestamp: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(503).json({
        status: "error",
        database: "disconnected",
        error: message,
        timestamp: new Date().toISOString(),
      });
    }
  };

  app.get("/health/db", dbHealthHandler);
  app.get(`${API_PREFIX}/health/db`, dbHealthHandler);

  // ─── Rate Limiting (Applied to standard API routes) ───────
  app.use(API_PREFIX, apiLimiter);

  // ─── API Routes ───────────────────────────────────────────
  app.use(API_PREFIX, routes);

  // ─── Error Handling (must be last) ────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
