/**
 * Exports XLSX Module — API Integration Tests
 *
 * Tests: Excel (xlsx) export of transactions and reports.
 *
 * Run: npx tsx src/modules/exports/exports.xlsx.test.ts
 *
 * Prerequisites: PostgreSQL running, migrations applied
 */

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, "../../../../.env") });

process.env.PORT = "4009";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-for-exports-xlsx-integration-tests";
process.env.JWT_EXPIRES_IN = "1h";
process.env.JWT_REFRESH_EXPIRES_IN = "7d";

import { createApp } from "../../app.js";
import type { Application } from "express";
import type { Server } from "node:http";

// ─── Test Runner ──────────────────────────────────────────────

let passed = 0;
let failed = 0;
let userTokens: { accessToken: string; refreshToken: string } | null = null;
let secondUserTokens: { accessToken: string; refreshToken: string } | null = null;
let testCategoryId: string | null = null;
let incomeCategoryId: string | null = null;
let testPaymentMethodId: string | null = null;
let server: Server;
let app: Application;

const BASE = "http://localhost:4009/api/v1";
const TEST_EMAIL = `xlsx-test-${Date.now()}@example.com`;
const TEST_PASSWORD = "Test@123456";
const SECOND_USER_EMAIL = `xlsx-test-2-${Date.now()}@example.com`;

async function request(
  method: string,
  path: string,
  reqBody?: unknown,
  token?: string | null,
): Promise<{ status: number; buffer: Buffer; contentType: string; disposition?: string }> {
  const headers: Record<string, string> = {};
  if (reqBody !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: reqBody ? JSON.stringify(reqBody) : undefined,
  });

  const status = response.status;
  const contentType = response.headers.get("content-type") ?? "";
  const disposition = response.headers.get("content-disposition") ?? undefined;
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return { status, buffer, contentType, disposition };
}

function assert(condition: unknown, label: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    failed++;
  }
}

// ─── XLSX Validation Helpers ───────────────────────────────────

/**
 * Check if the buffer starts with a valid XLSX signature (PK\x03\x04).
 */
function isXlsxSignature(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  const header = buffer.slice(0, 4).toString("hex");
  return header === "504b0304"; // ZIP file signature
}

/**
 * Check if buffer has reasonable size for a non-empty workbook.
 */
function hasReasonableSize(buffer: Buffer, minBytes = 500): boolean {
  return buffer.length >= minBytes;
}

/**
 * Parse Excel sheet names from the xlsx buffer using zip structure lookup.
 * XLSX files are ZIP archives; we look for the workbook.xml to find sheet names.
 */
function getSheetNames(buffer: Buffer): string[] {
  const bufStr = buffer.toString("utf8");
  const names: string[] = [];

  // Sheet names appear in workbook.xml as: sheet name="..."
  const sheetRegex = /sheet\s+name="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = sheetRegex.exec(bufStr)) !== null) {
    names.push(match[1]);
  }

  return names;
}

/**
 * Search for text within the xlsx buffer (shared strings, sheet data, etc.).
 * XLSX stores text in sharedStrings.xml and sheet data in sheet XML files.
 */
function xlsxContains(buffer: Buffer, text: string): boolean {
  const bufStr = buffer.toString("utf8").toLowerCase();
  return bufStr.includes(text.toLowerCase());
}

// ─── Tests ────────────────────────────────────────────────────

async function runTests() {
  console.log("\n🧪 Exports XLSX Module — API Integration Tests\n");
  console.log(`Test user: ${TEST_EMAIL}\n`);

  // ─── 0. Health Check ───────────────────────────────────────
  console.log("─── 0. Health Check ───");
  const health = await request("GET", "/health");
  assert(health.status === 200, "Health endpoint returns 200");

  // ─── 1. Register User & Set Up Test Data ───────────────────
  console.log("\n─── 1. Register & Create Test Data ───");
  const register = await request("POST", "/auth/register", {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    name: "XLSX Export Tester",
  });
  assert(register.status === 201, "Register returns 201");
  const registerJson = JSON.parse(register.buffer.toString());
  userTokens = registerJson.data?.tokens as { accessToken: string; refreshToken: string };
  assert(userTokens != null, "Register returns tokens");

  // Get default categories
  const defaultCats = await request("GET", "/categories", undefined, userTokens?.accessToken);
  assert(defaultCats.status === 200, "Default categories fetched");
  const catsJson = JSON.parse(defaultCats.buffer.toString());
  const cats = catsJson.data?.categories as Array<Record<string, unknown>> | undefined;

  const foodCat = cats?.find((c) => c.name === "Food");
  testCategoryId = (foodCat?.id as string) ?? null;
  assert(testCategoryId != null, "Found Food expense category");

  const salaryCat = cats?.find((c) => c.name === "Salary");
  incomeCategoryId = (salaryCat?.id as string) ?? null;
  assert(incomeCategoryId != null, "Found Salary income category");

  // Create a payment method
  const pm = await request(
    "POST",
    "/payment-methods",
    { type: "CREDIT_CARD", name: "Test Visa", lastFour: "1234" },
    userTokens?.accessToken,
  );
  assert(pm.status === 201, "Payment method created");
  const pmJson = JSON.parse(pm.buffer.toString());
  testPaymentMethodId =
    ((pmJson.data?.paymentMethod as Record<string, unknown>)?.id as string) ?? null;
  assert(testPaymentMethodId != null, "Payment method has ID");

  // Create transactions
  const today = new Date().toISOString().slice(0, 10);

  const tx1 = await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: 42.5,
      description: "Whole Foods Market",
      date: today,
      categoryId: testCategoryId,
      paymentMethodId: testPaymentMethodId,
    },
    userTokens?.accessToken,
  );
  assert(tx1.status === 201, "Created expense transaction");

  const tx2 = await request(
    "POST",
    "/transactions",
    {
      type: "INCOME",
      amount: 5000.0,
      description: "Monthly Paycheck",
      date: today,
      categoryId: incomeCategoryId,
    },
    userTokens?.accessToken,
  );
  assert(tx2.status === 201, "Created income transaction");

  // ─── 2. Export Transactions as XLSX ────────────────────────
  console.log("\n─── 2. Export Transactions (GET /exports/transactions?format=xlsx) ───");

  const xlsxTx = await request(
    "GET",
    "/exports/transactions?format=xlsx",
    undefined,
    userTokens?.accessToken,
  );
  assert(xlsxTx.status === 200, "Export transactions XLSX returns 200");
  assert(
    xlsxTx.contentType.includes("openxmlformats") || xlsxTx.contentType.includes("octet-stream"),
    `Content-Type includes openxmlformats (got: ${xlsxTx.contentType})`,
  );
  assert(isXlsxSignature(xlsxTx.buffer), "XLSX starts with PK (ZIP) signature");
  assert(hasReasonableSize(xlsxTx.buffer), "XLSX buffer has reasonable size");
  assert(xlsxContains(xlsxTx.buffer, "Transactions"), "XLSX has Transactions worksheet");
  assert(xlsxContains(xlsxTx.buffer, "42.50"), "XLSX contains expense amount 42.50");
  assert(xlsxContains(xlsxTx.buffer, "5000"), "XLSX contains income amount 5000");
  assert(
    xlsxContains(xlsxTx.buffer, "Whole Foods Market"),
    "XLSX contains transaction description",
  );
  assert(xlsxContains(xlsxTx.buffer, "Monthly Paycheck"), "XLSX contains income description");

  const txSheetNames = getSheetNames(xlsxTx.buffer);
  assert(txSheetNames.length >= 1, "XLSX has at least 1 worksheet");
  assert(txSheetNames.includes("Transactions"), "Worksheet is named 'Transactions'");

  // ─── 3. Export Transactions with XLSX + Format=xlsx ────────
  console.log("\n─── 3. Export Transactions with format=xlsx (explicit) ───");

  const xlsxTxExplicit = await request(
    "GET",
    "/exports/transactions?format=xlsx",
    undefined,
    userTokens?.accessToken,
  );
  assert(xlsxTxExplicit.status === 200, "Explicit format=xlsx returns 200");
  assert(isXlsxSignature(xlsxTxExplicit.buffer), "Explicit xlsx has valid signature");

  // ─── 4. Export Transactions with Filters (XLSX) ────────────
  console.log("\n─── 4. Export Transactions with Filters (XLSX) ───");

  // Filter by type EXPENSE
  const xlsxExpense = await request(
    "GET",
    "/exports/transactions?format=xlsx&type=EXPENSE",
    undefined,
    userTokens?.accessToken,
  );
  assert(xlsxExpense.status === 200, "XLSX expense filter returns 200");
  assert(xlsxContains(xlsxExpense.buffer, "42.50"), "XLSX expense filter contains 42.50");
  assert(
    !xlsxContains(xlsxExpense.buffer, "Paycheck"),
    "XLSX expense filter does not contain income",
  );

  // Filter by category
  const xlsxCat = await request(
    "GET",
    `/exports/transactions?format=xlsx&categoryId=${testCategoryId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(xlsxCat.status === 200, "XLSX category filter returns 200");
  assert(xlsxContains(xlsxCat.buffer, "Food"), "XLSX category filter contains Food");

  // ─── 5. Export Report - Daily (XLSX) ────────────────────────
  console.log("\n─── 5. Export Daily Report (GET /exports/reports?type=daily&format=xlsx) ───");

  const xlsxDaily = await request(
    "GET",
    `/exports/reports?type=daily&format=xlsx&date=${today}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(xlsxDaily.status === 200, "Export daily report XLSX returns 200");
  assert(isXlsxSignature(xlsxDaily.buffer), "Daily report XLSX has valid signature");
  assert(xlsxContains(xlsxDaily.buffer, "Daily Report"), "Daily XLSX has report title");
  assert(xlsxContains(xlsxDaily.buffer, "42.50"), "Daily XLSX contains expense");
  assert(xlsxContains(xlsxDaily.buffer, "5000"), "Daily XLSX contains income");
  assert(xlsxContains(xlsxDaily.buffer, "Whole Foods Market"), "Daily XLSX has transaction");

  const dailySheetNames = getSheetNames(xlsxDaily.buffer);
  assert(dailySheetNames.includes("Daily Report"), "Daily report has 'Daily Report' worksheet");

  // ─── 6. Export Report - Weekly (XLSX) ──────────────────────
  console.log("\n─── 6. Export Weekly Report (GET /exports/reports?type=weekly&format=xlsx) ───");

  const xlsxWeekly = await request(
    "GET",
    `/exports/reports?type=weekly&format=xlsx&date=${today}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(xlsxWeekly.status === 200, "Export weekly report XLSX returns 200");
  assert(isXlsxSignature(xlsxWeekly.buffer), "Weekly report XLSX has valid signature");
  assert(xlsxContains(xlsxWeekly.buffer, "Weekly Report"), "Weekly XLSX has report title");

  const weeklySheetNames = getSheetNames(xlsxWeekly.buffer);
  assert(weeklySheetNames.includes("Summary"), "Weekly has 'Summary' worksheet");
  assert(weeklySheetNames.includes("Transactions"), "Weekly has 'Transactions' worksheet");

  // ─── 7. Export Report - Monthly (XLSX) ─────────────────────
  console.log("\n─── 7. Export Monthly Report (GET /exports/reports?type=monthly&format=xlsx) ───");

  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = String(now.getMonth() + 1).padStart(2, "0");

  const xlsxMonthly = await request(
    "GET",
    `/exports/reports?type=monthly&format=xlsx&year=${thisYear}&month=${thisMonth}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(xlsxMonthly.status === 200, "Export monthly report XLSX returns 200");
  assert(isXlsxSignature(xlsxMonthly.buffer), "Monthly report XLSX has valid signature");
  assert(xlsxContains(xlsxMonthly.buffer, "Monthly Report"), "Monthly XLSX has report title");
  assert(xlsxContains(xlsxMonthly.buffer, "Category Summary"), "Monthly XLSX has category section");
  assert(xlsxContains(xlsxMonthly.buffer, "Food"), "Monthly XLSX has category name Food");

  // ─── 8. Export Report - Yearly (XLSX) ──────────────────────
  console.log("\n─── 8. Export Yearly Report (GET /exports/reports?type=yearly&format=xlsx) ───");

  const xlsxYearly = await request(
    "GET",
    `/exports/reports?type=yearly&format=xlsx&year=${thisYear}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(xlsxYearly.status === 200, "Export yearly report XLSX returns 200");
  assert(isXlsxSignature(xlsxYearly.buffer), "Yearly report XLSX has valid signature");
  assert(xlsxContains(xlsxYearly.buffer, "Yearly Report"), "Yearly XLSX has report title");
  assert(
    xlsxContains(xlsxYearly.buffer, "Monthly Comparison"),
    "Yearly XLSX has monthly comparison",
  );
  assert(xlsxContains(xlsxYearly.buffer, "Top Categories"), "Yearly XLSX has top categories");

  // ─── 9. Export Report - Summary (XLSX) ─────────────────────
  console.log("\n─── 9. Export Summary Report (GET /exports/reports?type=summary&format=xlsx) ───");

  const xlsxSummary = await request(
    "GET",
    "/exports/reports?type=summary&format=xlsx",
    undefined,
    userTokens?.accessToken,
  );
  assert(xlsxSummary.status === 200, "Export summary XLSX returns 200");
  assert(isXlsxSignature(xlsxSummary.buffer), "Summary XLSX has valid signature");
  assert(xlsxContains(xlsxSummary.buffer, "Report Summary"), "Summary XLSX has title");
  assert(xlsxContains(xlsxSummary.buffer, "5000"), "Summary XLSX contains income");
  assert(xlsxContains(xlsxSummary.buffer, "42.50"), "Summary XLSX contains expenses");

  // ─── 10. Export Report - Breakdown (XLSX) ──────────────────
  console.log(
    "\n─── 10. Export Breakdown Report (GET /exports/reports?type=breakdown&format=xlsx) ───",
  );

  const xlsxBreakdown = await request(
    "GET",
    "/exports/reports?type=breakdown&format=xlsx",
    undefined,
    userTokens?.accessToken,
  );
  assert(xlsxBreakdown.status === 200, "Export breakdown XLSX returns 200");
  assert(isXlsxSignature(xlsxBreakdown.buffer), "Breakdown XLSX has valid signature");
  assert(
    xlsxContains(xlsxBreakdown.buffer, "Income vs Expense"),
    "Breakdown XLSX has income/expense",
  );
  assert(
    xlsxContains(xlsxBreakdown.buffer, "Category Breakdown"),
    "Breakdown XLSX has category section",
  );
  assert(
    xlsxContains(xlsxBreakdown.buffer, "Payment Method Breakdown"),
    "Breakdown XLSX has payment method",
  );

  const breakdownSheetNames = getSheetNames(xlsxBreakdown.buffer);
  assert(
    breakdownSheetNames.includes("Income vs Expense"),
    "Breakdown has 'Income vs Expense' worksheet",
  );
  assert(
    breakdownSheetNames.includes("Category Breakdown"),
    "Breakdown has 'Category Breakdown' worksheet",
  );
  assert(
    breakdownSheetNames.includes("Payment Methods"),
    "Breakdown has 'Payment Methods' worksheet",
  );
  assert(breakdownSheetNames.includes("Extremes"), "Breakdown has 'Extremes' worksheet");

  // ─── 11. CSV Still Works ─────────────────────────────────────
  console.log("\n─── 11. CSV Export Still Works ───");

  const csvTx = await request("GET", "/exports/transactions", undefined, userTokens?.accessToken);
  assert(csvTx.status === 200, "CSV export still returns 200");
  assert(csvTx.contentType.includes("text/csv"), "CSV has text/csv content type");

  // ─── 12. Budget Filter (XLSX) ───────────────────────────────
  console.log("\n─── 12. Budget Filter (GET /exports/transactions?format=xlsx&budgetId=xxx) ───");

  const budget = await request(
    "POST",
    "/budgets",
    {
      targetAmount: 500,
      categoryId: testCategoryId,
      startDate: today,
      period: "MONTHLY",
    },
    userTokens?.accessToken,
  );
  assert(budget.status === 201, "Budget created");
  const budgetJson = JSON.parse(budget.buffer.toString());
  const budgetId = (budgetJson.data?.budget?.id as string) ?? (budgetJson.data?.id as string);

  const xlsxBudget = await request(
    "GET",
    `/exports/transactions?format=xlsx&budgetId=${budgetId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(xlsxBudget.status === 200, "XLSX budget filter returns 200");
  assert(xlsxContains(xlsxBudget.buffer, "42.50"), "XLSX budget filter contains expense");
  assert(
    !xlsxContains(xlsxBudget.buffer, "5000"),
    "XLSX budget filter does not contain income from other category",
  );

  // ─── 13. Savings Goal Filter (XLSX) ──────────────────────────
  console.log("\n─── 13. Savings Goal Filter (XLSX) ───");

  const goal = await request(
    "POST",
    "/savings-goals",
    {
      name: "Emergency Fund",
      targetAmount: 10000,
      deadline: "2027-01-01",
      priority: "HIGH",
    },
    userTokens?.accessToken,
  );
  assert(goal.status === 201, "Savings goal created");
  const goalJson = JSON.parse(goal.buffer.toString());
  const goalId = (goalJson.data?.savingsGoal?.id as string) ?? (goalJson.data?.id as string);

  const xlsxGoalSummary = await request(
    "GET",
    `/exports/reports?type=summary&format=xlsx&savingsGoalId=${goalId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(xlsxGoalSummary.status === 200, "XLSX savings goal on summary returns 200");
  assert(
    xlsxContains(xlsxGoalSummary.buffer, "Savings Goal"),
    "XLSX summary includes goal section",
  );
  assert(xlsxContains(xlsxGoalSummary.buffer, "Emergency Fund"), "XLSX summary contains goal name");
  assert(xlsxContains(xlsxGoalSummary.buffer, "10000"), "XLSX summary contains goal target");

  // ─── 14. File Naming (XLSX) ─────────────────────────────────
  console.log("\n─── 14. File Naming (Content-Disposition header for XLSX) ───");

  const fToday = new Date().toISOString().slice(0, 10);

  // Transactions: transactions-{date}.xlsx
  const fnTx = await request(
    "GET",
    "/exports/transactions?format=xlsx",
    undefined,
    userTokens?.accessToken,
  );
  assert(
    fnTx.disposition?.includes(`transactions-${fToday}.xlsx`),
    `Filename is transactions-${fToday}.xlsx (got: ${fnTx.disposition})`,
  );

  // Daily report: daily-report-{date}.xlsx
  const fnDaily = await request(
    "GET",
    `/exports/reports?type=daily&format=xlsx&date=${fToday}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(
    fnDaily.disposition?.includes(`daily-report-${fToday}.xlsx`),
    `Filename is daily-report-${fToday}.xlsx (got: ${fnDaily.disposition})`,
  );

  // Monthly report: monthly-report-{monthName}-{year}.xlsx
  const fMonth = now.getMonth() + 1;
  const fMonthName = [
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
  ][fMonth - 1];
  const fnMonthly = await request(
    "GET",
    `/exports/reports?type=monthly&format=xlsx&year=${thisYear}&month=${String(fMonth).padStart(2, "0")}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(
    fnMonthly.disposition?.includes(`monthly-report-${fMonthName}-${thisYear}.xlsx`),
    `Filename is monthly-report-${fMonthName}-${thisYear}.xlsx (got: ${fnMonthly.disposition})`,
  );

  // Summary report: summary-report-{date}.xlsx
  const fnSummary = await request(
    "GET",
    "/exports/reports?type=summary&format=xlsx",
    undefined,
    userTokens?.accessToken,
  );
  assert(
    fnSummary.disposition?.includes(`summary-report-${fToday}.xlsx`),
    `Filename is summary-report-${fToday}.xlsx (got: ${fnSummary.disposition})`,
  );

  // Expenses with date range: expenses-{startDate}-to-{endDate}.xlsx
  const fnRange = await request(
    "GET",
    "/exports/transactions?format=xlsx&type=EXPENSE&startDate=2026-01-01&endDate=2026-12-31",
    undefined,
    userTokens?.accessToken,
  );
  assert(
    fnRange.disposition?.includes("expenses-2026-01-01-to-2026-12-31.xlsx"),
    `Filename is expenses-2026-01-01-to-2026-12-31.xlsx (got: ${fnRange.disposition})`,
  );

  // ─── 15. Ownership Scoping ─────────────────────────────────
  console.log("\n─── 15. Ownership Verification ───");

  const register2 = await request("POST", "/auth/register", {
    email: SECOND_USER_EMAIL,
    password: TEST_PASSWORD,
    name: "Second User",
  });
  assert(register2.status === 201, "Second user registered");
  const register2Json = JSON.parse(register2.buffer.toString());
  secondUserTokens = register2Json.data?.tokens as { accessToken: string; refreshToken: string };

  // Second user's XLSX export has no transactions
  const secondXlsx = await request(
    "GET",
    "/exports/transactions?format=xlsx",
    undefined,
    secondUserTokens?.accessToken,
  );
  assert(secondXlsx.status === 200, "Second user XLSX export returns 200");
  // Should be a valid workbook with headers but no data
  assert(isXlsxSignature(secondXlsx.buffer), "Second user XLSX has valid signature");
  assert(
    !xlsxContains(secondXlsx.buffer, "Whole Foods Market"),
    "Second user XLSX does not have primary's transactions",
  );

  // Second user's summary has zero values
  const secondSummary = await request(
    "GET",
    "/exports/reports?type=summary&format=xlsx",
    undefined,
    secondUserTokens?.accessToken,
  );
  assert(secondSummary.status === 200, "Second user summary XLSX returns 200");
  assert(xlsxContains(secondSummary.buffer, "0.00"), "Second user summary has zero amounts");

  // ─── 16. Unauthenticated Access ────────────────────────────
  console.log("\n─── 16. Unauthenticated Access ───");

  const noAuthTx = await request("GET", "/exports/transactions?format=xlsx");
  assert(noAuthTx.status === 401, "Export transactions XLSX without auth returns 401");

  const noAuthReport = await request("GET", "/exports/reports?type=summary&format=xlsx");
  assert(noAuthReport.status === 401, "Export report XLSX without auth returns 401");

  // ─── 17. CSV and PDF Still Work Alongside XLSX ─────────────
  console.log("\n─── 17. CSV and PDF Still Work ───");

  const csvDefault = await request(
    "GET",
    "/exports/transactions",
    undefined,
    userTokens?.accessToken,
  );
  assert(csvDefault.status === 200, "Default format (CSV) still works");
  assert(csvDefault.contentType.includes("text/csv"), "Default is still CSV");

  const pdfReport = await request(
    "GET",
    "/exports/reports?type=summary&format=pdf",
    undefined,
    userTokens?.accessToken,
  );
  assert(pdfReport.status === 200, "PDF report still works");

  // ─── Summary ──────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${"=".repeat(55)}`);
  console.log(`📊 Results: ${passed}/${total} passed, ${failed}/${total} failed`);
  console.log(`${"=".repeat(55)}`);

  if (failed > 0) {
    process.exit(1);
  }
}

// ─── Start Server & Run Tests ────────────────────────────────

async function main() {
  app = createApp();
  server = app.listen(4009, async () => {
    console.log(`🧪 Test server running on port 4009`);
    try {
      await runTests();
    } finally {
      server.close();
      console.log("\n🧪 Test server stopped.\n");
    }
  });
}

main().catch((err) => {
  console.error("❌ Test runner failed:", err);
  server?.close();
  process.exit(1);
});
