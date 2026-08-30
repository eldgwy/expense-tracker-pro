import type { Response, NextFunction } from "express";
import { reminderService } from "./reminders.service.js";
import { sendSuccess, sendCreated, sendNoContent } from "../../common/responses/index.js";
import type { AuthenticatedRequest } from "../../common/types/index.js";
import type { ReminderQueryFilters } from "./reminders.types.js";

export const reminderController = {
  async findAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { type, frequency, enabled, sortBy, sortOrder } = req.query as Record<
        string,
        string | undefined
      >;

      const filters: ReminderQueryFilters = {
        type: type as ReminderQueryFilters["type"],
        frequency: frequency as ReminderQueryFilters["frequency"],
        enabled: enabled === undefined ? undefined : enabled === "true",
        sortBy: sortBy as ReminderQueryFilters["sortBy"],
        sortOrder: sortOrder as "asc" | "desc" | undefined,
      };

      const reminders = await reminderService.findAll(req.user.id, filters);
      sendSuccess(res, { reminders });
    } catch (err) {
      next(err);
    }
  },

  async findById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const reminder = await reminderService.findById(req.user.id, req.params.id as string);
      sendSuccess(res, { reminder });
    } catch (err) {
      next(err);
    }
  },

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const reminder = await reminderService.create(req.user.id, req.body);
      sendCreated(res, { reminder });
    } catch (err) {
      next(err);
    }
  },

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const reminder = await reminderService.update(req.user.id, req.params.id as string, req.body);
      sendSuccess(res, { reminder });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await reminderService.delete(req.user.id, req.params.id as string);
      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  },

  async triggerDue(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await reminderService.triggerDue(req.user.id);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  },
};
