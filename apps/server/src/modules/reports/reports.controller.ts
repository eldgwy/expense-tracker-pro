import type { Response, NextFunction } from "express";
import { reportService } from "./reports.service.js";
import { sendSuccess } from "../../common/responses/index.js";
import type { AuthenticatedRequest } from "../../common/types/index.js";

export const reportController = {
  async getCategorySummary(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const now = new Date();
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const startDate =
        (req.query.startDate as string) ?? firstDayOfMonth.toISOString().slice(0, 10);
      const endDate = (req.query.endDate as string) ?? now.toISOString().slice(0, 10);

      const result = await reportService.getCategorySummary(req.user.id, startDate, endDate);
      sendSuccess(res, { report: result });
    } catch (err) {
      next(err);
    }
  },

  async getMonthlyTrend(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
      const result = await reportService.getMonthlyTrend(req.user.id, year);
      sendSuccess(res, { report: result });
    } catch (err) {
      next(err);
    }
  },

  async getDailyReport(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const date = (req.query.date as string) ?? new Date().toISOString().slice(0, 10);
      const result = await reportService.getDailyReport(req.user.id, date);
      sendSuccess(res, { report: result });
    } catch (err) {
      next(err);
    }
  },

  async getWeeklyReport(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const date = (req.query.date as string) ?? new Date().toISOString().slice(0, 10);
      const result = await reportService.getWeeklyReport(req.user.id, date);
      sendSuccess(res, { report: result });
    } catch (err) {
      next(err);
    }
  },

  async getMonthlyReport(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const now = new Date();
      const year = req.query.year ? Number(req.query.year) : now.getFullYear();
      const month = req.query.month ? Number(req.query.month) : now.getMonth() + 1;
      const result = await reportService.getMonthlyReport(req.user.id, year, month);
      sendSuccess(res, { report: result });
    } catch (err) {
      next(err);
    }
  },

  async getYearlyReport(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
      const result = await reportService.getYearlyReport(req.user.id, year);
      sendSuccess(res, { report: result });
    } catch (err) {
      next(err);
    }
  },

  async getCustomReport(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { startDate, endDate, categoryId, paymentMethodId, type, minAmount, maxAmount } =
        req.query as Record<string, string | undefined>;

      const result = await reportService.getCustomReport(req.user.id, {
        startDate,
        endDate,
        categoryId,
        paymentMethodId,
        type: type as "INCOME" | "EXPENSE" | "TRANSFER" | undefined,
        minAmount: minAmount ? Number(minAmount) : undefined,
        maxAmount: maxAmount ? Number(maxAmount) : undefined,
      });
      sendSuccess(res, { report: result });
    } catch (err) {
      next(err);
    }
  },

  async getSummary(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const result = await reportService.getSummary(req.user.id, startDate, endDate);
      sendSuccess(res, { summary: result });
    } catch (err) {
      next(err);
    }
  },

  async getBreakdown(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const result = await reportService.getBreakdown(req.user.id, startDate, endDate);
      sendSuccess(res, { breakdown: result });
    } catch (err) {
      next(err);
    }
  },
};
