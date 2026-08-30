import { prisma } from "../../db/prisma.js";
import { reportService } from "../reports/reports.service.js";
import { notificationRepository } from "./notifications.repository.js";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Format a value as a $ string with thousands separators. */
function fmt(amount: number): string {
  return `$${Number(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Compute the summary for a given month (year + month where month is 1-12).
 * Reuses the reports module for income/expense/net totals AND the per-budget
 * performance array, then adds the top spending category and largest transaction.
 */
async function computeSummary(userId: string, year: number, month: number) {
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

  const [report, topCategoryGroup, largestTransaction, userCategories] = await Promise.all([
    // Provides income, expenses, netSavings, transactionCount and budgetPerformance
    reportService.getMonthlyReport(userId, year, month),
    prisma.transaction.groupBy({
      where: { userId, type: "EXPENSE", date: { gte: startOfMonth, lte: endOfMonth } },
      by: ["categoryId"],
      _sum: { amount: true },
      _count: true,
      orderBy: { _sum: { amount: "desc" } },
      take: 1,
    }),
    prisma.transaction.findFirst({
      where: { userId, date: { gte: startOfMonth, lte: endOfMonth } },
      orderBy: { amount: "desc" },
      include: { category: true },
    }),
    prisma.category.findMany({
      where: { userId },
      select: { id: true, name: true, icon: true, color: true },
    }),
  ]);

  // ─── Top spending category (expense-only aggregation) ───
  const categoryLookup = new Map(userCategories.map((c) => [c.id, c]));
  let topCategory: Record<string, unknown> | null = null;
  if (topCategoryGroup.length > 0) {
    const g = topCategoryGroup[0];
    const cat = categoryLookup.get(g.categoryId);
    topCategory = {
      categoryId: g.categoryId,
      categoryName: cat?.name ?? "Unknown",
      categoryIcon: cat?.icon ?? "Tag",
      categoryColor: cat?.color ?? "#6366F1",
      totalSpent: g._sum.amount ?? 0,
      transactionCount: g._count,
      percentage:
        report.expenses > 0 ? Math.round(((g._sum.amount ?? 0) / report.expenses) * 100) : 0,
    };
  }

  // ─── Budget performance (already computed by the reports module) ───
  const budgetPerformance = report.budgetPerformance;

  const totalBudgeted = budgetPerformance.reduce((sum, b) => sum + b.budgeted, 0);
  const totalBudgetSpent = budgetPerformance.reduce((sum, b) => sum + b.spent, 0);
  const onTrackCount = budgetPerformance.filter((b) => b.status === "on_track").length;
  const warningCount = budgetPerformance.filter((b) => b.status === "warning").length;
  const criticalCount = budgetPerformance.filter((b) => b.status === "critical").length;

  // ─── Largest transaction ───
  let largestTxn: Record<string, unknown> | null = null;
  if (largestTransaction) {
    largestTxn = {
      id: largestTransaction.id,
      amount: largestTransaction.amount,
      description: largestTransaction.description,
      type: largestTransaction.type,
      date: largestTransaction.date,
      categoryId: largestTransaction.categoryId,
      categoryName: largestTransaction.category?.name ?? "Unknown",
      categoryIcon: largestTransaction.category?.icon ?? "Tag",
      categoryColor: largestTransaction.category?.color ?? "#6366F1",
    };
  }

  return {
    year,
    month,
    label: `${MONTH_NAMES[month - 1]} ${year}`,
    totalIncome: report.income,
    totalExpenses: report.expenses,
    netSavings: report.netSavings,
    transactionCount: report.transactionCount,
    topCategory,
    budgetPerformance: {
      budgets: budgetPerformance,
      totalBudgeted,
      totalSpent: Math.round(totalBudgetSpent * 100) / 100,
      totalRemaining: Math.round((totalBudgeted - totalBudgetSpent) * 100) / 100,
      overallPercentage:
        totalBudgeted > 0 ? Math.round((totalBudgetSpent / totalBudgeted) * 100) : 0,
      onTrackCount,
      warningCount,
      criticalCount,
    },
    largestTransaction: largestTxn,
  };
}

/** Build a human-readable summary message for the notification body. */
function buildSummaryMessage(summary: Awaited<ReturnType<typeof computeSummary>>): string {
  const lines: string[] = [];
  lines.push(`Monthly Summary — ${summary.label}`);
  lines.push("");
  lines.push(`Income: ${fmt(summary.totalIncome)}`);
  lines.push(`Expenses: ${fmt(summary.totalExpenses)}`);
  lines.push(`Net savings: ${fmt(summary.netSavings)}`);
  if (summary.topCategory) {
    lines.push(
      `Top category: ${summary.topCategory.categoryName} (${fmt(summary.topCategory.totalSpent as number)})`,
    );
  }
  const bp = summary.budgetPerformance;
  lines.push(
    `Budgets: ${bp.budgets.length} tracked, ${bp.onTrackCount} on track, ${bp.warningCount} warning, ${bp.criticalCount} over`,
  );
  if (summary.largestTransaction) {
    lines.push(
      `Largest transaction: ${summary.largestTransaction.description} (${fmt(summary.largestTransaction.amount as number)})`,
    );
  }
  return lines.join("\n");
}

export const monthlySummaryService = {
  /**
   * Compute (but do not send) the monthly summary for a given month.
   * `month` is 1-12; defaults to the previous calendar month.
   */
  async getSummary(userId: string, year: number, month: number) {
    return computeSummary(userId, year, month);
  },

  /**
   * Generate a MONTHLY_SUMMARY notification for the given month.
   * Respects notification preferences (monthlySummary flag, global enabled
   * toggle, and the in-app channel) and de-duplicates within a 24h window.
   */
  async generate(userId: string, year: number, month: number) {
    const summary = await computeSummary(userId, year, month);

    const prefs = await notificationRepository.findPreferences(userId);
    const notificationsDisabled =
      prefs.enabled === false || prefs.channels?.inApp === false || prefs.monthlySummary === false;

    if (notificationsDisabled) {
      return {
        generated: 0,
        suppressedByPreferences: true,
        summary,
      };
    }

    // Dedup: only one monthly summary per 24h window (regardless of which
    // month is requested — mirrors the budget-alert dedup pattern).
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await notificationRepository.findRecentByTypes(
      userId,
      ["MONTHLY_SUMMARY"],
      since,
    );
    if (recent.length > 0) {
      return {
        generated: 0,
        deduplicated: true,
        summary,
      };
    }

    const notification = await notificationRepository.create(userId, {
      type: "MONTHLY_SUMMARY",
      title: `Monthly Summary — ${summary.label}`,
      message: buildSummaryMessage(summary),
    });

    return {
      generated: 1,
      suppressedByPreferences: false,
      notification,
      summary,
    };
  },
};
