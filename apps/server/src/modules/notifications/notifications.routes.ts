import { Router } from "express";
import { notificationController } from "./notifications.controller.js";
import { asyncHandler, validate } from "../../common/middleware/index.js";
import { uuidParamSchema } from "../../common/validators/index.js";
import { authMiddleware } from "../../common/middleware/auth.js";
import {
  updateNotificationPreferencesSchema,
  monthlySummaryQuerySchema,
  notificationQuerySchema,
  cleanupNotificationsSchema,
} from "./notifications.validation.js";

const router: Router = Router();

// ─── Preferences ────────────────────────────────────────────

router.get("/preferences", authMiddleware, asyncHandler(notificationController.getPreferences));

router.put(
  "/preferences",
  authMiddleware,
  validate(updateNotificationPreferencesSchema),
  asyncHandler(notificationController.updatePreferences),
);

// ─── Monthly Summary ────────────────────────────────────────

router.get(
  "/monthly-summary",
  validate(monthlySummaryQuerySchema, "query"),
  authMiddleware,
  asyncHandler(notificationController.getMonthlySummary),
);

router.post(
  "/monthly-summary/generate",
  validate(monthlySummaryQuerySchema, "query"),
  authMiddleware,
  asyncHandler(notificationController.generateMonthlySummary),
);

// ─── Notifications CRUD ────────────────────────────────────

router.get(
  "/",
  validate(notificationQuerySchema, "query"),
  authMiddleware,
  asyncHandler(notificationController.findAll),
);
router.post(
  "/cleanup",
  authMiddleware,
  validate(cleanupNotificationsSchema),
  asyncHandler(notificationController.cleanupExpired),
);
router.get("/unread", authMiddleware, asyncHandler(notificationController.findUnread));
router.get("/unread/count", authMiddleware, asyncHandler(notificationController.getUnreadCount));
router.get(
  "/:id",
  validate(uuidParamSchema, "params"),
  authMiddleware,
  asyncHandler(notificationController.findById),
);
router.patch(
  "/:id/read",
  validate(uuidParamSchema, "params"),
  authMiddleware,
  asyncHandler(notificationController.markAsRead),
);
router.patch("/read-all", authMiddleware, asyncHandler(notificationController.markAllAsRead));
router.delete(
  "/:id",
  validate(uuidParamSchema, "params"),
  authMiddleware,
  asyncHandler(notificationController.delete),
);

export { router as notificationRoutes };
