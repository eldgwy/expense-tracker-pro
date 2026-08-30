import { Router } from "express";
import { savingsGoalController } from "./savings-goals.controller.js";
import { validate, asyncHandler } from "../../common/middleware/index.js";
import {
  createSavingsGoalSchema,
  updateSavingsGoalSchema,
  savingsGoalQuerySchema,
  addProgressSchema,
  withdrawProgressSchema,
} from "./savings-goals.validation.js";
import { uuidParamSchema } from "../../common/validators/index.js";
import { authMiddleware } from "../../common/middleware/auth.js";

const router: Router = Router();

router.get(
  "/",
  validate(savingsGoalQuerySchema, "query"),
  authMiddleware,
  asyncHandler(savingsGoalController.findAll),
);
router.get("/insights", authMiddleware, asyncHandler(savingsGoalController.getInsights));
router.get("/stats", authMiddleware, asyncHandler(savingsGoalController.getStats));
router.get(
  "/:id",
  validate(uuidParamSchema, "params"),
  authMiddleware,
  asyncHandler(savingsGoalController.findById),
);
router.post(
  "/",
  validate(createSavingsGoalSchema),
  authMiddleware,
  asyncHandler(savingsGoalController.create),
);
router.patch(
  "/:id",
  validate(uuidParamSchema, "params"),
  validate(updateSavingsGoalSchema),
  authMiddleware,
  asyncHandler(savingsGoalController.update),
);
router.delete(
  "/:id",
  validate(uuidParamSchema, "params"),
  authMiddleware,
  asyncHandler(savingsGoalController.delete),
);
router.post(
  "/:id/progress",
  validate(uuidParamSchema, "params"),
  validate(addProgressSchema),
  authMiddleware,
  asyncHandler(savingsGoalController.addProgress),
);
router.post(
  "/:id/progress/withdraw",
  validate(uuidParamSchema, "params"),
  validate(withdrawProgressSchema),
  authMiddleware,
  asyncHandler(savingsGoalController.withdrawProgress),
);

export { router as savingsGoalRoutes };
