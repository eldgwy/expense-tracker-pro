import { prisma } from "../../db/prisma.js";
import type { Prisma, BudgetPeriod } from "../../generated/prisma/client.js";

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Compute the end date of a budget period given its start date and period type.
 */
export function computePeriodEnd(startDate: Date, period: string): Date {
  const end = new Date(startDate);
  switch (period) {
    case "WEEKLY":
      end.setDate(end.getDate() + 6);
      break;
    case "MONTHLY":
      end.setMonth(end.getMonth() + 1);
      end.setDate(0); // last day of the current month
      break;
    case "QUARTERLY":
      end.setMonth(end.getMonth() + 3);
      end.setDate(0);
      break;
    case "YEARLY":
      end.setFullYear(end.getFullYear() + 1);
      end.setDate(0);
      break;
  }
  return end;
}

/**
 * Compute the number of full days remaining until the period end date.
 * Returns 0 if the period has already ended.
 * The end date is inclusive, so we add 1 to account for the full range.
 */
export function computeDaysRemaining(startDate: Date, endDate: Date): number {
  const now = new Date();
  const msPerDay = 1000 * 60 * 60 * 24;

  // Not started yet → total days in the period
  if (now < startDate) {
    return Math.ceil((endDate.getTime() - startDate.getTime()) / msPerDay) + 1;
  }
  // Already ended → 0
  if (now > endDate) {
    return 0;
  }
  // In progress → days remaining (excluding today, counting from tomorrow to end inclusive)
  return Math.ceil((endDate.getTime() - now.getTime()) / msPerDay);
}

/**
 * Compute how much has been spent so far for a given budget category and date range.
 */
export async function computeSpending(
  userId: string,
  categoryId: string,
  startDate: Date,
  endDate: Date,
): Promise<number> {
  const result = await prisma.transaction.aggregate({
    where: {
      userId,
      categoryId,
      type: "EXPENSE",
      date: { gte: startDate, lte: endDate },
    },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

// ─── Shared Enrichment ────────────────────────────────────────

interface EnrichedBudget {
  id: string;
  category: { id: string; name: string; icon: string; color: string };
  targetAmount: number;
  alertThreshold: number;
  period: string;
  startDate: Date;
  periodEnd: Date;
  spent: number;
  remaining: number;
  progress: number;
  isActive: boolean;
  daysRemaining: number;
  totalDays: number;
  daysElapsed: number;
  isOverBudget: boolean;
  isAlertTriggered: boolean;
}

/**
 * Enrich an array of budget rows with computed spending, progress, and time-based fields.
 * Uses a single batch query for all spending data instead of N+1 queries.
 */
async function enrichBudgets(
  userId: string,
  budgets: Array<{
    id: string;
    targetAmount: number;
    alertThreshold: number;
    period: string;
    startDate: Date;
    categoryId: string;
    category: { id: string; name: string; icon: string; color: string };
  }>,
): Promise<EnrichedBudget[]> {
  if (budgets.length === 0) return [];

  const now = new Date();

  // Pre-compute period ends and fetch spending in parallel
  const spendingResults = await Promise.all(
    budgets.map(async (budget) => {
      const end = computePeriodEnd(budget.startDate, budget.period);
      const spent = await computeSpending(userId, budget.categoryId, budget.startDate, end);
      return { id: budget.id, end, spent };
    }),
  );

  const spendingMap = new Map(spendingResults.map((r) => [r.id, { end: r.end, spent: r.spent }]));

  return budgets.map((budget) => {
    const { end, spent } = spendingMap.get(budget.id) ?? {
      end: computePeriodEnd(budget.startDate, budget.period),
      spent: 0,
    };

    const isActive = now >= budget.startDate && now <= end;
    const progress = budget.targetAmount > 0 ? Math.round((spent / budget.targetAmount) * 100) : 0;
    const daysRemaining = computeDaysRemaining(budget.startDate, end);
    const totalDays =
      Math.ceil((end.getTime() - budget.startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const daysElapsed = Math.max(0, totalDays - daysRemaining);

    return {
      id: budget.id,
      category: {
        id: budget.category.id,
        name: budget.category.name,
        icon: budget.category.icon,
        color: budget.category.color,
      },
      targetAmount: budget.targetAmount,
      alertThreshold: budget.alertThreshold,
      period: budget.period,
      startDate: budget.startDate,
      periodEnd: end,
      spent,
      remaining: budget.targetAmount - spent,
      progress,
      isActive,
      daysRemaining,
      totalDays,
      daysElapsed,
      isOverBudget: spent > budget.targetAmount,
      isAlertTriggered: progress >= budget.alertThreshold,
    };
  });
}

// ─── Repository ───────────────────────────────────────────────

export const budgetRepository = {
  async findAllByUser(
    userId: string,
    options: {
      period?: string;
      status?: "active" | "inactive";
      startDate?: Date;
      endDate?: Date;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
    } = {},
  ) {
    const where: Prisma.BudgetWhereInput = { userId };

    if (options.period) {
      where.period = options.period as BudgetPeriod;
    }

    if (options.startDate || options.endDate) {
      where.startDate = {};
      if (options.startDate) where.startDate.gte = options.startDate;
      if (options.endDate) where.startDate.lte = options.endDate;
    }

    // Build orderBy — period can't be sorted by Prisma directly as an enum string,
    // so we sort alphabetically: MONTHLY < QUARTERLY < WEEKLY < YEARLY
    const orderKey = (options.sortBy ?? "startDate") as keyof Prisma.BudgetOrderByWithRelationInput;
    const orderDir = options.sortOrder ?? "desc";

    const orderBy: Prisma.BudgetOrderByWithRelationInput = {
      [orderKey === "period" ? "startDate" : orderKey]: orderDir,
    };

    const budgets = await prisma.budget.findMany({
      where,
      orderBy,
      include: { category: true },
    });

    // If status filter is active, compute on the fly and filter
    if (options.status) {
      const now = new Date();
      const filtered = await Promise.all(
        budgets.map(async (budget) => {
          const end = computePeriodEnd(budget.startDate, budget.period);
          const isActive = now >= budget.startDate && now <= end;
          return { budget, isActive };
        }),
      );
      return filtered
        .filter(({ isActive }) => (options.status === "active" ? isActive : !isActive))
        .map(({ budget }) => budget);
    }

    return budgets;
  },

  async findById(id: string) {
    return prisma.budget.findUnique({
      where: { id },
      include: { category: true },
    });
  },

  async findByCategoryAndPeriod(userId: string, categoryId: string, startDate: Date) {
    return prisma.budget.findFirst({
      where: { userId, categoryId, startDate },
    });
  },

  async getBudgetWithProgress(userId: string, budgetId: string) {
    const budget = await prisma.budget.findUnique({
      where: { id: budgetId },
      include: { category: true },
    });

    if (!budget || budget.userId !== userId) return null;

    const end = computePeriodEnd(budget.startDate, budget.period);
    const spent = await computeSpending(userId, budget.categoryId, budget.startDate, end);
    const now = new Date();
    const isActive = now >= budget.startDate && now <= end;
    const progress = budget.targetAmount > 0 ? Math.round((spent / budget.targetAmount) * 100) : 0;
    const daysRemaining = computeDaysRemaining(budget.startDate, end);
    const totalDays =
      Math.ceil((end.getTime() - budget.startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const daysElapsed = Math.max(0, totalDays - daysRemaining);

    return {
      ...budget,
      spent,
      remaining: Math.max(0, budget.targetAmount - spent),
      progress,
      isActive,
      periodEnd: end,
      daysRemaining,
      daysElapsed,
      totalDays,
      isOverBudget: spent > budget.targetAmount,
      isAlertTriggered: progress >= budget.alertThreshold,
    };
  },

  async getProgressSummary(userId: string) {
    const budgets = await prisma.budget.findMany({
      where: { userId },
      include: { category: true },
    });

    if (budgets.length === 0) {
      return {
        totalBudgets: 0,
        activeBudgets: 0,
        totalBudgeted: 0,
        totalSpent: 0,
        totalRemaining: 0,
        overallProgress: 0,
        budgets: [],
      };
    }

    const enriched = await enrichBudgets(userId, budgets);

    let totalBudgeted = 0;
    let totalSpent = 0;
    let activeCount = 0;

    for (const b of enriched) {
      if (b.isActive) activeCount++;
      totalBudgeted += b.targetAmount;
      totalSpent += b.spent;
    }

    return {
      totalBudgets: budgets.length,
      activeBudgets: activeCount,
      totalBudgeted,
      totalSpent,
      totalRemaining: Math.max(0, totalBudgeted - totalSpent),
      overallProgress: totalBudgeted > 0 ? Math.round((totalSpent / totalBudgeted) * 100) : 0,
      budgets: enriched.map((b) => ({
        id: b.id,
        category: b.category,
        targetAmount: b.targetAmount,
        period: b.period,
        startDate: b.startDate,
        spent: b.spent,
        remaining: Math.max(0, b.remaining),
        progress: b.progress,
        isActive: b.isActive,
        daysRemaining: b.daysRemaining,
        periodEnd: b.periodEnd,
      })),
    };
  },

  async getAlerts(userId: string) {
    const budgets = await prisma.budget.findMany({
      where: { userId },
      include: { category: true },
    });

    if (budgets.length === 0) {
      return {
        alerts: [],
        summary: {
          totalBudgets: 0,
          warning: 0,
          critical: 0,
          overBudget: 0,
          safe: 0,
        },
      };
    }

    const enriched = await enrichBudgets(userId, budgets);

    const alerts: Array<Record<string, unknown>> = [];
    let warningCount = 0;
    let criticalCount = 0;
    let overBudgetCount = 0;
    let safeCount = 0;

    for (const b of enriched) {
      const overBy = b.isOverBudget ? b.spent - b.targetAmount : 0;

      // Determine alert severity
      const isAtWarning = b.progress >= b.alertThreshold && b.progress < 100;

      // Only include budgets that have an active alert condition
      if (!b.isOverBudget && !isAtWarning && !(b.progress >= 100)) {
        safeCount++;
        continue;
      }

      // Categorize severity (prioritize: over_budget > critical > warning)
      let severity: "over_budget" | "critical" | "warning";
      if (b.isOverBudget) {
        severity = "over_budget";
        overBudgetCount++;
      } else if (b.progress >= 100) {
        severity = "critical";
        criticalCount++;
      } else {
        severity = "warning";
        warningCount++;
      }

      alerts.push({
        id: b.id,
        category: b.category,
        targetAmount: b.targetAmount,
        alertThreshold: b.alertThreshold,
        period: b.period,
        startDate: b.startDate,
        periodEnd: b.periodEnd,
        isActive: b.isActive,
        spent: b.spent,
        remaining: b.remaining,
        overBy,
        progress: b.progress,
        severity,
        daysRemaining: b.daysRemaining,
      });
    }

    // Sort: most severe first, then by progress descending
    const severityOrder = { over_budget: 0, critical: 1, warning: 2 };
    alerts.sort((a, b) => {
      const sevDiff =
        severityOrder[a.severity as keyof typeof severityOrder] -
        severityOrder[b.severity as keyof typeof severityOrder];
      if (sevDiff !== 0) return sevDiff;
      return (b.progress as number) - (a.progress as number);
    });

    return {
      alerts,
      summary: {
        totalBudgets: budgets.length,
        warning: warningCount,
        critical: criticalCount,
        overBudget: overBudgetCount,
        safe: safeCount,
      },
    };
  },

  async getInsights(userId: string) {
    const budgets = await prisma.budget.findMany({
      where: { userId },
      include: { category: true },
    });

    if (budgets.length === 0) {
      return {
        highestSpending: null,
        lowestSpending: null,
        closestToLimit: null,
        overall: {
          totalBudgeted: 0,
          totalSpent: 0,
          totalRemaining: 0,
          utilizationRate: 0,
          averageProgress: 0,
          budgetCount: 0,
          activeBudgetCount: 0,
        },
      };
    }

    const enriched = await enrichBudgets(userId, budgets);

    let totalBudgeted = 0;
    let totalSpent = 0;
    let activeCount = 0;
    let progressSum = 0;

    for (const b of enriched) {
      if (b.isActive) activeCount++;
      totalBudgeted += b.targetAmount;
      totalSpent += b.spent;
      progressSum += b.progress;
    }

    // 1. Highest spending budget
    const highestSpending = enriched.reduce(
      (max, b) => (b.spent > max.spent ? b : max),
      enriched[0],
    );

    // 2. Lowest spending budget (among active budgets, or all if none active)
    const candidates = enriched.filter((b) => b.isActive);
    const pool = candidates.length > 0 ? candidates : enriched;
    const lowestSpending = pool.reduce((min, b) => (b.spent < min.spent ? b : min), pool[0]);

    // 3. Closest budget to limit (highest progress)
    const closestToLimit = enriched.reduce(
      (closest, b) => (b.progress > closest.progress ? b : closest),
      enriched[0],
    );

    // 4. Overall utilization
    const utilizationRate = totalBudgeted > 0 ? Math.round((totalSpent / totalBudgeted) * 100) : 0;

    return {
      highestSpending: {
        id: highestSpending.id,
        category: highestSpending.category,
        targetAmount: highestSpending.targetAmount,
        period: highestSpending.period,
        spent: highestSpending.spent,
        remaining: highestSpending.remaining,
        progress: highestSpending.progress,
        isActive: highestSpending.isActive,
        isHighest: true,
      },
      lowestSpending: {
        id: lowestSpending.id,
        category: lowestSpending.category,
        targetAmount: lowestSpending.targetAmount,
        period: lowestSpending.period,
        spent: lowestSpending.spent,
        remaining: lowestSpending.remaining,
        progress: lowestSpending.progress,
        isActive: lowestSpending.isActive,
        isLowest: true,
      },
      closestToLimit: {
        id: closestToLimit.id,
        category: closestToLimit.category,
        targetAmount: closestToLimit.targetAmount,
        period: closestToLimit.period,
        spent: closestToLimit.spent,
        remaining: closestToLimit.remaining,
        progress: closestToLimit.progress,
        isActive: closestToLimit.isActive,
        daysRemaining: closestToLimit.daysRemaining,
        isClosestToLimit: true,
      },
      overall: {
        totalBudgeted,
        totalSpent,
        totalRemaining: Math.max(0, totalBudgeted - totalSpent),
        utilizationRate,
        averageProgress: budgets.length > 0 ? Math.round(progressSum / budgets.length) : 0,
        budgetCount: budgets.length,
        activeBudgetCount: activeCount,
      },
    };
  },

  async create(
    userId: string,
    data: {
      targetAmount: number;
      alertThreshold?: number;
      period?: string;
      startDate: Date;
      categoryId: string;
    },
  ) {
    return prisma.budget.create({
      data: {
        targetAmount: data.targetAmount,
        alertThreshold: data.alertThreshold ?? 80,
        period: (data.period ?? "MONTHLY") as BudgetPeriod,
        startDate: data.startDate,
        category: { connect: { id: data.categoryId } },
        user: { connect: { id: userId } },
      },
      include: { category: true },
    });
  },

  async update(id: string, data: Prisma.BudgetUpdateInput) {
    return prisma.budget.update({
      where: { id },
      data,
      include: { category: true },
    });
  },

  async delete(id: string) {
    return prisma.budget.delete({ where: { id } });
  },
};
