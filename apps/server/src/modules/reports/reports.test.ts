/**
 * Reports Module — Full API Integration Tests
 *
 * Tests: daily, weekly, monthly, yearly, custom reports, summary,
 *        breakdown, category summary, monthly trend, filters, auth.
 *
 * Run: npx tsx src/modules/reports/reports.test.ts
 *
 * Prerequisites: PostgreSQL running, migrations applied
 */

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, "../../../../.env") });

process.env.PORT = "4007";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-for-reports-integration-tests";
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

const BASE = "http://localhost:4007/api/v1";
const TEST_EMAIL = `rpt-test-${Date.now()}@example.com`;
const TEST_PASSWORD = "Test@123456";
const SECOND_USER_EMAIL = `rpt-test-2-${Date.now()}@example.com`;

interface ApiResult {
  success: boolean;
  data?: Record<string, unknown>;
  message?: string;
  error?: string;
  statusCode?: number;
  details?: Record<string, string[]>;
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  token?: string | null,
): Promise<{ status: number; json: ApiResult }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const status = response.status;
  let json: ApiResult = { success: false };
  try {
    json = (await response.json()) as ApiResult;
  } catch {
    json = { success: false };
  }

  return { status, json };
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

// ─── Tests ────────────────────────────────────────────────────

async function runTests() {
  console.log("\n🧪 Reports Module — API Integration Tests\n");
  console.log(`Test user: ${TEST_EMAIL}\n`);

  // ─── 0. Health Check ───────────────────────────────────────
  console.log("─── 0. Health Check ───");
  const health = await request("GET", "/health");
  assert(health.status === 200, "Health endpoint returns 200");
  assert(health.json.success === true, "Health response success=true");

  // ─── 1. Register User & Set Up Test Data ───────────────────
  console.log("\n─── 1. Register & Create Test Data ───");
  const register = await request("POST", "/auth/register", {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    name: "Report Tester",
  });
  assert(register.status === 201, "Register returns 201");
  assert(register.json.data?.tokens != null, "Register returns tokens");
  userTokens = register.json.data?.tokens as { accessToken: string; refreshToken: string };

  // Get default categories
  const defaultCats = await request("GET", "/categories", undefined, userTokens?.accessToken);
  assert(defaultCats.status === 200, "Default categories fetched");

  const cats = defaultCats.json.data?.categories as Array<Record<string, unknown>> | undefined;
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
  testPaymentMethodId =
    ((pm.json.data?.paymentMethod as Record<string, unknown>)?.id as string) ?? null;
  assert(testPaymentMethodId != null, "Payment method has ID");

  // Create transactions for report testing
  const tx1 = await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: 42.5,
      description: "Whole Foods Market",
      date: new Date().toISOString().slice(0, 10),
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
      date: new Date().toISOString().slice(0, 10),
      categoryId: incomeCategoryId,
    },
    userTokens?.accessToken,
  );
  assert(tx2.status === 201, "Created income transaction");

  // Second expense with different category for later variety
  const transportCat = cats?.find((c) => c.name === "Transport");
  const transportCategoryId = (transportCat?.id as string) ?? testCategoryId!;

  const tx3 = await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: 35.0,
      description: "Gas Station",
      date: new Date(Date.now() - 86400000).toISOString().slice(0, 10), // yesterday
      categoryId: transportCategoryId,
    },
    userTokens?.accessToken,
  );
  assert(tx3.status === 201, "Created second expense transaction");

  // ─── 2. Daily Report ───────────────────────────────────────
  console.log("\n─── 2. Daily Report (GET /reports/daily) ───");
  const today = new Date().toISOString().slice(0, 10);

  const daily = await request(
    "GET",
    `/reports/daily?date=${today}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(daily.status === 200, "Daily report returns 200");
  assert(daily.json.success === true, "Daily report success=true");
  const dailyReport = daily.json.data?.report as Record<string, unknown> | undefined;
  assert(dailyReport != null, "Daily report data returned");
  assert(dailyReport!.date === today, "Daily report date matches");
  assert(typeof dailyReport!.income === "number", "Daily report includes income");
  assert(typeof dailyReport!.expenses === "number", "Daily report includes expenses");
  assert(typeof dailyReport!.balance === "number", "Daily report includes balance");
  assert(
    typeof dailyReport!.transactionCount === "number",
    "Daily report includes transaction count",
  );
  assert(Number(dailyReport!.transactionCount) >= 2, "Daily report has 2+ transactions");
  assert(Array.isArray(dailyReport!.transactions), "Daily report includes transactions array");
  assert(
    Array.isArray(dailyReport!.spendingByCategory),
    "Daily report includes category breakdown",
  );

  // Daily report without date (defaults to today)
  const dailyDefault = await request("GET", "/reports/daily", undefined, userTokens?.accessToken);
  assert(dailyDefault.status === 200, "Daily report without date returns 200");

  // Daily report with invalid date
  const dailyBad = await request(
    "GET",
    "/reports/daily?date=not-a-date",
    undefined,
    userTokens?.accessToken,
  );
  assert(dailyBad.status === 400, "Daily report with invalid date returns 400");

  // ─── 3. Weekly Report ──────────────────────────────────────
  console.log("\n─── 3. Weekly Report (GET /reports/weekly) ───");

  const weekly = await request(
    "GET",
    `/reports/weekly?date=${today}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(weekly.status === 200, "Weekly report returns 200");
  assert(weekly.json.success === true, "Weekly report success=true");
  const weeklyReport = weekly.json.data?.report as Record<string, unknown> | undefined;
  assert(weeklyReport != null, "Weekly report data returned");
  assert(typeof weeklyReport!.startDate === "string", "Weekly report has startDate");
  assert(typeof weeklyReport!.endDate === "string", "Weekly report has endDate");
  assert(typeof weeklyReport!.weekLabel === "string", "Weekly report has weekLabel");
  assert(typeof weeklyReport!.income === "number", "Weekly report includes income");
  assert(typeof weeklyReport!.expenses === "number", "Weekly report includes expenses");
  assert(typeof weeklyReport!.balance === "number", "Weekly report includes balance");
  assert(Number(weeklyReport!.transactionCount) >= 2, "Weekly report has 2+ transactions");
  assert(Array.isArray(weeklyReport!.dailyBreakdown), "Weekly report has dailyBreakdown");
  assert(
    (weeklyReport!.dailyBreakdown as Array<unknown>).length === 7,
    "Weekly report has 7 daily breakdowns",
  );
  assert(Array.isArray(weeklyReport!.transactions), "Weekly report has transactions array");
  assert(Array.isArray(weeklyReport!.spendingByCategory), "Weekly report has spendingByCategory");

  // Without date (defaults to today)
  const weeklyDefault = await request("GET", "/reports/weekly", undefined, userTokens?.accessToken);
  assert(weeklyDefault.status === 200, "Weekly report without date returns 200");

  // Invalid date
  const weeklyBad = await request(
    "GET",
    "/reports/weekly?date=bad-date",
    undefined,
    userTokens?.accessToken,
  );
  assert(weeklyBad.status === 400, "Weekly report with invalid date returns 400");

  // ─── 4. Monthly Report ─────────────────────────────────────
  console.log("\n─── 4. Monthly Report (GET /reports/monthly) ───");

  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = String(now.getMonth() + 1).padStart(2, "0");

  const monthly = await request(
    "GET",
    `/reports/monthly?year=${thisYear}&month=${thisMonth}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(monthly.status === 200, "Monthly report returns 200");
  assert(monthly.json.success === true, "Monthly report success=true");
  const monthlyReport = monthly.json.data?.report as Record<string, unknown> | undefined;
  assert(monthlyReport != null, "Monthly report data returned");
  assert(typeof monthlyReport!.month === "string", "Monthly report has month");
  assert(typeof monthlyReport!.label === "string", "Monthly report has label");
  assert(typeof monthlyReport!.income === "number", "Monthly report includes income");
  assert(typeof monthlyReport!.expenses === "number", "Monthly report includes expenses");
  assert(typeof monthlyReport!.netSavings === "number", "Monthly report includes netSavings");
  assert(
    typeof monthlyReport!.transactionCount === "number",
    "Monthly report includes transactionCount",
  );
  assert(Number(monthlyReport!.transactionCount) >= 2, "Monthly report has 2+ transactions");
  assert(Array.isArray(monthlyReport!.categorySummary), "Monthly report includes categorySummary");
  assert(
    Array.isArray(monthlyReport!.paymentMethodSummary),
    "Monthly report includes paymentMethodSummary",
  );
  assert(
    Array.isArray(monthlyReport!.budgetPerformance),
    "Monthly report includes budgetPerformance",
  );

  // Monthly report without params (defaults to current month)
  const monthlyDefault = await request(
    "GET",
    "/reports/monthly",
    undefined,
    userTokens?.accessToken,
  );
  assert(monthlyDefault.status === 200, "Monthly report without params returns 200");

  // Monthly report with date param
  const monthlyDate = await request(
    "GET",
    `/reports/monthly?date=${today}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(monthlyDate.status === 200, "Monthly report with date param returns 200");

  // Invalid month format
  const monthlyBad = await request(
    "GET",
    "/reports/monthly?month=13",
    undefined,
    userTokens?.accessToken,
  );
  assert(monthlyBad.status === 400, "Monthly report with invalid month returns 400");

  // ─── 5. Yearly Report ──────────────────────────────────────
  console.log("\n─── 5. Yearly Report (GET /reports/yearly) ───");

  const yearly = await request(
    "GET",
    `/reports/yearly?year=${thisYear}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(yearly.status === 200, "Yearly report returns 200");
  assert(yearly.json.success === true, "Yearly report success=true");
  const yearlyReport = yearly.json.data?.report as Record<string, unknown> | undefined;
  assert(yearlyReport != null, "Yearly report data returned");
  assert(yearlyReport!.year === thisYear, "Yearly report year matches");
  assert(typeof yearlyReport!.income === "number", "Yearly report includes income");
  assert(typeof yearlyReport!.expenses === "number", "Yearly report includes expenses");
  assert(typeof yearlyReport!.netSavings === "number", "Yearly report includes netSavings");
  assert(
    typeof yearlyReport!.transactionCount === "number",
    "Yearly report includes transactionCount",
  );
  assert(Number(yearlyReport!.transactionCount) >= 2, "Yearly report has 2+ transactions");
  assert(
    Array.isArray(yearlyReport!.monthlyComparison),
    "Yearly report includes monthlyComparison",
  );
  assert(
    (yearlyReport!.monthlyComparison as Array<unknown>).length === 12,
    "Yearly report has 12 monthly comparisons",
  );
  assert(Array.isArray(yearlyReport!.topCategories), "Yearly report includes topCategories");
  assert(
    Array.isArray(yearlyReport!.budgetPerformance),
    "Yearly report includes budgetPerformance",
  );

  // Yearly report without params (defaults to current year)
  const yearlyDefault = await request("GET", "/reports/yearly", undefined, userTokens?.accessToken);
  assert(yearlyDefault.status === 200, "Yearly report without params returns 200");

  // Check monthly comparisons are populated correctly
  const monthlyComp = yearlyReport!.monthlyComparison as Array<Record<string, unknown>>;
  const currentMonthKey = `${thisYear}-${thisMonth}`;
  const currentMonthEntry = monthlyComp.find((m) => m.month === currentMonthKey);
  assert(currentMonthEntry != null, "Current month present in monthlyComparison");
  assert((currentMonthEntry!.income as number) > 0, "Current month has income recorded");
  assert((currentMonthEntry!.expenses as number) > 0, "Current month has expenses recorded");

  // Invalid year
  const yearlyBad = await request(
    "GET",
    "/reports/yearly?year=abc",
    undefined,
    userTokens?.accessToken,
  );
  assert(yearlyBad.status === 400, "Yearly report with invalid year returns 400");

  // ─── 6. Category Summary Report ────────────────────────────
  console.log("\n─── 6. Category Summary (GET /reports/category-summary) ───");

  const catSummary = await request(
    "GET",
    "/reports/category-summary",
    undefined,
    userTokens?.accessToken,
  );
  assert(catSummary.status === 200, "Category summary returns 200");
  assert(catSummary.json.success === true, "Category summary success=true");
  const catSummaryData = catSummary.json.data?.report as Record<string, unknown> | undefined;
  assert(catSummaryData != null, "Category summary data returned");
  assert(catSummaryData!.startDate != null, "Category summary has startDate");
  assert(catSummaryData!.endDate != null, "Category summary has endDate");
  assert(typeof catSummaryData!.grandTotal === "number", "Category summary has grandTotal");
  assert(typeof catSummaryData!.categoryCount === "number", "Category summary has categoryCount");
  assert(Number(catSummaryData!.categoryCount) >= 1, "Category summary has at least 1 category");
  assert(Array.isArray(catSummaryData!.categories), "Category summary has categories array");
  const categories = catSummaryData!.categories as Array<Record<string, unknown>>;
  if (categories.length > 0) {
    assert(categories[0].categoryId != null, "Category has id");
    assert(categories[0].categoryName != null, "Category has name");
    assert(categories[0].total != null, "Category has total");
    assert(categories[0].percentage != null, "Category has percentage");
  }

  // With date range
  const catSummaryFiltered = await request(
    "GET",
    "/reports/category-summary?startDate=2020-01-01&endDate=2030-12-31",
    undefined,
    userTokens?.accessToken,
  );
  assert(catSummaryFiltered.status === 200, "Category summary with date range returns 200");

  // ─── 7. Monthly Trend ──────────────────────────────────────
  console.log("\n─── 7. Monthly Trend (GET /reports/monthly-trend) ───");

  const trend = await request(
    "GET",
    `/reports/monthly-trend?year=${thisYear}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(trend.status === 200, "Monthly trend returns 200");
  assert(trend.json.success === true, "Monthly trend success=true");
  const trendReport = trend.json.data?.report as Record<string, unknown> | undefined;
  assert(trendReport != null, "Monthly trend data returned");
  assert(trendReport!.year === thisYear, "Monthly trend year matches");
  assert(Array.isArray(trendReport!.months), "Monthly trend has months array");
  assert((trendReport!.months as Array<unknown>).length === 12, "Monthly trend has 12 months");

  const trendMonths = trendReport!.months as Array<Record<string, unknown>>;
  const currentTrendMonth = trendMonths.find((m) => m.month === currentMonthKey);
  assert(currentTrendMonth != null, "Current month present in trend");

  // Without year (defaults to current year)
  const trendDefault = await request(
    "GET",
    "/reports/monthly-trend",
    undefined,
    userTokens?.accessToken,
  );
  assert(trendDefault.status === 200, "Monthly trend without year returns 200");

  // ─── 8. Custom Report ──────────────────────────────────────
  console.log("\n─── 8. Custom Report (GET /reports/custom) ───");

  // Basic custom report (no filters)
  const customBasic = await request("GET", "/reports/custom", undefined, userTokens?.accessToken);
  assert(customBasic.status === 200, "Custom report without filters returns 200");
  assert(customBasic.json.success === true, "Custom report success=true");
  const customReport = customBasic.json.data?.report as Record<string, unknown> | undefined;
  assert(customReport != null, "Custom report data returned");
  assert(typeof customReport!.income === "number", "Custom report has income");
  assert(typeof customReport!.expenses === "number", "Custom report has expenses");
  assert(typeof customReport!.balance === "number", "Custom report has balance");
  assert(typeof customReport!.transactionCount === "number", "Custom report has transactionCount");
  assert(Array.isArray(customReport!.transactions), "Custom report has transactions");
  assert(Array.isArray(customReport!.spendingByCategory), "Custom report has spendingByCategory");

  // Custom report with date range
  const customDate = await request(
    "GET",
    "/reports/custom?startDate=2026-01-01&endDate=2026-12-31",
    undefined,
    userTokens?.accessToken,
  );
  assert(customDate.status === 200, "Custom report with date range returns 200");

  // Custom report with type filter (should find INCOME)
  const customType = await request(
    "GET",
    "/reports/custom?type=INCOME",
    undefined,
    userTokens?.accessToken,
  );
  assert(customType.status === 200, "Custom report with type filter returns 200");
  const incomeReport = customType.json.data?.report as Record<string, unknown> | undefined;
  assert(Number(incomeReport!.income) > 0, "Income type filter shows income transactions");

  // Custom report with type EXPENSE filter
  const customExpense = await request(
    "GET",
    "/reports/custom?type=EXPENSE",
    undefined,
    userTokens?.accessToken,
  );
  assert(customExpense.status === 200, "Custom report with expense filter returns 200");
  const expenseReport = customExpense.json.data?.report as Record<string, unknown> | undefined;
  assert(Number(expenseReport!.expenses) > 0, "Expense type filter shows expense transactions");

  // Custom report with category filter
  const customCat = await request(
    "GET",
    `/reports/custom?categoryId=${testCategoryId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(customCat.status === 200, "Custom report with category filter returns 200");

  // Custom report with amount range
  const customAmount = await request(
    "GET",
    "/reports/custom?minAmount=10&maxAmount=100",
    undefined,
    userTokens?.accessToken,
  );
  assert(customAmount.status === 200, "Custom report with amount range returns 200");

  // Custom report with payment method filter
  const customPm = await request(
    "GET",
    `/reports/custom?paymentMethodId=${testPaymentMethodId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(customPm.status === 200, "Custom report with payment method filter returns 200");

  // Custom report with all filters combined
  const customAll = await request(
    "GET",
    `/reports/custom?type=EXPENSE&categoryId=${testCategoryId}&minAmount=10&maxAmount=100`,
    undefined,
    userTokens?.accessToken,
  );
  assert(customAll.status === 200, "Custom report with combined filters returns 200");

  // Invalid type value
  const customBadType = await request(
    "GET",
    "/reports/custom?type=INVALID",
    undefined,
    userTokens?.accessToken,
  );
  assert(customBadType.status === 400, "Custom report with invalid type returns 400");

  // Invalid UUID
  const customBadUuid = await request(
    "GET",
    "/reports/custom?categoryId=not-a-uuid",
    undefined,
    userTokens?.accessToken,
  );
  assert(customBadUuid.status === 400, "Custom report with invalid UUID returns 400");

  // ─── 9. Report Summary ────────────────────────────────────
  console.log("\n─── 9. Report Summary (GET /reports/summary) ───");

  const summary = await request("GET", "/reports/summary", undefined, userTokens?.accessToken);
  assert(summary.status === 200, "Report summary returns 200");
  assert(summary.json.success === true, "Report summary success=true");
  const summaryData = summary.json.data?.summary as Record<string, unknown> | undefined;
  assert(summaryData != null, "Summary data returned");
  assert(typeof summaryData!.income === "number", "Summary has income");
  assert(typeof summaryData!.expenses === "number", "Summary has expenses");
  assert(typeof summaryData!.netBalance === "number", "Summary has netBalance");
  assert(typeof summaryData!.savingsRate === "number", "Summary has savingsRate");
  assert(typeof summaryData!.transactionCount === "number", "Summary has transactionCount");
  assert(typeof summaryData!.incomeCount === "number", "Summary has incomeCount");
  assert(typeof summaryData!.expenseCount === "number", "Summary has expenseCount");
  assert(
    typeof summaryData!.averageTransactionAmount === "number",
    "Summary has averageTransactionAmount",
  );
  assert(typeof summaryData!.averageIncome === "number", "Summary has averageIncome");
  assert(typeof summaryData!.averageExpense === "number", "Summary has averageExpense");
  assert(Number(summaryData!.transactionCount) >= 2, "Summary has 2+ transactions");
  assert(Number(summaryData!.income) > 0, "Summary has income > 0");
  assert(
    Number(summaryData!.netBalance) > 0,
    "Summary has positive net balance (income > expenses)",
  );

  // Summary with date range
  const summaryFiltered = await request(
    "GET",
    "/reports/summary?startDate=2026-01-01&endDate=2026-12-31",
    undefined,
    userTokens?.accessToken,
  );
  assert(summaryFiltered.status === 200, "Summary with date range returns 200");

  // ─── 10. Report Breakdown ─────────────────────────────────
  console.log("\n─── 10. Report Breakdown (GET /reports/breakdown) ───");

  const breakdown = await request("GET", "/reports/breakdown", undefined, userTokens?.accessToken);
  assert(breakdown.status === 200, "Report breakdown returns 200");
  assert(breakdown.json.success === true, "Report breakdown success=true");
  const breakdownData = breakdown.json.data?.breakdown as Record<string, unknown> | undefined;
  assert(breakdownData != null, "Breakdown data returned");
  assert(Array.isArray(breakdownData!.categoryBreakdown), "Breakdown has categoryBreakdown");
  assert(
    Array.isArray(breakdownData!.paymentMethodBreakdown),
    "Breakdown has paymentMethodBreakdown",
  );
  assert(breakdownData!.incomeVsExpense != null, "Breakdown has incomeVsExpense");

  const incomeVsExpense = breakdownData!.incomeVsExpense as Record<string, unknown>;
  assert(typeof incomeVsExpense.income === "number", "incomeVsExpense has income");
  assert(typeof incomeVsExpense.expenses === "number", "incomeVsExpense has expenses");
  assert(typeof incomeVsExpense.net === "number", "incomeVsExpense has net");
  assert(typeof incomeVsExpense.incomeCount === "number", "incomeVsExpense has incomeCount");
  assert(typeof incomeVsExpense.expenseCount === "number", "incomeVsExpense has expenseCount");
  assert(
    typeof incomeVsExpense.incomePercentage === "number",
    "incomeVsExpense has incomePercentage",
  );
  assert(
    typeof incomeVsExpense.expensePercentage === "number",
    "incomeVsExpense has expensePercentage",
  );
  assert(Number(incomeVsExpense.incomeCount) >= 1, "incomeVsExpense has at least 1 income");
  assert(Number(incomeVsExpense.expenseCount) >= 1, "incomeVsExpense has at least 1 expense");

  // Check largest/smallest transactions
  const largest = breakdownData!.largestTransaction as Record<string, unknown> | null;
  const smallest = breakdownData!.smallestTransaction as Record<string, unknown> | null;
  assert(largest != null, "Breakdown has largestTransaction");
  assert(smallest != null, "Breakdown has smallestTransaction");
  assert(
    (largest!.amount as number) >= (smallest!.amount as number),
    "Largest amount >= smallest amount",
  );

  // Check category breakdown has names/colors/icons (not empty strings after optimization fix)
  const catBreakdown = breakdownData!.categoryBreakdown as Array<Record<string, unknown>>;
  if (catBreakdown.length > 0) {
    assert(typeof catBreakdown[0].categoryName === "string", "Category breakdown item has name");
    assert(typeof catBreakdown[0].categoryColor === "string", "Category breakdown item has color");
    assert(typeof catBreakdown[0].categoryIcon === "string", "Category breakdown item has icon");
    assert(catBreakdown[0].categoryName !== "", "Category name is not empty");
    assert(
      typeof catBreakdown[0].percentage === "number",
      "Category breakdown item has percentage",
    );
  }

  // Breakdown with date range
  const breakdownFiltered = await request(
    "GET",
    "/reports/breakdown?startDate=2026-01-01&endDate=2026-12-31",
    undefined,
    userTokens?.accessToken,
  );
  assert(breakdownFiltered.status === 200, "Breakdown with date range returns 200");

  // ─── 11. Ownership Scoping ─────────────────────────────────
  console.log("\n─── 11. Ownership Verification ───");

  const register2 = await request("POST", "/auth/register", {
    email: SECOND_USER_EMAIL,
    password: TEST_PASSWORD,
    name: "Second User",
  });
  assert(register2.status === 201, "Second user registered");
  secondUserTokens = register2.json.data?.tokens as { accessToken: string; refreshToken: string };

  // Second user's daily report returns their own (empty) data
  const secondDaily = await request(
    "GET",
    `/reports/daily?date=${today}`,
    undefined,
    secondUserTokens?.accessToken,
  );
  assert(secondDaily.status === 200, "Second user daily report returns 200");
  const secondDailyReport = secondDaily.json.data?.report as Record<string, unknown> | undefined;
  assert(
    secondDailyReport!.transactionCount === 0,
    "Second user daily report has 0 transactions (no crossover)",
  );

  // Second user's summary is isolated
  const secondSummary = await request(
    "GET",
    "/reports/summary",
    undefined,
    secondUserTokens?.accessToken,
  );
  assert(secondSummary.status === 200, "Second user summary returns 200");
  const secondSummaryData = secondSummary.json.data?.summary as Record<string, unknown> | undefined;
  assert(secondSummaryData!.transactionCount === 0, "Second user summary has 0 transactions");

  // Second user's breakdown is isolated
  const secondBreakdown = await request(
    "GET",
    "/reports/breakdown",
    undefined,
    secondUserTokens?.accessToken,
  );
  assert(secondBreakdown.status === 200, "Second user breakdown returns 200");
  const secondBreakdownData = secondBreakdown.json.data?.breakdown as
    Record<string, unknown> | undefined;
  const secondCatBreakdown = secondBreakdownData!.categoryBreakdown as Array<unknown>;
  assert(secondCatBreakdown.length === 0, "Second user breakdown has no categories");

  // Second user's monthly report is isolated
  const secondMonthly = await request(
    "GET",
    `/reports/monthly?year=${thisYear}&month=${thisMonth}`,
    undefined,
    secondUserTokens?.accessToken,
  );
  assert(secondMonthly.status === 200, "Second user monthly report returns 200");
  const secondMonthlyReport = secondMonthly.json.data?.report as
    Record<string, unknown> | undefined;
  assert(
    secondMonthlyReport!.transactionCount === 0,
    "Second user monthly report has 0 transactions",
  );

  // ─── 12. Validation ────────────────────────────────────────
  console.log("\n─── 12. Validation ───");

  // Invalid date format in daily report
  const invalidDate = await request(
    "GET",
    "/reports/daily?date=01-01-2026",
    undefined,
    userTokens?.accessToken,
  );
  assert(invalidDate.status === 400, "Invalid date format returns 400");

  // Invalid date in custom report
  const customBadDate = await request(
    "GET",
    "/reports/custom?startDate=not-a-date",
    undefined,
    userTokens?.accessToken,
  );
  assert(customBadDate.status === 400, "Custom report with invalid date returns 400");

  // Start date after end date (validation passes but results may be empty)
  const reversedDates = await request(
    "GET",
    "/reports/custom?startDate=2026-12-31&endDate=2026-01-01",
    undefined,
    userTokens?.accessToken,
  );
  assert(reversedDates.status === 200, "Custom report with reversed dates returns 200 (no crash)");

  // ─── 13. Unauthenticated Access ────────────────────────────
  console.log("\n─── 13. Unauthenticated Access ───");

  const noAuthDaily = await request("GET", "/reports/daily");
  assert(noAuthDaily.status === 401, "Daily report without auth returns 401");

  const noAuthWeekly = await request("GET", "/reports/weekly");
  assert(noAuthWeekly.status === 401, "Weekly report without auth returns 401");

  const noAuthMonthly = await request("GET", "/reports/monthly");
  assert(noAuthMonthly.status === 401, "Monthly report without auth returns 401");

  const noAuthYearly = await request("GET", "/reports/yearly");
  assert(noAuthYearly.status === 401, "Yearly report without auth returns 401");

  const noAuthCustom = await request("GET", "/reports/custom");
  assert(noAuthCustom.status === 401, "Custom report without auth returns 401");

  const noAuthSummary = await request("GET", "/reports/summary");
  assert(noAuthSummary.status === 401, "Summary without auth returns 401");

  const noAuthBreakdown = await request("GET", "/reports/breakdown");
  assert(noAuthBreakdown.status === 401, "Breakdown without auth returns 401");

  const noAuthCatSummary = await request("GET", "/reports/category-summary");
  assert(noAuthCatSummary.status === 401, "Category summary without auth returns 401");

  const noAuthTrend = await request("GET", "/reports/monthly-trend");
  assert(noAuthTrend.status === 401, "Monthly trend without auth returns 401");

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
  server = app.listen(4007, async () => {
    console.log(`🧪 Test server running on port 4007`);
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
