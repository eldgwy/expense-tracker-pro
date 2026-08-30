import type { Response, NextFunction } from "express";
import { dashboardService } from "./dashboard.service.js";
import { sendSuccess } from "../../common/responses/index.js";
import { computeDateRange } from "../../common/utils/index.js";
import type { AuthenticatedRequest, DateRangePreset } from "../../common/types/index.js";

/**
 * Parse date range filter from query params into startDate/endDate Date objects.
 */
function parseDateFilter(req: AuthenticatedRequest): {
  startDate?: Date;
  endDate?: Date;
} | null {
  const range = req.query.range as string | undefined;
  if (!range && !req.query.startDate && !req.query.endDate) return null;

  const preset = (range as DateRangePreset) || "this_month";
  const startStr = req.query.startDate as string | undefined;
  const endStr = req.query.endDate as string | undefined;

  const computed = computeDateRange(preset, startStr, endStr);
  return { startDate: computed.startDate, endDate: computed.endDate };
}

export const dashboardController = {
  async getOverview(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const overview = await dashboardService.getOverview(req.user.id);
      sendSuccess(res, { overview });
    } catch (err) {
      next(err);
    }
  },

  async getIncomeExpenseChart(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const months = req.query.months ? parseInt(req.query.months as string, 10) : 12;
      const period = (req.query.period as string) ?? "monthly";
      const dateRange = parseDateFilter(req);
      const result = await dashboardService.getIncomeExpenseChart(req.user.id, {
        months: dateRange ? undefined : Math.min(Math.max(months, 1), 60),
        period,
        dateRange: dateRange ?? undefined,
      });
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  },

  async getCategoryDistribution(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const months = req.query.months ? parseInt(req.query.months as string, 10) : 0;
      const dateRange = parseDateFilter(req);
      const result = await dashboardService.getCategoryDistribution(req.user.id, {
        months: dateRange ? undefined : months > 0 ? Math.min(Math.max(months, 1), 60) : undefined,
        dateRange: dateRange ?? undefined,
      });
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  },

  async getMonthlyExpenses(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const months = req.query.months ? parseInt(req.query.months as string, 10) : 12;
      const dateRange = parseDateFilter(req);
      const result = await dashboardService.getMonthlyExpenses(req.user.id, {
        months: dateRange ? undefined : Math.min(Math.max(months, 1), 60),
        dateRange: dateRange ?? undefined,
      });
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  },

  async getBudgetUsage(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const month = req.query.month as string | undefined;
      const result = await dashboardService.getBudgetUsage(req.user.id, {
        month: month && /^\d{4}-\d{2}$/.test(month) ? month : undefined,
      });
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  },

  async getCashFlow(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const months = req.query.months ? parseInt(req.query.months as string, 10) : 12;
      const dateRange = parseDateFilter(req);
      const result = await dashboardService.getCashFlow(req.user.id, {
        months: dateRange ? undefined : Math.min(Math.max(months, 1), 60),
        dateRange: dateRange ?? undefined,
      });
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  },
};
