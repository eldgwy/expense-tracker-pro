import PDFDocument from "pdfkit";
import { reportService } from "../reports/reports.service.js";
import { reportRepository } from "../reports/reports.repository.js";
import { budgetRepository } from "../budgets/budgets.repository.js";
import { savingsGoalRepository } from "../savings-goals/savings-goals.repository.js";

// ─── Color Palette ─────────────────────────────────────────────

const COLORS = {
  primary: "#1E40AF",
  secondary: "#3B82F6",
  accent: "#10B981",
  danger: "#EF4444",
  warning: "#F59E0B",
  textPrimary: "#1F2937",
  textSecondary: "#6B7280",
  textMuted: "#9CA3AF",
  border: "#E5E7EB",
  bgLight: "#F9FAFB",
  bgHeader: "#EFF6FF",
  white: "#FFFFFF",
};

// ─── Constants ─────────────────────────────────────────────────

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_LEFT = 50;
const MARGIN_RIGHT = 50;
const MARGIN_TOP = 50;
const MARGIN_BOTTOM = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const TABLE_ROW_HEIGHT = 18;
const SECTION_GAP = 20;
const LINE_HEIGHT = 14;

// ─── Helper Functions ──────────────────────────────────────────

function fmtCurrency(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}

function fmtDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function truncateText(text: string, maxWidth: number, doc: PDFDocument): string {
  const ellipsis = "...";
  let truncated = text;
  while (doc.fontSize(9).widthOfString(truncated + ellipsis) > maxWidth && truncated.length > 1) {
    truncated = truncated.slice(0, -1);
  }
  return truncated.length < text.length ? truncated + ellipsis : text;
}

// ─── PDF Generator Class ───────────────────────────────────────

class ReportPdfGenerator {
  private doc: PDFDocument;
  private y: number;
  private userEmail: string = "";
  private goalInfo: Record<string, unknown> | null = null;

  constructor(userEmail?: string, orientation?: "portrait" | "landscape") {
    const isLandscape = orientation === "landscape";
    this.doc = new PDFDocument({
      size: "LETTER",
      layout: isLandscape ? "landscape" : "portrait",
      margin: MARGIN_LEFT,
      info: {
        Title: "Financial Report - Expense Tracker Pro",
        Author: "Expense Tracker Pro",
        Subject: "Financial Report",
      },
      compress: false,
    });
    this.y = MARGIN_TOP;
    this.userEmail = userEmail ?? "";
  }

  // ─── Public API ────────────────────────────────────────────

  async generateReportPdf(
    userId: string,
    query: {
      type: string;
      date?: string;
      year?: number;
      month?: number;
      startDate?: string;
      endDate?: string;
      savingsGoalId?: string;
    },
  ): Promise<Buffer> {
    const buffers: Buffer[] = [];
    this.doc.on("data", (chunk: Buffer) => buffers.push(chunk));

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
          isCompleted: goal.isCompleted,
        };
      }
    }
    this.goalInfo = goalInfo;

    switch (query.type) {
      case "daily":
        await this.generateDailyReport(userId, query.date ?? new Date().toISOString().slice(0, 10));
        break;
      case "weekly":
        await this.generateWeeklyReport(
          userId,
          query.date ?? new Date().toISOString().slice(0, 10),
        );
        break;
      case "monthly":
        await this.generateMonthlyReport(
          userId,
          query.year ?? new Date().getFullYear(),
          query.month ?? new Date().getMonth() + 1,
        );
        break;
      case "yearly":
        await this.generateYearlyReport(userId, query.year ?? new Date().getFullYear());
        break;
      case "summary":
        await this.generateSummaryReport(userId, query.startDate, query.endDate);
        break;
      case "breakdown":
        await this.generateBreakdownReport(userId, query.startDate, query.endDate);
        break;
      default:
        throw new Error(`Unknown report type: ${query.type}`);
    }

    this.doc.end();
    return new Promise((resolve) => {
      this.doc.on("end", () => {
        resolve(Buffer.concat(buffers));
      });
    });
  }

  async generateTransactionsPdf(userId: string, filters: Record<string, unknown>): Promise<Buffer> {
    const buffers: Buffer[] = [];
    this.doc.on("data", (chunk: Buffer) => buffers.push(chunk));

    const dbFilters: Record<string, unknown> = {};
    if (filters.startDate) dbFilters.startDate = new Date(filters.startDate as string);
    if (filters.endDate) dbFilters.endDate = new Date(filters.endDate as string);
    if (filters.categoryId) dbFilters.categoryId = filters.categoryId;
    if (filters.paymentMethodId) dbFilters.paymentMethodId = filters.paymentMethodId;
    if (filters.type) dbFilters.type = filters.type;
    if (filters.minAmount !== undefined) dbFilters.minAmount = filters.minAmount;
    if (filters.maxAmount !== undefined) dbFilters.maxAmount = filters.maxAmount;
    if (filters.budgetId) {
      const budget = await budgetRepository.findById(filters.budgetId as string);
      if (budget) {
        dbFilters.categoryId = budget.categoryId;
      }
    }

    const summary = await reportService.getSummary(
      userId,
      filters.startDate as string | undefined,
      filters.endDate as string | undefined,
    );
    const transactions = await reportRepository.findCustomTransactions(userId, dbFilters as any);

    this.addTitle("Transaction Export");
    this.addUserInfo();
    const rangeStr =
      filters.startDate || filters.endDate
        ? `${filters.startDate ?? "earliest"} — ${filters.endDate ?? "today"}`
        : "All transactions";
    this.addMetadata("Date Range", rangeStr);
    this.addSectionGap();
    this.addSummaryCards(summary);
    this.addSectionGap();
    this.addTransactionTable(transactions);
    this.addFooter();
    this.doc.end();

    return new Promise((resolve) => {
      this.doc.on("end", () => {
        resolve(Buffer.concat(buffers));
      });
    });
  }

  // ─── Report Generators ─────────────────────────────────────

  private async generateDailyReport(userId: string, dateStr: string) {
    const report = await reportService.getDailyReport(userId, dateStr);
    this.addTitle("Daily Financial Report");
    this.addUserInfo();
    this.addMetadata("Date", fmtDate(dateStr));
    this.addSectionGap();
    this.addSummaryCards({
      income: report.income,
      expenses: report.expenses,
      netBalance: report.balance,
      transactionCount: report.transactionCount,
      savingsRate:
        report.income > 0 ? Math.round((report.balance / report.income) * 10000) / 100 : 0,
    } as any);
    this.addSectionGap();
    this.addTransactionTable(report.transactions);
    this.addSectionGap();
    this.addCategorySummary(report.spendingByCategory);
    this.addFooter();
  }

  private async generateWeeklyReport(userId: string, dateStr: string) {
    const report = await reportService.getWeeklyReport(userId, dateStr);
    this.addTitle("Weekly Financial Report");
    this.addUserInfo();
    this.addMetadata("Period", report.weekLabel);
    this.addSectionGap();
    this.addSummaryCards({
      income: report.income,
      expenses: report.expenses,
      netBalance: report.balance,
      transactionCount: report.transactionCount,
    } as any);
    this.addSectionGap();
    this.addSectionTitle("Daily Breakdown");
    this.addMinimalTable(
      ["Date", "Day", "Income", "Expenses", "Transactions"],
      report.dailyBreakdown.map((day: any) => [
        fmtDate(day.date),
        day.dayName,
        fmtCurrency(day.income),
        fmtCurrency(day.expenses),
        String(day.transactionCount),
      ]),
    );
    this.addSectionGap();
    this.addTransactionTable(report.transactions);
    this.addSectionGap();
    this.addCategorySummary(report.spendingByCategory);
    this.addFooter();
  }

  private async generateMonthlyReport(userId: string, year: number, month: number) {
    const report = await reportService.getMonthlyReport(userId, year, month);
    this.addTitle("Monthly Financial Report");
    this.addUserInfo();
    this.addMetadata("Period", report.label);
    this.addSectionGap();
    this.addSummaryCards({
      income: report.income,
      expenses: report.expenses,
      netBalance: report.netSavings,
      transactionCount: report.transactionCount,
    } as any);
    this.addSectionGap();
    this.addCategoryBreakdown(report.categorySummary);
    this.addSectionGap();
    this.addPaymentMethodSummary(report.paymentMethodSummary);
    if (report.budgetPerformance.length > 0) {
      this.addSectionGap();
      this.addBudgetPerformance(report.budgetPerformance);
    }
    this.addFooter();
  }

  private async generateYearlyReport(userId: string, year: number) {
    const report = await reportService.getYearlyReport(userId, year);
    this.addTitle("Yearly Financial Report");
    this.addUserInfo();
    this.addMetadata("Year", String(report.year));
    this.addSectionGap();
    this.addSummaryCards({
      income: report.income,
      expenses: report.expenses,
      netBalance: report.netSavings,
      transactionCount: report.transactionCount,
    } as any);
    this.addSectionGap();
    this.addSectionTitle("Monthly Comparison");
    this.addMinimalTable(
      ["Month", "Income", "Expenses", "Net"],
      report.monthlyComparison.map((mc: any) => [
        mc.label,
        fmtCurrency(mc.income),
        fmtCurrency(mc.expenses),
        fmtCurrency(mc.net),
      ]),
    );
    this.addSectionGap();
    this.addCategoryBreakdown(report.topCategories);
    if (report.budgetPerformance.length > 0) {
      this.addSectionGap();
      this.addBudgetPerformance(report.budgetPerformance);
    }
    this.addFooter();
  }

  private async generateSummaryReport(userId: string, startDate?: string, endDate?: string) {
    const summary = await reportService.getSummary(userId, startDate, endDate);
    this.addTitle("Financial Report Summary");
    this.addUserInfo();
    if (startDate || endDate)
      this.addMetadata("Period", `${startDate ?? "earliest"} — ${endDate ?? "today"}`);
    this.addSectionGap();
    this.addSummaryCards(summary);
    this.addSectionGap();
    this.addDetailedSummary(summary);
    if (this.goalInfo) {
      this.addSectionGap();
      this.addSectionTitle("Savings Goal Progress");
      const g = this.goalInfo as Record<string, any>;
      this.addInfoRow("Goal", g.name);
      this.addInfoRow("Target", fmtCurrency(g.targetAmount));
      this.addInfoRow("Saved", fmtCurrency(g.currentAmount));
      this.addInfoRow("Progress", `${g.progress}%`);
      this.addInfoRow("Remaining", fmtCurrency(g.remaining));
      this.addInfoRow("Status", g.isCompleted ? "Completed" : "In Progress");
    }
    this.addFooter();
  }

  private async generateBreakdownReport(userId: string, startDate?: string, endDate?: string) {
    const breakdown = await reportService.getBreakdown(userId, startDate, endDate);
    this.addTitle("Financial Report Breakdown");
    this.addUserInfo();
    if (startDate || endDate)
      this.addMetadata("Period", `${startDate ?? "earliest"} — ${endDate ?? "today"}`);
    this.addSectionGap();
    this.addSectionTitle("Income vs Expense");
    this.addMinimalTable(
      ["Metric", "Value"],
      [
        ["Income", fmtCurrency(breakdown.incomeVsExpense.income)],
        ["Expenses", fmtCurrency(breakdown.incomeVsExpense.expenses)],
        ["Net", fmtCurrency(breakdown.incomeVsExpense.net)],
        ["Income Count", String(breakdown.incomeVsExpense.incomeCount)],
        ["Expense Count", String(breakdown.incomeVsExpense.expenseCount)],
        ["Income %", `${breakdown.incomeVsExpense.incomePercentage}%`],
        ["Expense %", `${breakdown.incomeVsExpense.expensePercentage}%`],
      ],
    );
    this.addSectionGap();
    this.addCategoryBreakdown(breakdown.categoryBreakdown);
    this.addSectionGap();
    this.addPaymentMethodSummary(breakdown.paymentMethodBreakdown);
    if (breakdown.largestTransaction) {
      this.addSectionGap();
      this.addSectionTitle("Largest Transaction");
      const lt = breakdown.largestTransaction;
      this.addInfoRow("Amount", fmtCurrency(lt.amount));
      this.addInfoRow("Description", lt.description);
      this.addInfoRow("Category", lt.categoryName);
      this.addInfoRow("Type", lt.type);
      this.addInfoRow("Date", fmtDate(lt.date));
    }
    if (breakdown.smallestTransaction) {
      this.addSectionGap();
      this.addSectionTitle("Smallest Transaction");
      const st = breakdown.smallestTransaction;
      this.addInfoRow("Amount", fmtCurrency(st.amount));
      this.addInfoRow("Description", st.description);
      this.addInfoRow("Category", st.categoryName);
      this.addInfoRow("Type", st.type);
      this.addInfoRow("Date", fmtDate(st.date));
    }
    this.addFooter();
  }

  // ─── Layout Primitives ─────────────────────────────────────

  private checkPage(requiredSpace: number = 60) {
    if (this.y + requiredSpace > PAGE_HEIGHT - MARGIN_BOTTOM) {
      this.addFooter();
      this.doc.addPage();
      this.y = MARGIN_TOP;
      // Re-render user info on new pages
      if (this.userEmail) {
        this.addUserInfo();
      }
    }
  }

  private addTitle(title: string) {
    this.checkPage(80);
    this.doc
      .fontSize(22)
      .fillColor(COLORS.primary)
      .text(title, MARGIN_LEFT, this.y, { align: "center", width: CONTENT_WIDTH });
    this.y = this.doc.y + 4;
    this.doc
      .moveTo(MARGIN_LEFT + 60, this.y)
      .lineTo(PAGE_WIDTH - MARGIN_LEFT - 60, this.y)
      .strokeColor(COLORS.secondary)
      .lineWidth(1.5)
      .stroke();
    this.y += 12;
    this.doc
      .fontSize(9)
      .fillColor(COLORS.textMuted)
      .text("Expense Tracker Pro", MARGIN_LEFT, this.y, { align: "center", width: CONTENT_WIDTH });
    this.y = this.doc.y + 6;
  }

  /** Display user email below the subtitle */
  private addUserInfo() {
    if (!this.userEmail) return;
    this.checkPage(20);
    this.doc
      .fontSize(9)
      .fillColor(COLORS.textSecondary)
      .text(this.userEmail, MARGIN_LEFT, this.y, { align: "center", width: CONTENT_WIDTH });
    this.y = this.doc.y + 4;
  }

  private addMetadata(label: string, value: string) {
    this.checkPage(30);
    this.doc.fontSize(10).fillColor(COLORS.textSecondary);
    this.doc.text(label + ": ", MARGIN_LEFT, this.y, { continued: true });
    this.doc.fillColor(COLORS.textPrimary).text(value, { continued: false });
    this.y = this.doc.y + 2;
  }

  private addSectionGap() {
    this.y += SECTION_GAP;
  }

  private addSectionTitle(title: string) {
    this.checkPage(40);
    this.doc
      .fontSize(14)
      .fillColor(COLORS.primary)
      .text(title, MARGIN_LEFT, this.y, { width: CONTENT_WIDTH });
    this.y = this.doc.y + 4;
    this.doc
      .moveTo(MARGIN_LEFT, this.y)
      .lineTo(PAGE_WIDTH - MARGIN_RIGHT, this.y)
      .strokeColor(COLORS.border)
      .lineWidth(0.5)
      .stroke();
    this.y += 8;
  }

  private addSummaryCards(summary: {
    income: number;
    expenses: number;
    netBalance?: number;
    savingsRate?: number;
    transactionCount?: number;
  }) {
    this.checkPage(90);
    this.addSectionTitle("Financial Summary");
    const cardWidth = (CONTENT_WIDTH - 32) / 3;
    const cardHeight = 60;
    const cards: Array<{ label: string; value: string; color: string }> = [
      { label: "Total Income", value: fmtCurrency(summary.income), color: COLORS.accent },
      { label: "Total Expenses", value: fmtCurrency(summary.expenses), color: COLORS.danger },
      {
        label: "Net Balance",
        value: fmtCurrency(summary.netBalance ?? summary.income - summary.expenses),
        color:
          (summary.netBalance ?? summary.income - summary.expenses) >= 0
            ? COLORS.accent
            : COLORS.danger,
      },
    ];
    if (summary.savingsRate !== undefined)
      cards.push({
        label: "Savings Rate",
        value: `${summary.savingsRate.toFixed(1)}%`,
        color: summary.savingsRate >= 20 ? COLORS.accent : COLORS.warning,
      });
    if (summary.transactionCount !== undefined)
      cards.push({
        label: "Transactions",
        value: String(summary.transactionCount),
        color: COLORS.secondary,
      });
    const startX = MARGIN_LEFT;
    cards.forEach((card, i) => {
      const x = startX + i * (cardWidth + 16);
      this.doc
        .roundedRect(x, this.y, cardWidth, cardHeight, 6)
        .fillColor(COLORS.white)
        .fill()
        .roundedRect(x, this.y, cardWidth, cardHeight, 6)
        .lineWidth(1)
        .strokeColor(COLORS.border)
        .stroke();
      this.doc.rect(x, this.y, 4, cardHeight).fillColor(card.color).fill();
      this.doc
        .fontSize(8)
        .fillColor(COLORS.textSecondary)
        .text(card.label, x + 12, this.y + 8, { width: cardWidth - 20 });
      this.doc
        .fontSize(16)
        .fillColor(COLORS.textPrimary)
        .text(card.value, x + 12, this.y + 24, { width: cardWidth - 20 });
    });
    this.y += cardHeight + 12;
  }

  private addTransactionTable(transactions: any[]) {
    this.checkPage(60);
    this.addSectionTitle("Transactions");
    if (transactions.length === 0) {
      this.doc
        .fontSize(10)
        .fillColor(COLORS.textMuted)
        .text("No transactions found for this period.", MARGIN_LEFT, this.y);
      this.y += 20;
      return;
    }
    const colWidths = [100, 60, 65, 180, 100];
    const headers = ["Date", "Type", "Amount", "Description", "Category"];
    const tableX = MARGIN_LEFT;
    this.doc
      .rect(tableX, this.y, CONTENT_WIDTH, TABLE_ROW_HEIGHT + 4)
      .fillColor(COLORS.bgHeader)
      .fill();
    let hx = tableX + 8;
    headers.forEach((header, i) => {
      this.doc
        .fontSize(9)
        .fillColor(COLORS.primary)
        .text(header, hx, this.y + 4, { width: colWidths[i], lineBreak: false });
      hx += colWidths[i];
    });
    this.y += TABLE_ROW_HEIGHT + 4;
    const displayTransactions = transactions.slice(0, 50);
    let rowIndex = 0;
    for (const tx of displayTransactions) {
      this.checkPage(TABLE_ROW_HEIGHT + 10);
      if (rowIndex % 2 === 1)
        this.doc
          .rect(tableX, this.y, CONTENT_WIDTH, TABLE_ROW_HEIGHT)
          .fillColor(COLORS.bgLight)
          .fill();
      hx = tableX + 8;
      const values = [
        fmtDate(tx.date),
        tx.type === "INCOME" ? "Income" : tx.type === "EXPENSE" ? "Expense" : tx.type,
        fmtCurrency(tx.amount),
        tx.description || "-",
        tx.categoryName || tx.category?.name || "-",
      ];
      values.forEach((val, i) => {
        const displayVal = i === 3 ? truncateText(val, colWidths[i] - 10, this.doc) : val;
        const color =
          i === 2
            ? tx.type === "INCOME"
              ? COLORS.accent
              : tx.type === "EXPENSE"
                ? COLORS.danger
                : COLORS.textPrimary
            : COLORS.textPrimary;
        this.doc
          .fontSize(9)
          .fillColor(color)
          .text(displayVal, hx, this.y + 3, { width: colWidths[i], lineBreak: false });
        hx += colWidths[i];
      });
      this.y += TABLE_ROW_HEIGHT;
      rowIndex++;
    }
    if (transactions.length > 50) {
      this.doc
        .fontSize(9)
        .fillColor(COLORS.textMuted)
        .text(`... and ${transactions.length - 50} more transactions`, tableX, this.y + 2);
      this.y += 16;
    }
    this.y += 4;
  }

  private addCategorySummary(categories: any[]) {
    this.checkPage(40);
    this.addSectionTitle("Spending by Category");
    if (categories.length === 0) {
      this.doc
        .fontSize(10)
        .fillColor(COLORS.textMuted)
        .text("No spending data available.", MARGIN_LEFT, this.y);
      this.y += 20;
      return;
    }
    this.addMinimalTable(
      ["Category", "Total", "Count", "%"],
      categories.map((cat: any) => [
        cat.categoryName,
        fmtCurrency(cat.total),
        String(cat.count),
        cat.percentage !== undefined ? `${cat.percentage}%` : "-",
      ]),
    );
  }

  private addCategoryBreakdown(categories: any[]) {
    this.checkPage(40);
    this.addSectionTitle("Category Breakdown");
    if (categories.length === 0) {
      this.doc
        .fontSize(10)
        .fillColor(COLORS.textMuted)
        .text("No category data available.", MARGIN_LEFT, this.y);
      this.y += 20;
      return;
    }
    this.addMinimalTable(
      ["Category", "Total", "Count", "%"],
      categories.map((cat: any) => [
        cat.categoryName,
        fmtCurrency(cat.total),
        String(cat.count),
        cat.percentage !== undefined ? `${cat.percentage}%` : "-",
      ]),
    );
  }

  private addPaymentMethodSummary(paymentMethods: any[]) {
    this.checkPage(40);
    this.addSectionTitle("Payment Method Summary");
    if (paymentMethods.length === 0) {
      this.doc
        .fontSize(10)
        .fillColor(COLORS.textMuted)
        .text("No payment method data available.", MARGIN_LEFT, this.y);
      this.y += 20;
      return;
    }
    this.addMinimalTable(
      ["Method", "Income", "Expense", "Net", "Transactions"],
      paymentMethods.map((pm: any) => [
        pm.paymentMethodName || pm.method || "Unknown",
        fmtCurrency(pm.totalIncome ?? 0),
        fmtCurrency(pm.totalExpense ?? 0),
        fmtCurrency(pm.netAmount ?? 0),
        String(pm.transactionCount ?? 0),
      ]),
    );
  }

  private addBudgetPerformance(budgets: any[]) {
    this.checkPage(40);
    this.addSectionTitle("Budget Performance");
    if (budgets.length === 0) {
      this.doc
        .fontSize(10)
        .fillColor(COLORS.textMuted)
        .text("No budget data available.", MARGIN_LEFT, this.y);
      this.y += 20;
      return;
    }
    this.addMinimalTable(
      ["Category", "Budgeted", "Spent", "Remaining", "% Used", "Status"],
      budgets.map((bp: any) => [
        bp.categoryName,
        fmtCurrency(bp.budgeted),
        fmtCurrency(bp.spent),
        fmtCurrency(bp.remaining),
        `${bp.percentage}%`,
        bp.status === "critical"
          ? "⚠ Critical"
          : bp.status === "warning"
            ? "⚡ Warning"
            : "✅ On Track",
      ]),
    );
  }

  private addDetailedSummary(summary: any) {
    this.checkPage(60);
    this.addSectionTitle("Detailed Summary");
    this.addMinimalTable(
      ["Metric", "Value"],
      [
        ["Total Income", fmtCurrency(summary.income)],
        ["Total Expenses", fmtCurrency(summary.expenses)],
        ["Net Balance", fmtCurrency(summary.netBalance)],
        ["Savings Rate", `${summary.savingsRate}%`],
        ["Total Transactions", String(summary.transactionCount)],
        ["Income Transactions", String(summary.incomeCount)],
        ["Expense Transactions", String(summary.expenseCount)],
        ["Average Transaction", fmtCurrency(summary.averageTransactionAmount)],
        ["Average Income", fmtCurrency(summary.averageIncome)],
        ["Average Expense", fmtCurrency(summary.averageExpense)],
      ],
    );
  }

  private addMinimalTable(headers: string[], rows: string[][]) {
    if (rows.length === 0) return;
    const colCount = headers.length;
    const availableWidth = CONTENT_WIDTH - 16;
    const avgColWidth = Math.floor(availableWidth / colCount);
    const startX = MARGIN_LEFT;
    const rowHeight = 18;
    this.checkPage(rowHeight + 4 + rows.length * rowHeight + 10);
    this.doc
      .rect(startX, this.y, CONTENT_WIDTH, rowHeight + 2)
      .fillColor(COLORS.bgHeader)
      .fill();
    let hx = startX + 8;
    headers.forEach((header) => {
      this.doc
        .fontSize(8)
        .fillColor(COLORS.primary)
        .font("Helvetica-Bold")
        .text(header, hx, this.y + 3, { width: avgColWidth, lineBreak: false });
      hx += avgColWidth;
    });
    this.y += rowHeight + 2;
    rows.forEach((row, rowIdx) => {
      this.checkPage(rowHeight + 4);
      if (rowIdx % 2 === 1)
        this.doc.rect(startX, this.y, CONTENT_WIDTH, rowHeight).fillColor(COLORS.bgLight).fill();
      let rx = startX + 8;
      row.forEach((cell, cellIdx) => {
        this.doc.fontSize(8).font("Helvetica");
        const color =
          cell.startsWith("-$") ||
          (cell.startsWith("$") && cellIdx > 0 && row[0].includes("Expense"))
            ? COLORS.danger
            : cell.startsWith("$")
              ? COLORS.accent
              : COLORS.textPrimary;
        this.doc
          .fillColor(color)
          .text(truncateText(cell, avgColWidth - 4, this.doc), rx, this.y + 3, {
            width: avgColWidth,
            lineBreak: false,
          });
        rx += avgColWidth;
      });
      this.y += rowHeight;
    });
    this.y += 4;
  }

  private addInfoRow(label: string, value: string) {
    this.checkPage(LINE_HEIGHT + 6);
    this.doc.fontSize(10).fillColor(COLORS.textSecondary);
    this.doc.text(`  ${label}: `, MARGIN_LEFT, this.y, { continued: true });
    this.doc.fillColor(COLORS.textPrimary).text(value);
    this.y = this.doc.y + 2;
  }

  private addFooter() {
    const footerY = PAGE_HEIGHT - MARGIN_BOTTOM + 10;
    this.doc
      .moveTo(MARGIN_LEFT, footerY - 4)
      .lineTo(PAGE_WIDTH - MARGIN_RIGHT, footerY - 4)
      .strokeColor(COLORS.border)
      .lineWidth(0.5)
      .stroke();
    this.doc
      .fontSize(7)
      .fillColor(COLORS.textMuted)
      .text(`Generated on ${fmtDate(new Date())} by Expense Tracker Pro`, MARGIN_LEFT, footerY, {
        align: "center",
        width: CONTENT_WIDTH,
      });
  }
}

// ─── Exports ───────────────────────────────────────────────────

export const pdfExportService = {
  async generateReportPdf(
    userId: string,
    query: {
      type: string;
      date?: string;
      year?: number;
      month?: number;
      startDate?: string;
      endDate?: string;
      savingsGoalId?: string;
      orientation?: "portrait" | "landscape";
    },
    userEmail?: string,
  ): Promise<Buffer> {
    const generator = new ReportPdfGenerator(userEmail, query.orientation);
    return generator.generateReportPdf(userId, query);
  },

  async generateTransactionsPdf(
    userId: string,
    filters: Record<string, unknown>,
    userEmail?: string,
  ): Promise<Buffer> {
    const generator = new ReportPdfGenerator(userEmail);
    return generator.generateTransactionsPdf(userId, filters);
  },
};
