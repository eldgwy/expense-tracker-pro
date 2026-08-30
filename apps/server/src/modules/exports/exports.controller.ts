import type { Response, NextFunction } from "express";
import { exportService } from "./exports.service.js";
import { pdfExportService } from "./exports.pdf.service.js";
import { xlsxExportService } from "./exports.xlsx.service.js";
import type { AuthenticatedRequest } from "../../common/types/index.js";

/**
 * Determine the export format from the query string.
 * Defaults to "csv" if not provided.
 */
function getFormat(req: AuthenticatedRequest): "csv" | "pdf" | "xlsx" {
  const format = req.query.format as string | undefined;
  if (format === "pdf") return "pdf";
  if (format === "xlsx") return "xlsx";
  return "csv";
}

/** Parse columns from query param (comma-separated string or pre-parsed array). */
function parseColumns(val: unknown): string[] | undefined {
  if (!val) return undefined;
  if (Array.isArray(val)) return val.map((c) => String(c).trim().toLowerCase());
  return String(val)
    .split(",")
    .map((c) => c.trim().toLowerCase());
}

/**
 * Set security headers on the response.
 * (Real rate-limit headers are provided by the global express-rate-limit middleware.)
 */
function setSecurityHeaders(res: Response): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
}

// ─── File Naming ────────────────────────────────────────────────

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const TYPE_LABELS: Record<string, string> = {
  EXPENSE: "expenses",
  INCOME: "income",
  TRANSFER: "transfers",
};

/** Today's date as YYYY-MM-DD string (cached once per request). */
const todayStr = () => new Date().toISOString().slice(0, 10);

/**
 * Build a descriptive export filename.
 */
function buildExportFilename(context: {
  type: "transactions" | "report";
  reportType?: string;
  transactionType?: string;
  format: string;
  date?: string;
  year?: number;
  month?: number;
  startDate?: string;
  endDate?: string;
}): string {
  const ext = context.format === "pdf" ? "pdf" : context.format === "xlsx" ? "xlsx" : "csv";

  if (context.type === "transactions") {
    const prefix = context.transactionType
      ? (TYPE_LABELS[context.transactionType] ?? "transactions")
      : "transactions";

    if (context.startDate && context.endDate) {
      return `${prefix}-${context.startDate}-to-${context.endDate}.${ext}`;
    }
    return `${prefix}-${context.date ?? todayStr()}.${ext}`;
  }

  const rt = context.reportType ?? "summary";

  switch (rt) {
    case "daily":
      return `daily-report-${context.date ?? todayStr()}.${ext}`;
    case "weekly":
      return `weekly-report-${context.date ?? todayStr()}.${ext}`;
    case "monthly": {
      const month = context.month ?? new Date().getMonth() + 1;
      const year = context.year ?? new Date().getFullYear();
      const monthName = MONTH_NAMES[month - 1] ?? "unknown";
      return `monthly-report-${monthName}-${year}.${ext}`;
    }
    case "yearly":
      return `yearly-report-${context.year ?? new Date().getFullYear()}.${ext}`;
    case "summary": {
      const range =
        context.startDate && context.endDate
          ? `${context.startDate}-to-${context.endDate}`
          : todayStr();
      return `summary-report-${range}.${ext}`;
    }
    case "breakdown": {
      const range =
        context.startDate && context.endDate
          ? `${context.startDate}-to-${context.endDate}`
          : todayStr();
      return `breakdown-report-${range}.${ext}`;
    }
    default:
      return `report-${rt}-${todayStr()}.${ext}`;
  }
}

export const exportController = {
  /**
   * GET /exports/transactions — Download transactions as CSV or PDF.
   * Supports filters + options: columns, sortBy, sortOrder, orientation (PDF), page, limit.
   * Sets X-Total-Count, X-Page, X-Per-Page headers for paginated exports.
   */
  async exportTransactions(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      setSecurityHeaders(res);

      const format = getFormat(req);
      const q = req.query as Record<string, unknown>;

      // Extract string fields (Zod leaves them as strings)
      const startDate = q.startDate as string | undefined;
      const endDate = q.endDate as string | undefined;
      const categoryId = q.categoryId as string | undefined;
      const paymentMethodId = q.paymentMethodId as string | undefined;
      const budgetId = q.budgetId as string | undefined;
      const savingsGoalId = q.savingsGoalId as string | undefined;
      const type = q.type as "INCOME" | "EXPENSE" | "TRANSFER" | undefined;
      const minAmount = q.minAmount as string | undefined;
      const maxAmount = q.maxAmount as string | undefined;
      const sortBy = q.sortBy as string | undefined;
      const sortOrder = q.sortOrder as string | undefined;
      const columnsRaw = q.columns;
      // Extract number fields (Zod transforms them from strings)
      const page = q.page as number | undefined;
      const limit = q.limit as number | undefined;

      const filters = {
        startDate,
        endDate,
        categoryId,
        paymentMethodId,
        budgetId,
        savingsGoalId,
        type,
        minAmount: minAmount ? Number(minAmount) : undefined,
        maxAmount: maxAmount ? Number(maxAmount) : undefined,
        sortBy: sortBy as "date" | "amount" | "description" | "type" | undefined,
        sortOrder: sortOrder as "asc" | "desc" | undefined,
        columns: parseColumns(columnsRaw) as any,
        page,
        limit,
      };

      if (format === "pdf") {
        const pdfBuffer = await pdfExportService.generateTransactionsPdf(
          req.user.id,
          filters as any,
          req.user.email,
        );
        const filename = buildExportFilename({
          type: "transactions",
          transactionType: type,
          format: "pdf",
          startDate,
          endDate,
          date: todayStr(),
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Length", pdfBuffer.length);
        res.end(pdfBuffer);
      } else if (format === "xlsx") {
        const result = await xlsxExportService.generateTransactionsXlsx(
          req.user.id,
          filters as any,
        );

        // Set pagination metadata headers
        res.setHeader("X-Total-Count", String(result.totalCount));
        res.setHeader("X-Page", String(result.page));
        res.setHeader("X-Per-Page", String(result.limit));
        res.setHeader("X-Total-Pages", String(result.totalPages));

        const filename = buildExportFilename({
          type: "transactions",
          transactionType: type,
          format: "xlsx",
          startDate,
          endDate,
          date: todayStr(),
        });

        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Length", result.buffer.length);
        res.end(result.buffer);
      } else {
        const result = await exportService.generateTransactionsCsv(req.user.id, filters);

        // Set pagination metadata headers
        res.setHeader("X-Total-Count", String(result.totalCount));
        res.setHeader("X-Page", String(result.page));
        res.setHeader("X-Per-Page", String(result.limit));
        res.setHeader("X-Total-Pages", String(result.totalPages));

        const filename = buildExportFilename({
          type: "transactions",
          transactionType: type,
          format: "csv",
          startDate,
          endDate,
          date: todayStr(),
        });

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(result.csv);
      }
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /exports/reports — Download a report as CSV or PDF.
   * Query params: type (required), format=csv|pdf (default: csv)
   */
  async exportReport(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      setSecurityHeaders(res);

      const format = getFormat(req);
      const q = req.query as Record<string, unknown>;

      const type = q.type as string | undefined;
      const year = q.year as string | undefined;
      const month = q.month as string | undefined;
      const date = q.date as string | undefined;
      const startDate = q.startDate as string | undefined;
      const endDate = q.endDate as string | undefined;
      const budgetId = q.budgetId as string | undefined;
      const savingsGoalId = q.savingsGoalId as string | undefined;
      const orientation = q.orientation as string | undefined;
      const sortBy = q.sortBy as string | undefined;
      const sortOrder = q.sortOrder as string | undefined;
      const columnsRaw = q.columns;

      const query = {
        type: type ?? "summary",
        year: year ? Number(year) : undefined,
        month: month ? Number(month) : undefined,
        date,
        startDate,
        endDate,
        budgetId,
        savingsGoalId,
        orientation: orientation as "portrait" | "landscape" | undefined,
        sortBy: sortBy as "date" | "amount" | "description" | "type" | undefined,
        sortOrder: sortOrder as "asc" | "desc" | undefined,
        columns: parseColumns(columnsRaw) as any,
      };

      if (format === "pdf") {
        const pdfBuffer = await pdfExportService.generateReportPdf(
          req.user.id,
          query,
          req.user.email,
        );
        const filename = buildExportFilename({
          type: "report",
          reportType: type ?? "summary",
          format: "pdf",
          date,
          year: year ? Number(year) : undefined,
          month: month ? Number(month) : undefined,
          startDate,
          endDate,
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Length", pdfBuffer.length);
        res.end(pdfBuffer);
      } else if (format === "xlsx") {
        const xlsxBuffer = await xlsxExportService.generateReportXlsx(req.user.id, query as any);
        const filename = buildExportFilename({
          type: "report",
          reportType: type ?? "summary",
          format: "xlsx",
          date,
          year: year ? Number(year) : undefined,
          month: month ? Number(month) : undefined,
          startDate,
          endDate,
        });

        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Length", xlsxBuffer.length);
        res.end(xlsxBuffer);
      } else {
        const csv = await exportService.generateReportCsv(req.user.id, query);
        const filename = buildExportFilename({
          type: "report",
          reportType: type ?? "summary",
          format: "csv",
          date,
          year: year ? Number(year) : undefined,
          month: month ? Number(month) : undefined,
          startDate,
          endDate,
        });

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(csv);
      }
    } catch (err) {
      next(err);
    }
  },
};
