import { reportRepository } from "../reports/reports.repository.js";
import { reportService } from "../reports/reports.service.js";
import { budgetRepository } from "../budgets/budgets.repository.js";
import { savingsGoalRepository } from "../savings-goals/savings-goals.repository.js";
import type {
  ExportTransactionsQuery,
  ExportTransactionsResult,
  ColumnName,
} from "./exports.types.js";

// ─── CSV Escaping Helpers ──────────────────────────────────────

/**
 * Escape a CSV field value: wrap in quotes if it contains commas, quotes, or newlines.
 * Doubles any embedded quotes.
 */
function escapeCsv(value: unknown): string {
  const str = value == null ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Format a date to YYYY-MM-DD string.
 */
function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}

/**
 * Format a number as a fixed-decimal currency string (no symbol, just the number).
 */
function formatAmount(amount: number): string {
  return amount.toFixed(2);
}

// ─── Column Helpers ────────────────────────────────────────────

const ALL_COLUMNS: Array<{ key: ColumnName; label: string }> = [
  { key: "id", label: "ID" },
  { key: "date", label: "Date" },
  { key: "type", label: "Type" },
  { key: "amount", label: "Amount" },
  { key: "description", label: "Description" },
  { key: "category", label: "Category" },
  { key: "paymentmethod", label: "Payment Method" },
  { key: "notes", label: "Notes" },
];

/** Resolve which columns to include — defaults to all if not specified. */
function resolveColumns(columns?: ColumnName[]): Array<{ key: ColumnName; label: string }> {
  if (!columns || columns.length === 0) return ALL_COLUMNS;
  return ALL_COLUMNS.filter((c) => columns.includes(c.key));
}

/** Build a CSV header row from column definitions. */
function buildCsvHeaders(cols: Array<{ key: ColumnName; label: string }>): string {
  return cols.map((c) => c.label).join(",");
}

/** Build a CSV data row from column definitions and a transaction object. */
function buildCsvRow(
  cols: Array<{ key: ColumnName; label: string }>,
  tx: {
    id: string;
    date: Date;
    type: string;
    amount: number;
    description: string;
    category: { name: string };
    paymentMethod?: { name: string } | null;
    notes?: string | null;
  },
): string {
  return cols
    .map((col) => {
      switch (col.key) {
        case "id":
          return escapeCsv(tx.id);
        case "date":
          return escapeCsv(formatDate(tx.date));
        case "type":
          return escapeCsv(tx.type);
        case "amount":
          return formatAmount(tx.amount);
        case "description":
          return escapeCsv(tx.description);
        case "category":
          return escapeCsv(tx.category.name);
        case "paymentmethod":
          return escapeCsv(tx.paymentMethod?.name ?? "");
        case "notes":
          return escapeCsv(tx.notes ?? "");
        default:
          return "";
      }
    })
    .join(",");
}

/**
 * Build the common DB filters from export query params.
 * Resolves budgetId to categoryId if the budget belongs to this user.
 */
async function buildDbFilters(
  userId: string,
  filters: ExportTransactionsQuery,
): Promise<Record<string, unknown>> {
  const dbFilters: Record<string, unknown> = {};

  if (filters.startDate) dbFilters.startDate = new Date(filters.startDate);
  if (filters.endDate) dbFilters.endDate = new Date(filters.endDate);
  if (filters.categoryId) dbFilters.categoryId = filters.categoryId;
  if (filters.paymentMethodId) dbFilters.paymentMethodId = filters.paymentMethodId;
  if (filters.type) dbFilters.type = filters.type;
  if (filters.minAmount !== undefined) dbFilters.minAmount = filters.minAmount;
  if (filters.maxAmount !== undefined) dbFilters.maxAmount = filters.maxAmount;
  if (filters.budgetId) {
    const budget = await budgetRepository.findById(filters.budgetId);
    if (budget && budget.userId === userId) {
      dbFilters.categoryId = budget.categoryId;
    }
  }

  return dbFilters;
}

// ─── Public Export Functions ───────────────────────────────────

export const exportService = {
  /**
   * Generate a CSV string for transactions matching the given filters.
   * Supports column selection, sort order, and pagination.
   * Returns the CSV string along with pagination metadata.
   */
  async generateTransactionsCsv(
    userId: string,
    filters: ExportTransactionsQuery,
  ): Promise<ExportTransactionsResult> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 1000;
    const skip = (page - 1) * limit;

    const dbFilters = await buildDbFilters(userId, filters);

    // Fetch total count separately for pagination metadata
    const totalCount = await reportRepository.countCustomTransactions(
      userId,
      dbFilters as Parameters<typeof reportRepository.countCustomTransactions>[1],
    );

    const totalPages = Math.max(1, Math.ceil(totalCount / limit));

    const transactions = await reportRepository.findCustomTransactions(
      userId,
      dbFilters as Parameters<typeof reportRepository.findCustomTransactions>[1],
      { skip, take: limit },
      { sortBy: filters.sortBy, sortOrder: filters.sortOrder },
    );

    // Apply column selection
    const cols = resolveColumns(filters.columns);
    const headerRow = buildCsvHeaders(cols);
    const dataRows = transactions.map((tx) => buildCsvRow(cols, tx));

    const csv = [headerRow, ...dataRows].join("\n");

    return { csv, totalCount, page, limit: Math.min(limit, totalCount), totalPages };
  },

  /**
   * Generate a CSV string for a report of the given type.
   */
  async generateReportCsv(
    userId: string,
    query: {
      type: string;
      date?: string;
      year?: number;
      month?: number;
      startDate?: string;
      endDate?: string;
      budgetId?: string;
      savingsGoalId?: string;
    },
  ): Promise<string> {
    // Fetch savings goal info if provided
    let goalInfo: Record<string, unknown> | null = null;
    if (query.savingsGoalId) {
      const goal = await savingsGoalRepository.getGoalWithDetails(userId, query.savingsGoalId);
      if (goal) {
        goalInfo = {
          name: goal.name,
          targetAmount: goal.targetAmount,
          currentAmount: goal.currentAmount,
          progress: goal.progress,
          remaining: goal.remaining,
          daysRemaining: goal.daysRemaining,
          isCompleted: goal.isCompleted,
        };
      }
    }

    switch (query.type) {
      case "daily":
        return this.generateDailyReportCsv(
          userId,
          query.date ?? new Date().toISOString().slice(0, 10),
        );

      case "weekly":
        return this.generateWeeklyReportCsv(
          userId,
          query.date ?? new Date().toISOString().slice(0, 10),
        );

      case "monthly":
        return this.generateMonthlyReportCsv(
          userId,
          query.year ?? new Date().getFullYear(),
          query.month ?? new Date().getMonth() + 1,
        );

      case "yearly":
        return this.generateYearlyReportCsv(userId, query.year ?? new Date().getFullYear());

      case "summary":
        return this.generateSummaryCsv(userId, query.startDate, query.endDate, goalInfo);

      case "breakdown":
        return this.generateBreakdownCsv(userId, query.startDate, query.endDate);

      default:
        throw new Error(`Unknown report type: ${query.type}`);
    }
  },

  // ─── Daily Report CSV ──────────────────────────────────────

  async generateDailyReportCsv(userId: string, dateStr: string): Promise<string> {
    const report = await reportService.getDailyReport(userId, dateStr);

    const lines: string[] = [
      `Daily Report - ${report.date}`,
      "",
      `Income: ${formatAmount(report.income)}`,
      `Expenses: ${formatAmount(report.expenses)}`,
      `Balance: ${formatAmount(report.balance)}`,
      `Transactions: ${report.transactionCount}`,
      "",
      buildCsvHeaders(ALL_COLUMNS),
    ];

    for (const tx of report.transactions) {
      lines.push(
        [
          escapeCsv(tx.id),
          escapeCsv(formatDate(tx.date)),
          escapeCsv(tx.type),
          formatAmount(tx.amount),
          escapeCsv(tx.description),
          escapeCsv(tx.categoryName),
          "",
          "",
        ].join(","),
      );
    }

    return lines.join("\n");
  },

  // ─── Weekly Report CSV ─────────────────────────────────────

  async generateWeeklyReportCsv(userId: string, dateStr: string): Promise<string> {
    const report = await reportService.getWeeklyReport(userId, dateStr);

    const lines: string[] = [
      `Weekly Report - ${report.weekLabel}`,
      "",
      `Income: ${formatAmount(report.income)}`,
      `Expenses: ${formatAmount(report.expenses)}`,
      `Balance: ${formatAmount(report.balance)}`,
      `Transactions: ${report.transactionCount}`,
      "",
      "--- Daily Breakdown ---",
      "Date,Day,Income,Expenses,Transactions",
    ];

    for (const day of report.dailyBreakdown) {
      lines.push(
        [
          escapeCsv(day.date),
          escapeCsv(day.dayName),
          formatAmount(day.income),
          formatAmount(day.expenses),
          String(day.transactionCount),
        ].join(","),
      );
    }

    lines.push("", "--- Transactions ---", buildCsvHeaders(ALL_COLUMNS));
    for (const tx of report.transactions) {
      lines.push(
        [
          escapeCsv(tx.id),
          escapeCsv(formatDate(tx.date)),
          escapeCsv(tx.type),
          formatAmount(tx.amount),
          escapeCsv(tx.description),
          escapeCsv(tx.categoryName),
          "",
          "",
        ].join(","),
      );
    }

    lines.push("", "--- Spending by Category ---", "Category,Total,Count");
    for (const cat of report.spendingByCategory) {
      lines.push(
        [escapeCsv(cat.categoryName), formatAmount(cat.total), String(cat.count)].join(","),
      );
    }

    return lines.join("\n");
  },

  // ─── Monthly Report CSV ────────────────────────────────────

  async generateMonthlyReportCsv(userId: string, year: number, month: number): Promise<string> {
    const report = await reportService.getMonthlyReport(userId, year, month);

    const lines: string[] = [
      `Monthly Report - ${report.label}`,
      "",
      `Income: ${formatAmount(report.income)}`,
      `Expenses: ${formatAmount(report.expenses)}`,
      `Net Savings: ${formatAmount(report.netSavings)}`,
      `Transactions: ${report.transactionCount}`,
    ];

    // Category summary
    lines.push("", "--- Category Summary ---", "Category,Total,Count,% of Expenses");
    for (const cat of report.categorySummary) {
      lines.push(
        [
          escapeCsv(cat.categoryName),
          formatAmount(cat.total),
          String(cat.count),
          `${cat.percentage}%`,
        ].join(","),
      );
    }

    // Payment method summary
    lines.push("", "--- Payment Method Summary ---", "Method,Income,Expense,Net,Transactions");
    for (const pm of report.paymentMethodSummary) {
      lines.push(
        [
          escapeCsv(pm.paymentMethodName),
          formatAmount(pm.totalIncome),
          formatAmount(pm.totalExpense),
          formatAmount(pm.netAmount),
          String(pm.transactionCount),
        ].join(","),
      );
    }

    // Budget performance
    lines.push("", "--- Budget Performance ---", "Category,Budgeted,Spent,Remaining,% Used,Status");
    for (const bp of report.budgetPerformance) {
      lines.push(
        [
          escapeCsv(bp.categoryName),
          formatAmount(bp.budgeted),
          formatAmount(bp.spent),
          formatAmount(bp.remaining),
          `${bp.percentage}%`,
          escapeCsv(bp.status),
        ].join(","),
      );
    }

    return lines.join("\n");
  },

  // ─── Yearly Report CSV ─────────────────────────────────────

  async generateYearlyReportCsv(userId: string, year: number): Promise<string> {
    const report = await reportService.getYearlyReport(userId, year);

    const lines: string[] = [
      `Yearly Report - ${report.year}`,
      "",
      `Income: ${formatAmount(report.income)}`,
      `Expenses: ${formatAmount(report.expenses)}`,
      `Net Savings: ${formatAmount(report.netSavings)}`,
      `Transactions: ${report.transactionCount}`,
    ];

    // Monthly comparison
    lines.push("", "--- Monthly Comparison ---", "Month,Income,Expenses,Net");
    for (const mc of report.monthlyComparison) {
      lines.push(
        [
          escapeCsv(mc.label),
          formatAmount(mc.income),
          formatAmount(mc.expenses),
          formatAmount(mc.net),
        ].join(","),
      );
    }

    // Top categories
    lines.push("", "--- Top Categories ---", "Category,Total,Count,% of Expenses");
    for (const cat of report.topCategories) {
      lines.push(
        [
          escapeCsv(cat.categoryName),
          formatAmount(cat.total),
          String(cat.count),
          `${cat.percentage}%`,
        ].join(","),
      );
    }

    // Budget performance
    lines.push("", "--- Budget Performance ---", "Category,Budgeted,Spent,Remaining,% Used,Status");
    for (const bp of report.budgetPerformance) {
      lines.push(
        [
          escapeCsv(bp.categoryName),
          formatAmount(bp.budgeted),
          formatAmount(bp.spent),
          formatAmount(bp.remaining),
          `${bp.percentage}%`,
          escapeCsv(bp.status),
        ].join(","),
      );
    }

    return lines.join("\n");
  },

  // ─── Summary CSV ────────────────────────────────────────────

  async generateSummaryCsv(
    userId: string,
    startDate?: string,
    endDate?: string,
    goalInfo?: Record<string, unknown> | null,
  ): Promise<string> {
    const summary = await reportService.getSummary(userId, startDate, endDate);

    const lines: string[] = [
      "Report Summary",
      "",
      `Income: ${formatAmount(summary.income)}`,
      `Expenses: ${formatAmount(summary.expenses)}`,
      `Net Balance: ${formatAmount(summary.netBalance)}`,
      `Savings Rate: ${summary.savingsRate}%`,
      `Total Transactions: ${summary.transactionCount}`,
      `Income Transactions: ${summary.incomeCount}`,
      `Expense Transactions: ${summary.expenseCount}`,
      `Average Transaction: ${formatAmount(summary.averageTransactionAmount)}`,
      `Average Income: ${formatAmount(summary.averageIncome)}`,
      `Average Expense: ${formatAmount(summary.averageExpense)}`,
    ];

    // Include savings goal info if provided
    if (goalInfo) {
      const g = goalInfo as Record<string, any>;
      lines.push(
        "",
        "--- Savings Goal ---",
        `Goal,${escapeCsv(g.name)}`,
        `Target,${formatAmount(g.targetAmount)}`,
        `Saved,${formatAmount(g.currentAmount)}`,
        `Progress,${g.progress}%`,
        `Remaining,${formatAmount(g.remaining)}`,
        `Days Remaining,${g.daysRemaining ?? "N/A"}`,
        `Status,${g.isCompleted ? "Completed" : "In Progress"}`,
      );
    }

    lines.push(
      "",
      "Metric,Value",
      `Income,${formatAmount(summary.income)}`,
      `Expenses,${formatAmount(summary.expenses)}`,
      `Net Balance,${formatAmount(summary.netBalance)}`,
      `Savings Rate,${summary.savingsRate}%`,
      `Transactions,${summary.transactionCount}`,
    );

    return lines.join("\n");
  },

  // ─── Breakdown CSV ──────────────────────────────────────────

  async generateBreakdownCsv(
    userId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<string> {
    const breakdown = await reportService.getBreakdown(userId, startDate, endDate);

    const lines: string[] = [
      "Report Breakdown",
      "",
      "--- Income vs Expense ---",
      "Metric,Value",
      `Income,${formatAmount(breakdown.incomeVsExpense.income)}`,
      `Expenses,${formatAmount(breakdown.incomeVsExpense.expenses)}`,
      `Net,${formatAmount(breakdown.incomeVsExpense.net)}`,
      `Income Count,${breakdown.incomeVsExpense.incomeCount}`,
      `Expense Count,${breakdown.incomeVsExpense.expenseCount}`,
      `Income %,${breakdown.incomeVsExpense.incomePercentage}%`,
      `Expense %,${breakdown.incomeVsExpense.expensePercentage}%`,
    ];

    // Category breakdown
    lines.push("", "--- Category Breakdown ---", "Category,Total,Count,%");
    for (const cat of breakdown.categoryBreakdown) {
      lines.push(
        [
          escapeCsv(cat.categoryName),
          formatAmount(cat.total),
          String(cat.count),
          `${cat.percentage}%`,
        ].join(","),
      );
    }

    // Payment method breakdown
    lines.push("", "--- Payment Method Breakdown ---", "Method,Income,Expense,Net,Transactions");
    for (const pm of breakdown.paymentMethodBreakdown) {
      lines.push(
        [
          escapeCsv(pm.paymentMethodName),
          formatAmount(pm.totalIncome),
          formatAmount(pm.totalExpense),
          formatAmount(pm.netAmount),
          String(pm.transactionCount),
        ].join(","),
      );
    }

    // Largest / Smallest transactions
    if (breakdown.largestTransaction) {
      lines.push(
        "",
        "--- Largest Transaction ---",
        `Amount,${formatAmount(breakdown.largestTransaction.amount)}`,
        `Description,${escapeCsv(breakdown.largestTransaction.description)}`,
        `Category,${escapeCsv(breakdown.largestTransaction.categoryName)}`,
        `Type,${escapeCsv(breakdown.largestTransaction.type)}`,
        `Date,${formatDate(breakdown.largestTransaction.date)}`,
      );
    }

    if (breakdown.smallestTransaction) {
      lines.push(
        "",
        "--- Smallest Transaction ---",
        `Amount,${formatAmount(breakdown.smallestTransaction.amount)}`,
        `Description,${escapeCsv(breakdown.smallestTransaction.description)}`,
        `Category,${escapeCsv(breakdown.smallestTransaction.categoryName)}`,
        `Type,${escapeCsv(breakdown.smallestTransaction.type)}`,
        `Date,${formatDate(breakdown.smallestTransaction.date)}`,
      );
    }

    return lines.join("\n");
  },
};
