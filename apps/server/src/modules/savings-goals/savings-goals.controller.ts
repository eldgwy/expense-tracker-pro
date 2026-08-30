import type { Response, NextFunction } from "express";
import { savingsGoalService } from "./savings-goals.service.js";
import { sendSuccess, sendCreated, sendNoContent } from "../../common/responses/index.js";
import type { AuthenticatedRequest } from "../../common/types/index.js";
import type { SavingsGoalQueryFilters } from "./savings-goals.types.js";

export const savingsGoalController = {
  async findAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { status, priority, sortBy, sortOrder } = req.query as Record<
        string,
        string | undefined
      >;

      const filters: SavingsGoalQueryFilters = {
        status: status as "active" | "completed" | undefined,
        priority: priority as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | undefined,
        sortBy: sortBy as
          "deadline" | "targetAmount" | "priority" | "createdAt" | "currentAmount" | undefined,
        sortOrder: sortOrder as "asc" | "desc" | undefined,
      };

      const savingsGoals = await savingsGoalService.findAll(req.user.id, filters);
      sendSuccess(res, { savingsGoals });
    } catch (err) {
      next(err);
    }
  },

  async findById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const savingsGoal = await savingsGoalService.findById(req.user.id, req.params.id as string);
      sendSuccess(res, { savingsGoal });
    } catch (err) {
      next(err);
    }
  },

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const savingsGoal = await savingsGoalService.create(req.user.id, req.body);
      sendCreated(res, { savingsGoal });
    } catch (err) {
      next(err);
    }
  },

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const savingsGoal = await savingsGoalService.update(
        req.user.id,
        req.params.id as string,
        req.body,
      );
      sendSuccess(res, { savingsGoal });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await savingsGoalService.delete(req.user.id, req.params.id as string);
      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  },

  async addProgress(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { amount, allowExceed } = req.body;
      const savingsGoal = await savingsGoalService.addProgress(
        req.user.id,
        req.params.id as string,
        { amount, allowExceed },
      );
      sendSuccess(res, { savingsGoal });
    } catch (err) {
      next(err);
    }
  },

  async withdrawProgress(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { amount } = req.body;
      const savingsGoal = await savingsGoalService.withdrawProgress(
        req.user.id,
        req.params.id as string,
        amount,
      );
      sendSuccess(res, { savingsGoal });
    } catch (err) {
      next(err);
    }
  },

  async getStats(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const stats = await savingsGoalService.getStats(req.user.id);
      sendSuccess(res, { stats });
    } catch (err) {
      next(err);
    }
  },

  async getInsights(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const insights = await savingsGoalService.getInsights(req.user.id);
      sendSuccess(res, { insights });
    } catch (err) {
      next(err);
    }
  },
};
