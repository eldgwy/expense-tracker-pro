import type { Response, NextFunction, Request } from "express";
import { jobsService } from "./jobs.service.js";
import { sendSuccess } from "../../common/responses/index.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import { env } from "../../config/env.js";
import type { JobName } from "./jobs.types.js";

/**
 * Guard for the manual-run endpoints. A JOBS_TRIGGER_TOKEN must be configured
 * and supplied via the `x-jobs-token` header — prevents arbitrary users from
 * triggering system-wide jobs.
 */
function requireJobsToken(req: Request): void {
  const token = env.JOBS_TRIGGER_TOKEN;
  if (!token) {
    throw new UnauthorizedError("JOBS_TRIGGER_TOKEN is not configured on this server");
  }
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  const supplied =
    (req.headers["x-jobs-token"] as string | undefined) ??
    bearerToken ??
    (req.query.token as string | undefined);

  if (supplied !== token) {
    throw new UnauthorizedError("Invalid jobs trigger token");
  }
}

export const jobsController = {
  /**
   * POST /api/v1/jobs/run-all
   * Runs every background job (budgets, reminders, bills, monthly summaries).
   */
  async runAll(req: Request, res: Response, next: NextFunction) {
    try {
      requireJobsToken(req);
      const result = await jobsService.runAll();
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/jobs/run/:name
   * Runs a single background job by name.
   */
  async runOne(req: Request, res: Response, next: NextFunction) {
    try {
      requireJobsToken(req);
      const name = req.params.name as JobName;
      // Query values are validated & coerced by runJobQuerySchema middleware.
      const { windowDays, year, month, retentionDays } = req.query as Record<
        string,
        number | undefined
      >;

      const result = await jobsService.run(name, {
        windowDays,
        year,
        month,
        retentionDays,
      });
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  },
};
