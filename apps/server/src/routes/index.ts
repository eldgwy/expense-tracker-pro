import { Router } from "express";
import { authLimiter } from "../config/rate-limit.js";
import { authRoutes } from "../modules/auth/auth.routes.js";
import { userRoutes } from "../modules/users/users.routes.js";
import { categoryRoutes } from "../modules/categories/categories.routes.js";
import { transactionRoutes } from "../modules/transactions/transactions.routes.js";
import { budgetRoutes } from "../modules/budgets/budgets.routes.js";
import { paymentMethodRoutes } from "../modules/payment-methods/payment-methods.routes.js";
import { savingsGoalRoutes } from "../modules/savings-goals/savings-goals.routes.js";
import { reportRoutes } from "../modules/reports/reports.routes.js";
import { dashboardRoutes } from "../modules/dashboard/dashboard.routes.js";
import { notificationRoutes } from "../modules/notifications/notifications.routes.js";
import { exportRoutes } from "../modules/exports/exports.routes.js";
import { searchRoutes } from "../modules/search/search.routes.js";
import { reminderRoutes } from "../modules/reminders/reminders.routes.js";
import { jobsRoutes } from "../modules/jobs/jobs.routes.js";

const router: Router = Router();

// Stricter rate limit for auth endpoints (brute-force protection).
router.use("/auth", authLimiter, authRoutes);
router.use("/users", userRoutes);
router.use("/categories", categoryRoutes);
router.use("/transactions", transactionRoutes);
router.use("/budgets", budgetRoutes);
router.use("/payment-methods", paymentMethodRoutes);
router.use("/savings-goals", savingsGoalRoutes);
router.use("/reports", reportRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/notifications", notificationRoutes);
router.use("/exports", exportRoutes);

// ─── Global Search ───────────────────────────────────────────
router.use("/search", searchRoutes);

// ─── Recurring Reminders ──────────────────────────────────────
router.use("/reminders", reminderRoutes);

// ─── Background Jobs ──────────────────────────────────────────
router.use("/jobs", jobsRoutes);

export { router as routes };
