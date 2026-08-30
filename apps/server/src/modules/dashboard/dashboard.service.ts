import { prisma } from "../../db/prisma.js";

export const dashboardService = {
  async getOverview(userId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    // ─── All queries run in a single parallel batch (12 queries, down from 16) ──
    // Optimizations:
    //   - Merged 6 income/expense aggregates into 3 groupBy by type
    //   - Merged 3 payment method queries into 1 groupBy
    //   - spendingByCategoryGroup reused for budget spending (eliminates duplicate query)

    const [
      // All-time income + expense (1 query vs 2)
      allTimeGroup,

      // Monthly income + expense (1 query vs 2)
      monthlyGroup,

      // Yearly income + expense (1 query vs 2)
      yearlyGroup,

      // Budgets with category include
      budgets,

      // Quick stats (5 queries—same count)
      avgAgg,
      categoryCount,
      paymentMethodCount,
      largestExpense,
      largestIncome,

      // Spending by category + user categories (2 queries)
      spendingByCategoryGroup,
      userCategories,

      // Payment method: merged into single groupBy (1 query vs 3)
      paymentMethodGroup,
      userPaymentMethods,

      // Recent transactions (1 query)
      recentTransactions,

      // Savings goals (1 query)
      savingsGoals,
    ] = await Promise.all([
      // ── All-time income + expense via groupBy ──
      prisma.transaction.groupBy({
        where: { userId },
        by: ["type"],
        _sum: { amount: true },
        _count: true,
      }),

      // ── Monthly income + expense via groupBy ──
      prisma.transaction.groupBy({
        where: { userId, date: { gte: startOfMonth, lte: now } },
        by: ["type"],
        _sum: { amount: true },
      }),

      // ── Yearly income + expense via groupBy ──
      prisma.transaction.groupBy({
        where: { userId, date: { gte: startOfYear, lte: now } },
        by: ["type"],
        _sum: { amount: true },
      }),

      // ── Budgets with category include ──
      prisma.budget.findMany({
        where: { userId },
        include: { category: true },
      }),

      // ── Average transaction amount + count ──
      prisma.transaction.aggregate({
        where: { userId },
        _avg: { amount: true },
        _count: true,
      }),

      // ── Category count ──
      prisma.category.count({ where: { userId } }),

      // ── Payment method count ──
      prisma.paymentMethod.count({ where: { userId } }),

      // ── Largest expense ──
      prisma.transaction.findFirst({
        where: { userId, type: "EXPENSE" },
        orderBy: { amount: "desc" },
        select: { amount: true },
      }),

      // ── Largest income ──
      prisma.transaction.findFirst({
        where: { userId, type: "INCOME" },
        orderBy: { amount: "desc" },
        select: { amount: true },
      }),

      // ── Spending by category: grouped expenses (also reused for budget spending) ──
      prisma.transaction.groupBy({
        where: { userId, type: "EXPENSE" },
        by: ["categoryId"],
        _sum: { amount: true },
        orderBy: { _sum: { amount: "desc" } },
      }),

      // ── User categories for name/color lookup ──
      prisma.category.findMany({ where: { userId } }),

      // ── Payment method: merged expense + income + count in single groupBy ──
      prisma.transaction.groupBy({
        where: { userId, paymentMethodId: { not: null } },
        by: ["paymentMethodId", "type"],
        _sum: { amount: true },
        _count: true,
      }),

      // ── User payment methods ──
      prisma.paymentMethod.findMany({ where: { userId } }),

      // ── Recent transactions (last 5) ──
      prisma.transaction.findMany({
        where: { userId },
        orderBy: { date: "desc" },
        take: 5,
        include: { category: true, paymentMethod: true },
      }),

      // ── Savings goals ──
      prisma.savingsGoal.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    // ─── Helper: extract sum from groupBy result by type ──
    const groupSum = (group: { type: string; _sum: { amount: number | null } }[], t: string) =>
      group.find((g) => g.type === t)?._sum.amount ?? 0;

    // ─── Compute all-time financial summary ──────────────────

    const totalIncome = groupSum(allTimeGroup, "INCOME");
    const totalExpense = groupSum(allTimeGroup, "EXPENSE");
    const netSavings = totalIncome - totalExpense;

    // ─── Monthly breakdown (already aggregated at DB level) ───

    const monthlyIncome = groupSum(monthlyGroup, "INCOME");
    const monthlyExpense = groupSum(monthlyGroup, "EXPENSE");

    // ─── Yearly breakdown (already aggregated at DB level) ────

    const yearlyIncome = groupSum(yearlyGroup, "INCOME");
    const yearlyExpense = groupSum(yearlyGroup, "EXPENSE");

    // ─── Budget Overview ─────────────────────────────────────

    // Build a map: categoryId → totalSpent
    const budgetSpendingMap = new Map<string, number>();
    // Reuse spendingByCategoryGroup (already fetched) — avoids a duplicate query
    for (const g of spendingByCategoryGroup) {
      budgetSpendingMap.set(g.categoryId, g._sum.amount ?? 0);
    }

    const budgetStatuses = budgets.map((budget) => {
      const spentAmount = budgetSpendingMap.get(budget.categoryId) ?? 0;
      return {
        categoryId: budget.categoryId,
        categoryName: budget.category.name,
        categoryColor: budget.category.color,
        budgeted: budget.targetAmount,
        spent: spentAmount,
        remaining: budget.targetAmount - spentAmount,
        percentage:
          budget.targetAmount > 0 ? Math.round((spentAmount / budget.targetAmount) * 100) : 0,
      };
    });

    // ─── Savings Goals Summary ───────────────────────────────

    const totalSaved = savingsGoals.reduce((sum, g) => sum + g.currentAmount, 0);
    const totalTarget = savingsGoals.reduce((sum, g) => sum + g.targetAmount, 0);

    // ─── Quick Statistics ────────────────────────────────────

    // transactionCount derived from avg aggregator's _count (eliminates redundant query)
    const transactionCount = avgAgg._count;
    const averageTransactionAmount = avgAgg._avg.amount ?? 0;

    // ─── Spending by Category ─────────────────────────────────

    const categoryMap = new Map(userCategories.map((c) => [c.id, c]));

    const spendingByCategory = spendingByCategoryGroup.map((group) => {
      const cat = categoryMap.get(group.categoryId);
      const totalSpent = group._sum.amount ?? 0;
      return {
        categoryId: group.categoryId,
        categoryName: cat?.name ?? "Unknown",
        categoryColor: cat?.color ?? "#6366F1",
        totalSpent,
        percentage: totalExpense > 0 ? Math.round((totalSpent / totalExpense) * 100) : 0,
      };
    });

    // ─── Spending by Payment Method ──────────────────────────

    const pmMap = new Map(userPaymentMethods.map((pm) => [pm.id, pm]));

    const pmStats = new Map<string, { totalExpense: number; totalIncome: number; count: number }>();

    // Single merged groupBy returns [paymentMethodId, type] — build map in one pass
    for (const g of paymentMethodGroup) {
      const id = g.paymentMethodId!;
      const prev = pmStats.get(id) ?? { totalExpense: 0, totalIncome: 0, count: 0 };
      prev.count += g._count;
      if (g.type === "EXPENSE") {
        prev.totalExpense = g._sum.amount ?? 0;
      } else if (g.type === "INCOME") {
        prev.totalIncome = g._sum.amount ?? 0;
      }
      pmStats.set(id, prev);
    }

    const spendingByPaymentMethod = Array.from(pmStats.entries())
      .map(([paymentMethodId, data]) => {
        const pm = pmMap.get(paymentMethodId);
        return {
          paymentMethodId,
          paymentMethodName: pm?.name ?? "Unknown",
          paymentMethodType: pm?.type ?? "OTHER",
          paymentMethodIcon: pm?.icon ?? "CreditCard",
          paymentMethodColor: pm?.color ?? "#6366F1",
          totalExpense: data.totalExpense,
          totalIncome: data.totalIncome,
          netAmount: data.totalIncome - data.totalExpense,
          transactionCount: data.count,
        };
      })
      .sort((a, b) => b.transactionCount - a.transactionCount);

    const mostUsedPaymentMethod =
      spendingByPaymentMethod.length > 0
        ? {
            paymentMethodId: spendingByPaymentMethod[0].paymentMethodId,
            paymentMethodName: spendingByPaymentMethod[0].paymentMethodName,
            paymentMethodIcon: spendingByPaymentMethod[0].paymentMethodIcon,
            paymentMethodColor: spendingByPaymentMethod[0].paymentMethodColor,
            transactionCount: spendingByPaymentMethod[0].transactionCount,
          }
        : null;

    return {
      // Financial summary (all-time)
      totalIncome,
      totalExpense,
      netSavings,
      totalBalance: netSavings,
      // Monthly breakdown
      monthlyIncome,
      monthlyExpense,
      monthlyNet: monthlyIncome - monthlyExpense,
      // Yearly breakdown
      yearlyIncome,
      yearlyExpense,
      yearlyNet: yearlyIncome - yearlyExpense,
      // Widgets
      budgetStatuses,
      recentTransactions,
      savingsSummary: {
        totalSaved,
        totalTarget,
        progress: totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0,
        goalCount: savingsGoals.length,
      },
      // Quick statistics
      quickStats: {
        totalTransactions: transactionCount,
        totalCategories: categoryCount,
        totalPaymentMethods: paymentMethodCount,
        averageTransactionAmount,
        largestExpense: largestExpense?.amount ?? 0,
        largestIncome: largestIncome?.amount ?? 0,
      },
      // Spending by category
      spendingByCategory,
      // Spending by payment method
      spendingByPaymentMethod,
      mostUsedPaymentMethod,
    };
  },

  async getIncomeExpenseChart(
    userId: string,
    options: {
      months?: number;
      period?: string;
      dateRange?: { startDate?: Date; endDate?: Date } | null;
    } = {},
  ) {
    const months = options.months ?? 12;
    const now = new Date();
    const startDate =
      options.dateRange?.startDate ?? new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
    const endDate = options.dateRange?.endDate ?? now;

    // Fetch all transactions in the date range
    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        date: { gte: startDate, lte: endDate },
      },
      select: { amount: true, type: true, date: true },
      orderBy: { date: "asc" },
    });

    // Group by year-month (period key: "YYYY-MM")
    const periodMap = new Map<string, { income: number; expense: number; count: number }>();

    // Initialize all months in range so empty months show as 0
    const rangeStart = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const rangeEnd = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    let cursor = new Date(rangeEnd);
    while (cursor >= rangeStart) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      periodMap.set(key, { income: 0, expense: 0, count: 0 });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    }

    for (const txn of transactions) {
      const d = new Date(txn.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const entry = periodMap.get(key);
      if (!entry) continue; // outside range

      if (txn.type === "INCOME") {
        entry.income += txn.amount;
      } else if (txn.type === "EXPENSE") {
        entry.expense += txn.amount;
      }
      entry.count++;
    }

    // Convert to sorted array
    const MONTH_NAMES = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    const chartData = Array.from(periodMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, data]) => {
        const [year, monthNum] = period.split("-");
        return {
          period,
          label: `${MONTH_NAMES[parseInt(monthNum, 10) - 1]} ${year}`,
          income: data.income,
          expense: data.expense,
          net: data.income - data.expense,
        };
      });

    return { chartData };
  },

  async getCategoryDistribution(
    userId: string,
    options: { months?: number; dateRange?: { startDate?: Date; endDate?: Date } | null } = {},
  ) {
    const { months, dateRange } = options;
    const now = new Date();

    // Build date filter from dateRange or months
    let dateFilter: Record<string, unknown> = {};
    if (dateRange?.startDate || dateRange?.endDate) {
      const df: Record<string, Date> = {};
      if (dateRange.startDate) df.gte = dateRange.startDate;
      if (dateRange.endDate) df.lte = dateRange.endDate;
      dateFilter = { date: df };
    } else if (months && months > 0) {
      dateFilter = {
        date: { gte: new Date(now.getFullYear(), now.getMonth() - months + 1, 1), lte: now },
      };
    }

    // ─── Use Prisma groupBy to aggregate directly in DB instead of fetchAll+JS group ──
    // Two queries in parallel: aggregated totals + category names (much cheaper than fetching all rows)
    const [spendingGroup, userCategories] = await Promise.all([
      prisma.transaction.groupBy({
        where: {
          userId,
          type: "EXPENSE",
          ...dateFilter,
        },
        by: ["categoryId"],
        _sum: { amount: true },
        _count: true,
      }),
      prisma.category.findMany({
        where: { userId },
        select: { id: true, name: true, color: true, icon: true },
      }),
    ]);

    if (spendingGroup.length === 0) {
      return {
        distribution: [],
        summary: {
          totalSpent: 0,
          categoryCount: 0,
          transactionCount: 0,
          topCategory: null,
          averagePerCategory: 0,
        },
      };
    }

    // Build category lookup map
    const catMap = new Map(userCategories.map((c) => [c.id, c]));

    // ─── Compute distribution sorted by highest spending ────
    // totalSpent derived from aggregated sums (no row-level iteration)
    const totalSpent = spendingGroup.reduce((sum, g) => sum + (g._sum.amount ?? 0), 0);

    const distribution = spendingGroup
      .map((group) => {
        const cat = catMap.get(group.categoryId);
        const amount = group._sum.amount ?? 0;
        const count = group._count ?? 0;
        return {
          categoryId: group.categoryId,
          categoryName: cat?.name ?? "Unknown",
          categoryColor: cat?.color ?? "#6366F1",
          categoryIcon: cat?.icon ?? "Tag",
          totalSpent: Math.round(amount * 100) / 100,
          percentage: totalSpent > 0 ? Math.round((amount / totalSpent) * 10000) / 100 : 0,
          transactionCount: count,
          averageTransaction: count > 0 ? Math.round((amount / count) * 100) / 100 : 0,
        };
      })
      .sort((a, b) => b.totalSpent - a.totalSpent);

    // ─── Summary stats ─────────────────────────────────────
    const transactionCount = spendingGroup.reduce((sum, g) => sum + (g._count ?? 0), 0);
    const topCategory = distribution.length > 0 ? distribution[0] : null;

    return {
      distribution,
      summary: {
        totalSpent: Math.round(totalSpent * 100) / 100,
        categoryCount: distribution.length,
        transactionCount,
        topCategory: topCategory
          ? {
              categoryId: topCategory.categoryId,
              categoryName: topCategory.categoryName,
              categoryColor: topCategory.categoryColor,
              totalSpent: topCategory.totalSpent,
              percentage: topCategory.percentage,
            }
          : null,
        averagePerCategory:
          distribution.length > 0 ? Math.round((totalSpent / distribution.length) * 100) / 100 : 0,
      },
    };
  },

  async getMonthlyExpenses(
    userId: string,
    options: { months?: number; dateRange?: { startDate?: Date; endDate?: Date } | null } = {},
  ) {
    const months = options.months ?? 12;
    const now = new Date();
    const startDate =
      options.dateRange?.startDate ?? new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
    const endDate = options.dateRange?.endDate ?? now;

    // Fetch expense transactions in the date range and group by year-month in JS
    // (Prisma groupBy can't natively group by computed year-month values)
    const expenses = await prisma.transaction.findMany({
      where: {
        userId,
        type: "EXPENSE",
        date: { gte: startDate, lte: endDate },
      },
      select: { amount: true, date: true },
      orderBy: { date: "asc" },
    });

    // Group by year-month using a Map
    const periodMap = new Map<string, { total: number; transactionCount: number }>();

    // Initialize all months in range so empty months show as 0
    const rangeStart = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const rangeEnd = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    let cursor = new Date(rangeEnd);
    while (cursor >= rangeStart) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      periodMap.set(key, { total: 0, transactionCount: 0 });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    }

    for (const txn of expenses) {
      const d = new Date(txn.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const entry = periodMap.get(key);
      if (!entry) continue; // outside range

      entry.total += txn.amount;
      entry.transactionCount++;
    }

    // Convert to sorted chronological array
    const MONTH_NAMES = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    const chartData = Array.from(periodMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, data]) => {
        const [year, monthNum] = period.split("-");
        const monthIndex = parseInt(monthNum, 10) - 1;
        return {
          period,
          label: `${MONTH_NAMES[monthIndex]} ${year}`,
          total: Math.round(data.total * 100) / 100,
          transactionCount: data.transactionCount,
        };
      });

    // Compute summary stats
    const totalExpenses = chartData.reduce((sum, d) => sum + d.total, 0);
    const monthsWithData = chartData.filter((d) => d.transactionCount > 0).length;

    // Filter to months with actual transactions for highest/lowest (skip $0 empty months)
    const activeMonths = chartData.filter((d) => d.transactionCount > 0);

    return {
      chartData,
      summary: {
        totalExpenses: Math.round(totalExpenses * 100) / 100,
        averageMonthly:
          monthsWithData > 0 ? Math.round((totalExpenses / monthsWithData) * 100) / 100 : 0,
        monthsWithData,
        totalMonths: months,
        highestMonth:
          activeMonths.length > 0
            ? {
                ...activeMonths.reduce(
                  (max, d) => (d.total > max.total ? d : max),
                  activeMonths[0],
                ),
              }
            : null,
        lowestMonth:
          activeMonths.length > 0
            ? {
                ...activeMonths.reduce(
                  (min, d) => (d.total < min.total ? d : min),
                  activeMonths[0],
                ),
              }
            : null,
      },
    };
  },

  async getBudgetUsage(userId: string, options: { month?: string } = {}) {
    const now = new Date();
    let periodStart: Date;
    let periodEnd: Date;

    if (options.month) {
      // Parse specific month e.g. "2026-07"
      const [year, monthNum] = options.month.split("-");
      periodStart = new Date(parseInt(year, 10), parseInt(monthNum, 10) - 1, 1);
      periodEnd = new Date(parseInt(year, 10), parseInt(monthNum, 10), 0, 23, 59, 59, 999);
    } else {
      // Default to current month
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    // Fetch all active budgets for this user
    const budgets = await prisma.budget.findMany({
      where: { userId },
      include: { category: true },
      orderBy: { createdAt: "desc" },
    });

    if (budgets.length === 0) {
      return { budgets: [], summary: null };
    }

    // Get all category IDs that have budgets
    const budgetCategoryIds = budgets.map((b) => b.categoryId);

    // Single groupBy query for expense totals across all budgeted categories
    const spendingGroup = await prisma.transaction.groupBy({
      where: {
        userId,
        type: "EXPENSE",
        categoryId: { in: budgetCategoryIds },
        date: { gte: periodStart, lte: periodEnd },
      },
      by: ["categoryId"],
      _sum: { amount: true },
      _count: true,
    });

    // Build spending map
    const spendingMap = new Map<string, { spent: number; count: number }>();
    for (const g of spendingGroup) {
      spendingMap.set(g.categoryId, {
        spent: g._sum.amount ?? 0,
        count: g._count,
      });
    }

    // Enrich each budget with actual spending
    const budgetUsages = budgets.map((budget) => {
      const spending = spendingMap.get(budget.categoryId);
      const spentAmount = spending?.spent ?? 0;
      const transactionCount = spending?.count ?? 0;
      const remaining = budget.targetAmount - spentAmount;
      const percentage =
        budget.targetAmount > 0 ? Math.round((spentAmount / budget.targetAmount) * 100) : 0;

      // Determine status
      let status: "on_track" | "warning" | "critical" = "on_track";
      if (percentage >= 100) {
        status = "critical";
      } else if (percentage >= budget.alertThreshold) {
        status = "warning";
      }

      return {
        budgetId: budget.id,
        categoryId: budget.categoryId,
        categoryName: budget.category.name,
        categoryColor: budget.category.color,
        categoryIcon: budget.category.icon,
        budgeted: budget.targetAmount,
        alertThreshold: budget.alertThreshold,
        spent: Math.round(spentAmount * 100) / 100,
        remaining: Math.round(remaining * 100) / 100,
        percentage,
        transactionCount,
        status,
        period: budget.period,
        startDate: budget.startDate,
      };
    });

    // Compute summary
    const totalBudgeted = budgetUsages.reduce((sum, b) => sum + b.budgeted, 0);
    const totalSpent = budgetUsages.reduce((sum, b) => sum + b.spent, 0);
    const totalRemaining = totalBudgeted - totalSpent;
    const overspentCount = budgetUsages.filter((b) => b.remaining < 0).length;
    const onTrackCount = budgetUsages.filter((b) => b.status === "on_track").length;
    const warningCount = budgetUsages.filter((b) => b.status === "warning").length;
    const criticalCount = budgetUsages.filter((b) => b.status === "critical").length;

    return {
      budgets: budgetUsages,
      period: {
        start: periodStart.toISOString().slice(0, 10),
        end: periodEnd.toISOString().slice(0, 10),
        label: periodStart.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      },
      summary: {
        totalBudgeted: Math.round(totalBudgeted * 100) / 100,
        totalSpent: Math.round(totalSpent * 100) / 100,
        totalRemaining: Math.round(totalRemaining * 100) / 100,
        overallPercentage: totalBudgeted > 0 ? Math.round((totalSpent / totalBudgeted) * 100) : 0,
        overspentCount,
        onTrackCount,
        warningCount,
        criticalCount,
      },
    };
  },

  async getCashFlow(
    userId: string,
    options: { months?: number; dateRange?: { startDate?: Date; endDate?: Date } | null } = {},
  ) {
    const months = options.months ?? 12;
    const now = new Date();
    const startDate =
      options.dateRange?.startDate ?? new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
    const endDate = options.dateRange?.endDate ?? now;

    // Fetch all transactions in the date range (both income and expense)
    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        date: { gte: startDate, lte: endDate },
      },
      select: { amount: true, type: true, date: true },
      orderBy: { date: "asc" },
    });

    // Group by year-month
    const periodMap = new Map<string, { income: number; expense: number; count: number }>();

    // Initialize all months so empty months show as 0
    const rangeStart = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const rangeEnd = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    let cursor = new Date(rangeEnd);
    while (cursor >= rangeStart) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      periodMap.set(key, { income: 0, expense: 0, count: 0 });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    }

    for (const txn of transactions) {
      const d = new Date(txn.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const entry = periodMap.get(key);
      if (!entry) continue;

      if (txn.type === "INCOME") {
        entry.income += txn.amount;
      } else if (txn.type === "EXPENSE") {
        entry.expense += txn.amount;
      }
      entry.count++;
    }

    // Convert to sorted chronological array with running balance
    const MONTH_NAMES = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    let runningBalance = 0;

    const chartData = Array.from(periodMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, data]) => {
        const [year, monthNum] = period.split("-");
        const net = data.income - data.expense;
        runningBalance += net;

        return {
          period,
          label: `${MONTH_NAMES[parseInt(monthNum, 10) - 1]} ${year}`,
          income: Math.round(data.income * 100) / 100,
          expense: Math.round(data.expense * 100) / 100,
          net: Math.round(net * 100) / 100,
          balance: Math.round(runningBalance * 100) / 100,
        };
      });

    const totalIncome = chartData.reduce((sum, d) => sum + d.income, 0);
    const totalExpense = chartData.reduce((sum, d) => sum + d.expense, 0);
    const finalBalance = chartData.length > 0 ? chartData[chartData.length - 1].balance : 0;

    return {
      chartData,
      summary: {
        totalIncome: Math.round(totalIncome * 100) / 100,
        totalExpense: Math.round(totalExpense * 100) / 100,
        netCashFlow: Math.round((totalIncome - totalExpense) * 100) / 100,
        finalBalance,
        bestMonth:
          chartData.length > 0
            ? { ...chartData.reduce((max, d) => (d.net > max.net ? d : max), chartData[0]) }
            : null,
        totalMonths: months,
      },
    };
  },
};
