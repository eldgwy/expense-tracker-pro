import { Router } from "express";
import { reportController } from "./reports.controller.js";
import { validate, asyncHandler } from "../../common/middleware/index.js";
import { authMiddleware } from "../../common/middleware/auth.js";
import {
  categorySummaryQuerySchema,
  monthlyTrendQuerySchema,
  dailyReportQuerySchema,
  weeklyReportQuerySchema,
  monthlyReportQuerySchema,
  yearlyReportQuerySchema,
  customReportQuerySchema,
  reportSummaryQuerySchema,
  reportBreakdownQuerySchema,
} from "./reports.validation.js";

const router: Router = Router();

router.get(
  "/breakdown",
  validate(reportBreakdownQuerySchema, "query"),
  authMiddleware,
  asyncHandler(reportController.getBreakdown),
);
router.get(
  "/summary",
  validate(reportSummaryQuerySchema, "query"),
  authMiddleware,
  asyncHandler(reportController.getSummary),
);
router.get(
  "/custom",
  validate(customReportQuerySchema, "query"),
  authMiddleware,
  asyncHandler(reportController.getCustomReport),
);
router.get(
  "/daily",
  validate(dailyReportQuerySchema, "query"),
  authMiddleware,
  asyncHandler(reportController.getDailyReport),
);
router.get(
  "/weekly",
  validate(weeklyReportQuerySchema, "query"),
  authMiddleware,
  asyncHandler(reportController.getWeeklyReport),
);
router.get(
  "/monthly",
  validate(monthlyReportQuerySchema, "query"),
  authMiddleware,
  asyncHandler(reportController.getMonthlyReport),
);
router.get(
  "/yearly",
  validate(yearlyReportQuerySchema, "query"),
  authMiddleware,
  asyncHandler(reportController.getYearlyReport),
);
router.get(
  "/category-summary",
  validate(categorySummaryQuerySchema, "query"),
  authMiddleware,
  asyncHandler(reportController.getCategorySummary),
);
router.get(
  "/monthly-trend",
  validate(monthlyTrendQuerySchema, "query"),
  authMiddleware,
  asyncHandler(reportController.getMonthlyTrend),
);

export { router as reportRoutes };
