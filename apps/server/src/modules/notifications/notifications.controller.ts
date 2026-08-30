import type { Response, NextFunction } from "express";
import { notificationService } from "./notifications.service.js";
import { monthlySummaryService } from "./monthly-summary.service.js";
import { sendSuccess, sendNoContent, buildPaginationMeta } from "../../common/responses/index.js";
import type { AuthenticatedRequest } from "../../common/types/index.js";

/** Parse a YYYY-MM string into { year, month }. Returns null if malformed. */
function parseMonth(monthStr?: string): { year: number; month: number } {
  if (monthStr) {
    const [y, m] = monthStr.split("-").map(Number);
    if (m >= 1 && m <= 12) return { year: y, month: m };
  }
  // Default to the previous calendar month
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export const notificationController = {
  /**
   * GET /api/v1/notifications/preferences
   * Returns the authenticated user's notification preferences.
   */
  async getPreferences(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const preferences = await notificationService.getPreferences(req.user.id);
      sendSuccess(res, { preferences });
    } catch (err) {
      next(err);
    }
  },

  /**
   * PUT /api/v1/notifications/preferences
   * Updates the authenticated user's notification preferences (partial update).
   */
  async updatePreferences(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const preferences = await notificationService.updatePreferences(req.user.id, req.body);
      sendSuccess(res, { preferences });
    } catch (err) {
      next(err);
    }
  },

  async findAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      // Query params are validated & parsed by the validate(notificationQuerySchema) middleware
      const { page, limit, read, type } = req.query as Record<string, string | undefined>;

      const result = await notificationService.findAll(req.user.id, {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        read: read === undefined ? undefined : read === "true",
        type,
      });
      sendSuccess(
        res,
        { notifications: result.data },
        200,
        buildPaginationMeta(result.total, result.page, result.limit),
      );
    } catch (err) {
      next(err);
    }
  },

  async findById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const notification = await notificationService.findById(req.user.id, req.params.id as string);
      sendSuccess(res, { notification });
    } catch (err) {
      next(err);
    }
  },

  async findUnread(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const notifications = await notificationService.findUnread(req.user.id);
      sendSuccess(res, { notifications });
    } catch (err) {
      next(err);
    }
  },

  async getUnreadCount(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const count = await notificationService.getUnreadCount(req.user.id);
      sendSuccess(res, { count });
    } catch (err) {
      next(err);
    }
  },

  async markAsRead(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await notificationService.markAsRead(req.user.id, req.params.id as string);
      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  },

  async markAllAsRead(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await notificationService.markAllAsRead(req.user.id);
      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  },

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await notificationService.delete(req.user.id, req.params.id as string);
      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/notifications/cleanup
   * Deletes the user's expired notifications (read, older than olderThanDays).
   */
  async cleanupExpired(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { olderThanDays, readOnly } = req.body as {
        olderThanDays?: number;
        readOnly?: boolean;
      };
      const result = await notificationService.cleanupExpired(req.user.id, {
        olderThanDays,
        readOnly,
      });
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/notifications/monthly-summary?month=YYYY-MM
   * Returns the computed monthly summary without sending a notification.
   */
  async getMonthlySummary(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { year, month } = parseMonth(req.query.month as string | undefined);
      const summary = await monthlySummaryService.getSummary(req.user.id, year, month);
      sendSuccess(res, { summary });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/notifications/monthly-summary/generate?month=YYYY-MM
   * Computes the monthly summary and creates a MONTHLY_SUMMARY notification.
   */
  async generateMonthlySummary(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { year, month } = parseMonth(req.query.month as string | undefined);
      const result = await monthlySummaryService.generate(req.user.id, year, month);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  },
};
