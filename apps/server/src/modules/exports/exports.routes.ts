import { Router } from "express";
import { exportController } from "./exports.controller.js";
import { validate, asyncHandler } from "../../common/middleware/index.js";
import { exportTransactionsQuerySchema, exportReportQuerySchema } from "./exports.validation.js";
import { authMiddleware } from "../../common/middleware/auth.js";

const router: Router = Router();

router.get(
  "/transactions",
  validate(exportTransactionsQuerySchema, "query"),
  authMiddleware,
  asyncHandler(exportController.exportTransactions),
);

router.get(
  "/reports",
  validate(exportReportQuerySchema, "query"),
  authMiddleware,
  asyncHandler(exportController.exportReport),
);

export { router as exportRoutes };
