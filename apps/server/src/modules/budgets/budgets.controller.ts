import type { Response, NextFunction } from "express";
import { budgetService } from "./budgets.service.js";
import { sendSuccess, sendCreated, sendNoContent } from "../../common/responses/index.js";
import type { AuthenticatedRequest } from "../../common/types/index.js";
import type { BudgetQueryFilters } from "./budgets.types.js";

export const budgetController = {
  async findAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      // Query params are validated & parsed by the validate(budgetQuerySchema) middleware
      const { period, status, startDate, endDate, sortBy, sortOrder } = req.query as Record<
        string,
        string | undefined
      >;

      const filters: BudgetQueryFilters = {
        period,
        status: status as "active" | "inactive" | undefined,
        startDate,
        endDate,
        sortBy: sortBy as "startDate" | "targetAmount" | "period" | "createdAt" | undefined,
        sortOrder: sortOrder as "asc" | "desc" | undefined,
      };

      const budgets = await budgetService.findAll(req.user.id, filters);
      sendSuccess(res, { budgets });
    } catch (err) {
      next(err);
    }
  },

  async findById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const budget = await budgetService.findById(req.user.id, req.params.id as string);
      sendSuccess(res, { budget });
    } catch (err) {
      next(err);
    }
  },

  async getProgress(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const budgetWithProgress = await budgetService.getProgress(
        req.user.id,
        req.params.id as string,
      );
      sendSuccess(res, { budget: budgetWithProgress });
    } catch (err) {
      next(err);
    }
  },

  async getProgressSummary(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const summary = await budgetService.getProgressSummary(req.user.id);
      sendSuccess(res, summary);
    } catch (err) {
      next(err);
    }
  },

  async getAlerts(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const alerts = await budgetService.getAlerts(req.user.id);
      sendSuccess(res, alerts);
    } catch (err) {
      next(err);
    }
  },

  async generateAlerts(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await budgetService.generateAlerts(req.user.id);
      sendSuccess(res, result, 201);
    } catch (err) {
      next(err);
    }
  },

  async getInsights(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const insights = await budgetService.getInsights(req.user.id);
      sendSuccess(res, insights);
    } catch (err) {
      next(err);
    }
  },

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const budget = await budgetService.create(req.user.id, req.body);
      sendCreated(res, { budget });
    } catch (err) {
      next(err);
    }
  },

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const budget = await budgetService.update(req.user.id, req.params.id as string, req.body);
      sendSuccess(res, { budget });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await budgetService.delete(req.user.id, req.params.id as string);
      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  },
};
