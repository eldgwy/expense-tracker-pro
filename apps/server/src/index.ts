import type { Application } from "express";
import { createApp } from "./app.js";
import { env, logger } from "./config/index.js";
import { startJobsScheduler, stopJobsScheduler } from "./modules/jobs/index.js";
import { prisma } from "./db/index.js";

const app: Application = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`🚀 Server running at http://localhost:${env.PORT}`);
  logger.info(`🌍 Environment: ${env.NODE_ENV}`);
  logger.info(`📡 API prefix: /api/v1`);

  // Start background jobs (skipped in test mode — tests drive jobs manually)
  if (env.NODE_ENV !== "test") {
    startJobsScheduler();
  }
});

// ─── Graceful Shutdown Handler ──────────────────────────────────
async function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}. Initiating graceful shutdown...`);

  server.close(async (err) => {
    if (err) {
      logger.error("Error during HTTP server close:", err);
      process.exit(1);
    }
    logger.info("HTTP server closed.");

    try {
      stopJobsScheduler();
      logger.info("Background jobs scheduler stopped.");

      await prisma.$disconnect();
      logger.info("Prisma database client disconnected cleanly.");

      process.exit(0);
    } catch (shutdownError) {
      logger.error("Error during shutdown cleanup:", shutdownError);
      process.exit(1);
    }
  });

  setTimeout(() => {
    logger.error("Forced shutdown due to 10s timeout.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

export default app;
