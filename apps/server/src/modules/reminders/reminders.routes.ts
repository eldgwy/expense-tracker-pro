import { Router } from "express";
import { reminderController } from "./reminders.controller.js";
import { validate, asyncHandler } from "../../common/middleware/index.js";
import {
  createReminderSchema,
  updateReminderSchema,
  reminderQuerySchema,
} from "./reminders.validation.js";
import { uuidParamSchema } from "../../common/validators/index.js";
import { authMiddleware } from "../../common/middleware/auth.js";

const router: Router = Router();

// ─── Static routes (must come before :id routes) ────────
router.get(
  "/",
  validate(reminderQuerySchema, "query"),
  authMiddleware,
  asyncHandler(reminderController.findAll),
);
router.post("/trigger", authMiddleware, asyncHandler(reminderController.triggerDue));
router.get(
  "/:id",
  validate(uuidParamSchema, "params"),
  authMiddleware,
  asyncHandler(reminderController.findById),
);
router.post(
  "/",
  validate(createReminderSchema),
  authMiddleware,
  asyncHandler(reminderController.create),
);
router.patch(
  "/:id",
  validate(uuidParamSchema, "params"),
  validate(updateReminderSchema),
  authMiddleware,
  asyncHandler(reminderController.update),
);
router.delete(
  "/:id",
  validate(uuidParamSchema, "params"),
  authMiddleware,
  asyncHandler(reminderController.delete),
);

export { router as reminderRoutes };
