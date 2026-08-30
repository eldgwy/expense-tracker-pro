import { Router } from "express";
import { dashboardController } from "./dashboard.controller.js";
import { asyncHandler } from "../../common/middleware/index.js";
import { authMiddleware } from "../../common/middleware/auth.js";

const router: Router = Router();

router.get("/overview", authMiddleware, asyncHandler(dashboardController.getOverview));
router.get(
  "/income-expense-chart",
  authMiddleware,
  asyncHandler(dashboardController.getIncomeExpenseChart),
);
router.get(
  "/category-distribution",
  authMiddleware,
  asyncHandler(dashboardController.getCategoryDistribution),
);
router.get(
  "/monthly-expenses",
  authMiddleware,
  asyncHandler(dashboardController.getMonthlyExpenses),
);
router.get("/budget-usage", authMiddleware, asyncHandler(dashboardController.getBudgetUsage));
router.get("/cash-flow", authMiddleware, asyncHandler(dashboardController.getCashFlow));

export { router as dashboardRoutes };
