import ExcelJS from "exceljs";
import { reportService } from "../reports/reports.service.js";
import { reportRepository } from "../reports/reports.repository.js";
import { budgetRepository } from "../budgets/budgets.repository.js";
import { savingsGoalRepository } from "../savings-goals/savings-goals.repository.js";
import type {
  ColumnName,
  ExportTransactionsQuery,
  ExportTransactionsXlsxResult,
} from "./exports.types.js";

// ─── Style Constants ──────────────────────────────────────────

const STYLES = {
  header: {
    font: { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } },
    fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF1E40AF" } },
    alignment: { vertical: "middle" as const, horizontal: "center" as const },
    border: {
      top: { style: "thin" as const, color: { argb: "FF2563EB" } },
      bottom: { style: "thin" as const, color: { argb: "FF2563EB" } },
      left: { style: "thin" as const, color: { argb: "FF2563EB" } },
      right: { style: "thin" as const, color: { argb: "FF2563EB" } },
    },
  },
  section: {
    font: { name: "Calibri", size: 13, bold: true, color: { argb: "FF1E40AF" } },
    fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFEFF6FF" } },
  },
  subSection: {
    font: { name: "Calibri", size: 11, bold: true, color: { argb: "FF3B82F6" } },
  },
  data: {
    font: { name: "Calibri", size: 10 },
    alignment: { vertical: "middle" as const },
    border: {
      top: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
      bottom: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
      left: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
      right: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
    },
  },
  currency: {
    numFmt: '$#,##0.00_);($#,##0.00);"$0.00"',
  },
  date: {
    numFmt: "yyyy-mm-dd",
  },
  label: {
    font: { name: "Calibri", size: 10, bold: true, color: { argb: "FF6B7280" } },
    alignment: { vertical: "middle" as const },
    fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF9FAFB" } },
  },
  value: {
    font: { name: "Calibri", size: 10 },
    alignment: { vertical: "middle" as const },
  },
  income: {
    font: { name: "Calibri", size: 10, color: { argb: "FF059669" } },
  },
  expense: {
    font: { name: "Calibri", size: 10, color: { argb: "FFDC2626" } },
  },
  alternating: {
    fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF9FAFB" } },
  },
};

// ─── Column Definitions ───────────────────────────────────────

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

function resolveColumns(columns?: ColumnName[]): Array<{ key: ColumnName; label: string }> {
  if (!columns || columns.length === 0) return ALL_COLUMNS;
  return ALL_COLUMNS.filter((c) => columns.includes(c.key));
}

// ─── Helper: Auto-size Columns ────────────────────────────────

function autoSizeColumns(worksheet: ExcelJS.Worksheet, minWidth = 10, maxWidth = 50): void {
  worksheet.columns.forEach((column) => {
    if (column.eachCell) {
      let maxLength = 0;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const val = cell.value;
        let cellLength = 0;
        if (val === null || val === undefined) {
          cellLength = 0;
        } else if (typeof val === "string") {
          cellLength = val.length;
        } else if (typeof val === "number") {
          cellLength = String(val).length + 3; // padding for formatting
        } else if (val instanceof Date) {
          cellLength = 12; // yyyy-mm-dd
        } else {
          cellLength = String(val).length;
        }
        if (cellLength > maxLength) {
          maxLength = cellLength;
        }
      });
      column.width = Math.min(Math.max(maxLength + 3, minWidth), maxWidth);
    }
  });
}

// ─── Helper: Add Styled Table ─────────────────────────────────

interface TableColumn {
  header: string;
  key: string;
  width?: number;
  isCurrency?: boolean;
  isDate?: boolean;
}

function addTable(
  worksheet: ExcelJS.Worksheet,
  columns: TableColumn[],
  data: Record<string, unknown>[],
  startRow: number,
): number {
  let row = startRow;

  // Header row
  const headerRow = worksheet.getRow(row);
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.font = STYLES.header.font;
    cell.fill = STYLES.header.fill;
    cell.alignment = STYLES.header.alignment;
    cell.border = STYLES.header.border;
  });
  headerRow.commit();
  row++;

  // Set column widths based on header/content
  const colWidths = columns.map((col) => {
    if (col.width) return col.width;
    const headerLen = col.header.length;
    const maxDataLen = data.reduce((max, d) => {
      const val = d[col.key];
      const len = val == null ? 0 : String(val).length;
      return Math.max(max, len);
    }, 0);
    return Math.min(Math.max(Math.max(headerLen, maxDataLen) + 4, 10), 50);
  });

  // Data rows
  data.forEach((item, i) => {
    const dataRow = worksheet.getRow(row);
    columns.forEach((col, j) => {
      const cell = dataRow.getCell(j + 1);
      const val = item[col.key];

      if (col.isDate && val) {
        cell.value = val instanceof Date ? val : new Date(val as string);
        cell.numFmt = STYLES.date.numFmt;
      } else if (col.isCurrency && typeof val === "number") {
        cell.value = val;
        cell.numFmt = STYLES.currency.numFmt;
      } else {
        cell.value = val as string | number | boolean | null | undefined;
      }

      // Apply data style
      cell.font = STYLES.data.font;
      cell.alignment = {
        ...STYLES.data.alignment,
        ...(col.isCurrency ? { horizontal: "right" } : col.isDate ? { horizontal: "center" } : {}),
      };
      cell.border = STYLES.data.border;

      // Alternating rows
      if (i % 2 === 1) {
        cell.fill = STYLES.alternating.fill;
      }
    });
    row++;
  });

  // Set column widths
  colWidths.forEach((width, i) => {
    worksheet.getColumn(i + 1).width = width;
  });

  return row;
}

// ─── Helper: Add Section Title ────────────────────────────────

function addSectionTitle(worksheet: ExcelJS.Worksheet, title: string, row: number): number {
  const sectionRow = worksheet.getRow(row);
  const cell = sectionRow.getCell(1);
  cell.value = title;
  cell.font = STYLES.section.font;
  cell.fill = STYLES.section.fill;
  // Merge across a reasonable range
  worksheet.mergeCells(row, 1, row, 8);
  sectionRow.height = 24;
  return row + 1;
}

// ─── Helper: Add Sub-Section Title ────────────────────────────

function addSubSectionTitle(worksheet: ExcelJS.Worksheet, title: string, row: number): number {
  const sectionRow = worksheet.getRow(row);
  const cell = sectionRow.getCell(1);
  cell.value = title;
  cell.font = STYLES.subSection.font;
  sectionRow.height = 20;
  return row + 1;
}

// ─── Helper: Add Key-Value Pair Row ───────────────────────────

function addKvRow(
  worksheet: ExcelJS.Worksheet,
  key: string,
  value: string | number,
  row: number,
): number {
  const kvRow = worksheet.getRow(row);
  const labelCell = kvRow.getCell(1);
  labelCell.value = key;
  labelCell.font = STYLES.label.font;
  labelCell.alignment = STYLES.label.alignment;
  labelCell.fill = STYLES.label.fill;

  const valCell = kvRow.getCell(2);
  valCell.value = value;
  valCell.font = STYLES.value.font;
  valCell.alignment = STYLES.value.alignment;

  // Set column widths for key-value section
  worksheet.getColumn(1).width = Math.max(worksheet.getColumn(1).width || 18, 18);
  worksheet.getColumn(2).width = Math.max(worksheet.getColumn(2).width || 20, 20);

  return row + 1;
}

// ─── Helper: Add Empty Row ────────────────────────────────────

function addEmptyRow(worksheet: ExcelJS.Worksheet, row: number): number {
  worksheet.getRow(row).height = 6;
  return row + 1;
}

// ─── Helper: Build DB Filters ─────────────────────────────────

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

// ─── Helper: Format Transaction Data for Tables ───────────────

function formatTransactionsForTable(
  transactions: Array<{
    id: string;
    date: Date;
    type: string;
    amount: number;
    description: string;
    category: { name: string } | { name: string };
    categoryName?: string;
    paymentMethod?: { name: string } | null;
    notes?: string | null;
  }>,
  cols: Array<{ key: ColumnName; label: string }>,
): Record<string, unknown>[] {
  return transactions.map((tx) => {
    const row: Record<string, unknown> = {};
    cols.forEach((col) => {
      switch (col.key) {
        case "id":
          row[col.key] = tx.id;
          break;
        case "date":
          row[col.key] = new Date(tx.date);
          break;
        case "type":
          row[col.key] = tx.type;
          break;
        case "amount":
          row[col.key] = tx.amount;
          break;
        case "description":
          row[col.key] = tx.description;
          break;
        case "category":
          row[col.key] = (tx as any).categoryName || tx.category?.name || "";
          break;
        case "paymentmethod":
          row[col.key] = tx.paymentMethod?.name ?? "";
          break;
        case "notes":
          row[col.key] = tx.notes ?? "";
          break;
      }
    });
    return row;
  });
}

// ─── Main Service ─────────────────────────────────────────────

export const xlsxExportService = {
  /**
   * Generate an Excel (xlsx) buffer for transactions matching the given filters.
   */
  async generateTransactionsXlsx(
    userId: string,
    filters: ExportTransactionsQuery,
  ): Promise<ExportTransactionsXlsxResult> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Expense Tracker Pro";
    workbook.created = new Date();

    const ws = workbook.addWorksheet("Transactions");

    const dbFilters = await buildDbFilters(userId, filters);

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10000;
    const skip = (page - 1) * limit;

    const [totalCount, transactions] = await Promise.all([
      reportRepository.countCustomTransactions(
        userId,
        dbFilters as Parameters<typeof reportRepository.countCustomTransactions>[1],
      ),
      reportRepository.findCustomTransactions(
        userId,
        dbFilters as Parameters<typeof reportRepository.findCustomTransactions>[1],
        { skip, take: limit },
        { sortBy: filters.sortBy, sortOrder: filters.sortOrder },
      ),
    ]);

    const cols = resolveColumns(filters.columns);
    const tableCols: TableColumn[] = cols.map((c) => ({
      header: c.label,
      key: c.key,
      isCurrency: c.key === "amount",
      isDate: c.key === "date",
    }));

    const data = formatTransactionsForTable(transactions as any, cols);
    addTable(ws, tableCols, data, 1);

    autoSizeColumns(ws);

    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;

    return { buffer, totalCount, page, limit: Math.min(limit, totalCount), totalPages };
  },

  /**
   * Generate an Excel buffer for a report of the given type.
   */
  async generateReportXlsx(
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
  ): Promise<Buffer> {
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
        return this.generateDailyReportXlsx(
          userId,
          query.date ?? new Date().toISOString().slice(0, 10),
        );
      case "weekly":
        return this.generateWeeklyReportXlsx(
          userId,
          query.date ?? new Date().toISOString().slice(0, 10),
        );
      case "monthly":
        return this.generateMonthlyReportXlsx(
          userId,
          query.year ?? new Date().getFullYear(),
          query.month ?? new Date().getMonth() + 1,
        );
      case "yearly":
        return this.generateYearlyReportXlsx(userId, query.year ?? new Date().getFullYear());
      case "summary":
        return this.generateSummaryXlsx(userId, query.startDate, query.endDate, goalInfo);
      case "breakdown":
        return this.generateBreakdownXlsx(userId, query.startDate, query.endDate);
      default:
        throw new Error(`Unknown report type: ${query.type}`);
    }
  },

  // ─── Daily Report ───────────────────────────────────────────

  async generateDailyReportXlsx(userId: string, dateStr: string): Promise<Buffer> {
    const report = await reportService.getDailyReport(userId, dateStr);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Expense Tracker Pro";

    const ws = workbook.addWorksheet("Daily Report");

    let row = 1;
    row = addSectionTitle(ws, `Daily Report - ${report.date}`, row);
    row = addEmptyRow(ws, row);

    row = addKvRow(ws, "Income", report.income, row);
    row = addKvRow(ws, "Expenses", report.expenses, row);
    row = addKvRow(ws, "Balance", report.balance, row);
    row = addKvRow(ws, "Transactions", report.transactionCount, row);

    // Apply currency format to income/expense/balance
    ws.getRow(row - 3).getCell(2).numFmt = STYLES.currency.numFmt;
    ws.getRow(row - 2).getCell(2).numFmt = STYLES.currency.numFmt;
    ws.getRow(row - 1).getCell(2).numFmt = STYLES.currency.numFmt;

    row = addEmptyRow(ws, row);

    // Transactions table
    row = addSubSectionTitle(ws, "Transactions", row);
    const txCols: TableColumn[] = [
      { header: "Date", key: "date", isDate: true },
      { header: "Type", key: "type" },
      { header: "Amount", key: "amount", isCurrency: true },
      { header: "Description", key: "description" },
      { header: "Category", key: "category" },
    ];
    const txData = report.transactions.map((tx: any) => ({
      date: new Date(tx.date),
      type: tx.type,
      amount: tx.amount,
      description: tx.description,
      category: tx.categoryName,
    }));
    row = addTable(ws, txCols, txData, row);
    row = addEmptyRow(ws, row);

    // Category breakdown
    row = addSubSectionTitle(ws, "Spending by Category", row);
    const catCols: TableColumn[] = [
      { header: "Category", key: "category" },
      { header: "Total", key: "total", isCurrency: true },
      { header: "Count", key: "count" },
    ];
    const catData = report.spendingByCategory.map((cat: any) => ({
      category: cat.categoryName,
      total: cat.total,
      count: cat.count,
    }));
    addTable(ws, catCols, catData, row);

    autoSizeColumns(ws);
    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  },

  // ─── Weekly Report ──────────────────────────────────────────

  async generateWeeklyReportXlsx(userId: string, dateStr: string): Promise<Buffer> {
    const report = await reportService.getWeeklyReport(userId, dateStr);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Expense Tracker Pro";

    // ── Summary Worksheet ──
    const ws = workbook.addWorksheet("Summary");

    let row = 1;
    row = addSectionTitle(ws, `Weekly Report - ${report.weekLabel}`, row);
    row = addEmptyRow(ws, row);

    row = addKvRow(ws, "Income", report.income, row);
    row = addKvRow(ws, "Expenses", report.expenses, row);
    row = addKvRow(ws, "Balance", report.balance, row);
    row = addKvRow(ws, "Transactions", report.transactionCount, row);

    ws.getRow(row - 3).getCell(2).numFmt = STYLES.currency.numFmt;
    ws.getRow(row - 2).getCell(2).numFmt = STYLES.currency.numFmt;
    ws.getRow(row - 1).getCell(2).numFmt = STYLES.currency.numFmt;

    row = addEmptyRow(ws, row);

    // Daily breakdown
    row = addSubSectionTitle(ws, "Daily Breakdown", row);
    const dayCols: TableColumn[] = [
      { header: "Date", key: "date", isDate: true },
      { header: "Day", key: "day" },
      { header: "Income", key: "income", isCurrency: true },
      { header: "Expenses", key: "expenses", isCurrency: true },
      { header: "Transactions", key: "count" },
    ];
    const dayData = report.dailyBreakdown.map((day: any) => ({
      date: new Date(day.date),
      day: day.dayName,
      income: day.income,
      expenses: day.expenses,
      count: day.transactionCount,
    }));
    row = addTable(ws, dayCols, dayData, row);
    row = addEmptyRow(ws, row);

    // Spending by Category
    row = addSubSectionTitle(ws, "Spending by Category", row);
    const catCols: TableColumn[] = [
      { header: "Category", key: "category" },
      { header: "Total", key: "total", isCurrency: true },
      { header: "Count", key: "count" },
    ];
    const catData = report.spendingByCategory.map((cat: any) => ({
      category: cat.categoryName,
      total: cat.total,
      count: cat.count,
    }));
    addTable(ws, catCols, catData, row);

    autoSizeColumns(ws);

    // ── Transactions Worksheet ──
    const ws2 = workbook.addWorksheet("Transactions");
    const txCols: TableColumn[] = [
      { header: "Date", key: "date", isDate: true },
      { header: "Type", key: "type" },
      { header: "Amount", key: "amount", isCurrency: true },
      { header: "Description", key: "description" },
      { header: "Category", key: "category" },
    ];
    const txData = report.transactions.map((tx: any) => ({
      date: new Date(tx.date),
      type: tx.type,
      amount: tx.amount,
      description: tx.description,
      category: tx.categoryName,
    }));
    addTable(ws2, txCols, txData, 1);
    autoSizeColumns(ws2);

    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  },

  // ─── Monthly Report ─────────────────────────────────────────

  async generateMonthlyReportXlsx(userId: string, year: number, month: number): Promise<Buffer> {
    const report = await reportService.getMonthlyReport(userId, year, month);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Expense Tracker Pro";

    const ws = workbook.addWorksheet("Summary");

    let row = 1;
    row = addSectionTitle(ws, `Monthly Report - ${report.label}`, row);
    row = addEmptyRow(ws, row);

    row = addKvRow(ws, "Income", report.income, row);
    row = addKvRow(ws, "Expenses", report.expenses, row);
    row = addKvRow(ws, "Net Savings", report.netSavings, row);
    row = addKvRow(ws, "Transactions", report.transactionCount, row);

    ws.getRow(row - 3).getCell(2).numFmt = STYLES.currency.numFmt;
    ws.getRow(row - 2).getCell(2).numFmt = STYLES.currency.numFmt;
    ws.getRow(row - 1).getCell(2).numFmt = STYLES.currency.numFmt;

    row = addEmptyRow(ws, row);

    // Category Summary
    row = addSubSectionTitle(ws, "Category Summary", row);
    const catCols: TableColumn[] = [
      { header: "Category", key: "category" },
      { header: "Total", key: "total", isCurrency: true },
      { header: "Count", key: "count" },
      { header: "% of Expenses", key: "percentage" },
    ];
    const catData = report.categorySummary.map((cat: any) => ({
      category: cat.categoryName,
      total: cat.total,
      count: cat.count,
      percentage: `${cat.percentage}%`,
    }));
    row = addTable(ws, catCols, catData, row);
    row = addEmptyRow(ws, row);

    // Payment Method Summary
    row = addSubSectionTitle(ws, "Payment Method Summary", row);
    const pmCols: TableColumn[] = [
      { header: "Method", key: "method" },
      { header: "Income", key: "income", isCurrency: true },
      { header: "Expense", key: "expense", isCurrency: true },
      { header: "Net", key: "net", isCurrency: true },
      { header: "Transactions", key: "count" },
    ];
    const pmData = report.paymentMethodSummary.map((pm: any) => ({
      method: pm.paymentMethodName,
      income: pm.totalIncome,
      expense: pm.totalExpense,
      net: pm.netAmount,
      count: pm.transactionCount,
    }));
    row = addTable(ws, pmCols, pmData, row);
    row = addEmptyRow(ws, row);

    // Budget Performance
    if (report.budgetPerformance.length > 0) {
      row = addSubSectionTitle(ws, "Budget Performance", row);
      const budgetCols: TableColumn[] = [
        { header: "Category", key: "category" },
        { header: "Budgeted", key: "budgeted", isCurrency: true },
        { header: "Spent", key: "spent", isCurrency: true },
        { header: "Remaining", key: "remaining", isCurrency: true },
        { header: "% Used", key: "percentage" },
        { header: "Status", key: "status" },
      ];
      const budgetData = report.budgetPerformance.map((bp: any) => ({
        category: bp.categoryName,
        budgeted: bp.budgeted,
        spent: bp.spent,
        remaining: bp.remaining,
        percentage: `${bp.percentage}%`,
        status:
          bp.status === "critical" ? "Critical" : bp.status === "warning" ? "Warning" : "On Track",
      }));
      addTable(ws, budgetCols, budgetData, row);
    }

    autoSizeColumns(ws);
    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  },

  // ─── Yearly Report ──────────────────────────────────────────

  async generateYearlyReportXlsx(userId: string, year: number): Promise<Buffer> {
    const report = await reportService.getYearlyReport(userId, year);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Expense Tracker Pro";

    const ws = workbook.addWorksheet("Summary");

    let row = 1;
    row = addSectionTitle(ws, `Yearly Report - ${report.year}`, row);
    row = addEmptyRow(ws, row);

    row = addKvRow(ws, "Income", report.income, row);
    row = addKvRow(ws, "Expenses", report.expenses, row);
    row = addKvRow(ws, "Net Savings", report.netSavings, row);
    row = addKvRow(ws, "Transactions", report.transactionCount, row);

    ws.getRow(row - 3).getCell(2).numFmt = STYLES.currency.numFmt;
    ws.getRow(row - 2).getCell(2).numFmt = STYLES.currency.numFmt;
    ws.getRow(row - 1).getCell(2).numFmt = STYLES.currency.numFmt;

    row = addEmptyRow(ws, row);

    // Monthly Comparison
    row = addSubSectionTitle(ws, "Monthly Comparison", row);
    const monthCols: TableColumn[] = [
      { header: "Month", key: "month" },
      { header: "Income", key: "income", isCurrency: true },
      { header: "Expenses", key: "expenses", isCurrency: true },
      { header: "Net", key: "net", isCurrency: true },
    ];
    const monthData = report.monthlyComparison.map((mc: any) => ({
      month: mc.label,
      income: mc.income,
      expenses: mc.expenses,
      net: mc.net,
    }));
    row = addTable(ws, monthCols, monthData, row);
    row = addEmptyRow(ws, row);

    // Top Categories
    row = addSubSectionTitle(ws, "Top Categories", row);
    const catCols: TableColumn[] = [
      { header: "Category", key: "category" },
      { header: "Total", key: "total", isCurrency: true },
      { header: "Count", key: "count" },
      { header: "% of Expenses", key: "percentage" },
    ];
    const catData = report.topCategories.map((cat: any) => ({
      category: cat.categoryName,
      total: cat.total,
      count: cat.count,
      percentage: `${cat.percentage}%`,
    }));
    row = addTable(ws, catCols, catData, row);
    row = addEmptyRow(ws, row);

    // Budget Performance
    if (report.budgetPerformance.length > 0) {
      row = addSubSectionTitle(ws, "Budget Performance", row);
      const budgetCols: TableColumn[] = [
        { header: "Category", key: "category" },
        { header: "Budgeted", key: "budgeted", isCurrency: true },
        { header: "Spent", key: "spent", isCurrency: true },
        { header: "Remaining", key: "remaining", isCurrency: true },
        { header: "% Used", key: "percentage" },
        { header: "Status", key: "status" },
      ];
      const budgetData = report.budgetPerformance.map((bp: any) => ({
        category: bp.categoryName,
        budgeted: bp.budgeted,
        spent: bp.spent,
        remaining: bp.remaining,
        percentage: `${bp.percentage}%`,
        status:
          bp.status === "critical" ? "Critical" : bp.status === "warning" ? "Warning" : "On Track",
      }));
      addTable(ws, budgetCols, budgetData, row);
    }

    autoSizeColumns(ws);
    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  },

  // ─── Summary Report ─────────────────────────────────────────

  async generateSummaryXlsx(
    userId: string,
    startDate?: string,
    endDate?: string,
    goalInfo?: Record<string, unknown> | null,
  ): Promise<Buffer> {
    const summary = await reportService.getSummary(userId, startDate, endDate);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Expense Tracker Pro";

    const ws = workbook.addWorksheet("Summary");

    let row = 1;
    row = addSectionTitle(ws, "Report Summary", row);

    if (startDate || endDate) {
      row = addEmptyRow(ws, row);
      const periodStr = `${startDate ?? "earliest"} — ${endDate ?? "today"}`;
      row = addKvRow(ws, "Period", periodStr, row);
    }

    row = addEmptyRow(ws, row);

    // Key metrics
    row = addSubSectionTitle(ws, "Financial Overview", row);

    const metrics: Array<{ label: string; value: number | string }> = [
      { label: "Income", value: summary.income },
      { label: "Expenses", value: summary.expenses },
      { label: "Net Balance", value: summary.netBalance },
      { label: "Savings Rate", value: `${summary.savingsRate}%` },
      { label: "Total Transactions", value: summary.transactionCount },
      { label: "Income Transactions", value: summary.incomeCount },
      { label: "Expense Transactions", value: summary.expenseCount },
      { label: "Average Transaction", value: summary.averageTransactionAmount },
      { label: "Average Income", value: summary.averageIncome },
      { label: "Average Expense", value: summary.averageExpense },
    ];

    const metricCols: TableColumn[] = [
      { header: "Metric", key: "metric" },
      { header: "Value", key: "value" },
    ];
    const metricData = metrics.map((m) => ({ metric: m.label, value: m.value }));
    row = addTable(ws, metricCols, metricData, row);
    row = addEmptyRow(ws, row);

    // Apply currency formatting to metric values
    for (let r = row - metrics.length - 2; r < row - 2; r++) {
      const label = ws.getRow(r).getCell(1).value;
      if (
        label &&
        [
          "Income",
          "Expenses",
          "Net Balance",
          "Average Transaction",
          "Average Income",
          "Average Expense",
        ].includes(String(label))
      ) {
        ws.getRow(r).getCell(2).numFmt = STYLES.currency.numFmt;
      }
    }

    // Savings Goal info
    if (goalInfo) {
      row = addEmptyRow(ws, row);
      row = addSubSectionTitle(ws, "Savings Goal", row);
      const g = goalInfo as Record<string, unknown>;
      row = addKvRow(ws, "Goal", String(g.name ?? ""), row);
      row = addKvRow(ws, "Target", Number(g.targetAmount ?? 0), row);
      ws.getRow(row - 1).getCell(2).numFmt = STYLES.currency.numFmt;
      row = addKvRow(ws, "Saved", Number(g.currentAmount ?? 0), row);
      ws.getRow(row - 1).getCell(2).numFmt = STYLES.currency.numFmt;
      row = addKvRow(ws, "Progress", `${g.progress ?? 0}%`, row);
      row = addKvRow(ws, "Remaining", Number(g.remaining ?? 0), row);
      ws.getRow(row - 1).getCell(2).numFmt = STYLES.currency.numFmt;
      if (g.daysRemaining !== undefined && g.daysRemaining !== null) {
        row = addKvRow(ws, "Days Remaining", String(g.daysRemaining), row);
      }
      row = addKvRow(ws, "Status", g.isCompleted ? "Completed" : "In Progress", row);
    }

    autoSizeColumns(ws);
    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  },

  // ─── Breakdown Report ───────────────────────────────────────

  async generateBreakdownXlsx(
    userId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<Buffer> {
    const breakdown = await reportService.getBreakdown(userId, startDate, endDate);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Expense Tracker Pro";

    const ws = workbook.addWorksheet("Income vs Expense");

    let row = 1;
    row = addSectionTitle(ws, "Income vs Expense", row);
    row = addEmptyRow(ws, row);

    const ieCols: TableColumn[] = [
      { header: "Metric", key: "metric" },
      { header: "Value", key: "value" },
    ];
    const ieData = [
      { metric: "Income", value: breakdown.incomeVsExpense.income },
      { metric: "Expenses", value: breakdown.incomeVsExpense.expenses },
      { metric: "Net", value: breakdown.incomeVsExpense.net },
      { metric: "Income Count", value: breakdown.incomeVsExpense.incomeCount },
      { metric: "Expense Count", value: breakdown.incomeVsExpense.expenseCount },
      { metric: "Income %", value: `${breakdown.incomeVsExpense.incomePercentage}%` },
      { metric: "Expense %", value: `${breakdown.incomeVsExpense.expensePercentage}%` },
    ];
    row = addTable(ws, ieCols, ieData, row);

    // Apply currency format
    for (let r = row - 7; r < row - 4; r++) {
      ws.getRow(r).getCell(2).numFmt = STYLES.currency.numFmt;
    }

    row = addEmptyRow(ws, row);

    // Category Breakdown worksheet
    const ws2 = workbook.addWorksheet("Category Breakdown");
    row = 1;
    row = addSectionTitle(ws2, "Category Breakdown", row);
    row = addEmptyRow(ws2, row);

    const catCols: TableColumn[] = [
      { header: "Category", key: "category" },
      { header: "Total", key: "total", isCurrency: true },
      { header: "Count", key: "count" },
      { header: "%", key: "percentage" },
    ];
    const catData = breakdown.categoryBreakdown.map((cat: any) => ({
      category: cat.categoryName,
      total: cat.total,
      count: cat.count,
      percentage: `${cat.percentage}%`,
    }));
    row = addTable(ws2, catCols, catData, row);

    autoSizeColumns(ws2);

    // Payment Method Breakdown worksheet
    const ws3 = workbook.addWorksheet("Payment Methods");
    row = 1;
    row = addSectionTitle(ws3, "Payment Method Breakdown", row);
    row = addEmptyRow(ws3, row);

    const pmCols: TableColumn[] = [
      { header: "Method", key: "method" },
      { header: "Income", key: "income", isCurrency: true },
      { header: "Expense", key: "expense", isCurrency: true },
      { header: "Net", key: "net", isCurrency: true },
      { header: "Transactions", key: "count" },
    ];
    const pmData = breakdown.paymentMethodBreakdown.map((pm: any) => ({
      method: pm.paymentMethodName,
      income: pm.totalIncome,
      expense: pm.totalExpense,
      net: pm.netAmount,
      count: pm.transactionCount,
    }));
    row = addTable(ws3, pmCols, pmData, row);

    autoSizeColumns(ws3);

    // Largest / Smallest worksheet
    const ws4 = workbook.addWorksheet("Extremes");
    row = 1;

    if (breakdown.largestTransaction) {
      row = addSectionTitle(ws4, "Largest Transaction", row);
      row = addEmptyRow(ws4, row);
      const lt = breakdown.largestTransaction as any;
      row = addKvRow(ws4, "Amount", lt.amount, row);
      ws4.getRow(row - 1).getCell(2).numFmt = STYLES.currency.numFmt;
      row = addKvRow(ws4, "Description", lt.description, row);
      row = addKvRow(ws4, "Category", lt.categoryName, row);
      row = addKvRow(ws4, "Type", lt.type, row);
      row = addKvRow(ws4, "Date", new Date(lt.date).toISOString().slice(0, 10), row);
      row = addEmptyRow(ws4, row);
    }

    if (breakdown.smallestTransaction) {
      row = addSectionTitle(ws4, "Smallest Transaction", row);
      row = addEmptyRow(ws4, row);
      const st = breakdown.smallestTransaction as any;
      row = addKvRow(ws4, "Amount", st.amount, row);
      ws4.getRow(row - 1).getCell(2).numFmt = STYLES.currency.numFmt;
      row = addKvRow(ws4, "Description", st.description, row);
      row = addKvRow(ws4, "Category", st.categoryName, row);
      row = addKvRow(ws4, "Type", st.type, row);
      row = addKvRow(ws4, "Date", new Date(st.date).toISOString().slice(0, 10), row);
    }

    autoSizeColumns(ws4);
    autoSizeColumns(ws);

    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  },
};
