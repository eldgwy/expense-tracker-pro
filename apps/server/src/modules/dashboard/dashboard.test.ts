/**
 * Dashboard Module — Full API Integration Tests
 *
 * Tests: financial summary, monthly overview, budget overview, recent transactions,
 *        statistics accuracy, spending by category, spending by payment method.
 *
 * Run: npx tsx src/modules/dashboard/dashboard.test.ts
 *
 * Prerequisites: PostgreSQL running, migrations applied
 */

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, "../../../../.env") });

process.env.PORT = "4004";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-for-dashboard-integration-tests";
process.env.JWT_EXPIRES_IN = "1h";
process.env.JWT_REFRESH_EXPIRES_IN = "7d";

import { createApp } from "../../app.js";
import type { Application } from "express";
import type { Server } from "node:http";

// ─── Test Runner ──────────────────────────────────────────────

let passed = 0;
let failed = 0;
let userTokens: { accessToken: string; refreshToken: string } | null = null;
let server: Server;
let app: Application;

const BASE = "http://localhost:4004/api/v1";
const TEST_EMAIL = `dash-test-${Date.now()}@example.com`;
const TEST_PASSWORD = "Test@123456";

interface ApiResult {
  success: boolean;
  data?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  message?: string;
  error?: string;
  statusCode?: number;
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
  console.log("\n🧪 Dashboard Module — API Integration Tests\n");
  console.log(`Test user: ${TEST_EMAIL}\n`);

  // Use the current date for test transactions so "monthly" matches "all-time"
  // regardless of when the suite runs (previously hardcoded to July 2026,
  // which broke monthly assertions once that month had passed). Computed in
  // LOCAL time to stay consistent with the dashboard service's monthly window
  // (toISOString would use UTC and drift across month boundaries).
  const now = new Date();
  const yearNum = now.getFullYear();
  const monthNum = String(now.getMonth() + 1).padStart(2, "0");
  const dayNum = String(now.getDate()).padStart(2, "0");
  const today = `${yearNum}-${monthNum}-${dayNum}`;
  const firstOfMonth = `${yearNum}-${monthNum}-01`;

  // ─── 0. Health Check ───────────────────────────────────────
  console.log("─── 0. Health Check ───");
  const health = await request("GET", "/health");
  assert(health.status === 200, "Health endpoint returns 200");
  assert(health.json.success === true, "Health response success=true");

  // ─── 1. Register & Set Up Test Data ────────────────────────
  console.log("\n─── 1. Register & Create Test Transactions ───");
  const register = await request("POST", "/auth/register", {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    name: "Dashboard Tester",
  });
  assert(register.status === 201, "Register returns 201");
  assert(register.json.data?.tokens != null, "Register returns tokens");
  userTokens = register.json.data?.tokens as { accessToken: string; refreshToken: string };

  // Get default categories
  const defaults = await request("GET", "/categories", undefined, userTokens?.accessToken);
  assert(defaults.status === 200, "Default categories fetched");
  const cats = defaults.json.data?.categories as Array<Record<string, unknown>> | undefined;
  assert(cats != null, "Categories array exists");

  const foodCat = cats!.find((c) => c.name === "Food");
  const transportCat = cats!.find((c) => c.name === "Transportation");
  const salaryCat = cats!.find((c) => c.name === "Salary");
  const housingCat = cats!.find((c) => c.name === "Housing");
  assert(foodCat != null, "Food category exists");
  assert(salaryCat != null, "Salary category exists");

  const foodId = foodCat!.id as string;
  const transportId = transportCat!.id as string;
  const salaryId = salaryCat!.id as string;
  const housingId = housingCat!.id as string;

  // Create a payment method
  const pm = await request(
    "POST",
    "/payment-methods",
    { type: "CREDIT_CARD", name: "Dashboard Test Card" },
    userTokens?.accessToken,
  );
  assert(pm.status === 201, "Payment method created");
  const pmId = (pm.json.data?.paymentMethod as Record<string, unknown>)?.id as string;

  // Create transactions for dashboard data
  // Income
  const income1 = await request(
    "POST",
    "/transactions",
    {
      type: "INCOME",
      amount: 5000,
      description: "Monthly Salary",
      date: today,
      categoryId: salaryId,
    },
    userTokens?.accessToken,
  );
  assert(income1.status === 201, "Income 1 created");

  const income2 = await request(
    "POST",
    "/transactions",
    {
      type: "INCOME",
      amount: 500,
      description: "Freelance Project",
      date: today,
      categoryId: salaryId,
    },
    userTokens?.accessToken,
  );
  assert(income2.status === 201, "Income 2 created");

  // Expenses
  const expense1 = await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: 350,
      description: "Groceries",
      date: today,
      categoryId: foodId,
      paymentMethodId: pmId,
    },
    userTokens?.accessToken,
  );
  assert(expense1.status === 201, "Expense 1 created");

  const expense2 = await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: 1500,
      description: "Monthly Rent",
      date: today,
      categoryId: housingId,
      paymentMethodId: pmId,
    },
    userTokens?.accessToken,
  );
  assert(expense2.status === 201, "Expense 2 created");

  const expense3 = await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: 45,
      description: "Gas",
      date: today,
      categoryId: transportId,
      paymentMethodId: pmId,
    },
    userTokens?.accessToken,
  );
  assert(expense3.status === 201, "Expense 3 created");

  const expense4 = await request(
    "POST",
    "/transactions",
    { type: "EXPENSE", amount: 120, description: "Dinner Out", date: today, categoryId: foodId },
    userTokens?.accessToken,
  );
  assert(expense4.status === 201, "Expense 4 created");

  // Create a budget
  const budget = await request(
    "POST",
    "/budgets",
    {
      categoryId: foodId,
      targetAmount: 800,
      period: "MONTHLY",
      startDate: firstOfMonth,
      alertThreshold: 80,
    },
    userTokens?.accessToken,
  );
  assert(budget.status === 201, "Budget created");

  // ─── 2. Fetch Dashboard Overview ──────────────────────────
  console.log("\n─── 2. Dashboard Overview (GET /dashboard/overview) ───");
  const overview = await request("GET", "/dashboard/overview", undefined, userTokens?.accessToken);
  assert(overview.status === 200, "Dashboard overview returns 200");
  assert(overview.json.success === true, "Dashboard overview success=true");

  const data = overview.json.data?.overview as Record<string, unknown> | undefined;
  assert(data != null, "Overview data returned");

  // ─── 3. Financial Summary ──────────────────────────────────
  console.log("\n─── 3. Financial Summary ───");
  assert(typeof data!.totalIncome === "number", "totalIncome is a number");
  assert(data!.totalIncome === 5500, `totalIncome = 5500 (got ${data!.totalIncome})`);
  assert(typeof data!.totalExpense === "number", "totalExpense is a number");
  assert(data!.totalExpense === 2015, `totalExpense = 2015 (got ${data!.totalExpense})`);
  assert(typeof data!.netSavings === "number", "netSavings is a number");
  assert(data!.netSavings === 5500 - 2015, `netSavings = ${5500 - 2015} (got ${data!.netSavings})`);
  assert(typeof data!.totalBalance === "number", "totalBalance is a number");
  assert(data!.totalBalance === 5500 - 2015, "totalBalance matches netSavings");

  // ─── 4. Monthly Overview ───────────────────────────────────
  console.log("\n─── 4. Monthly Overview ───");

  // All transactions are dated today (current month), so monthly matches all-time
  assert(typeof data!.monthlyIncome === "number", "monthlyIncome is a number");
  assert(data!.monthlyIncome === 5500, `monthlyIncome = 5500 (got ${data!.monthlyIncome})`);
  assert(typeof data!.monthlyExpense === "number", "monthlyExpense is a number");
  assert(data!.monthlyExpense === 2015, `monthlyExpense = 2015 (got ${data!.monthlyExpense})`);
  assert(typeof data!.monthlyNet === "number", "monthlyNet is a number");
  assert(data!.monthlyNet === 5500 - 2015, `monthlyNet = ${5500 - 2015} (got ${data!.monthlyNet})`);

  // ─── 5. Quick Statistics ───────────────────────────────────
  console.log("\n─── 5. Quick Statistics ───");

  const stats = data!.quickStats as Record<string, unknown> | undefined;
  assert(stats != null, "quickStats object returned");
  assert(stats!.totalTransactions === 6, `totalTransactions = 6 (got ${stats!.totalTransactions})`);
  assert(typeof stats!.totalCategories === "number", "totalCategories is a number");
  assert(
    Number(stats!.totalCategories) >= 9,
    `totalCategories >= 9 (got ${stats!.totalCategories})`,
  );
  assert(typeof stats!.totalPaymentMethods === "number", "totalPaymentMethods is a number");
  assert(
    Number(stats!.totalPaymentMethods) >= 5,
    `totalPaymentMethods >= 5 (got ${stats!.totalPaymentMethods})`,
  );
  assert(
    typeof stats!.averageTransactionAmount === "number",
    "averageTransactionAmount is a number",
  );
  // Average: (5000 + 500 + 350 + 1500 + 45 + 120) / 6 = 7515 / 6 = 1252.5
  assert(
    stats!.averageTransactionAmount === 7515 / 6,
    `avg = ${7515 / 6} (got ${stats!.averageTransactionAmount})`,
  );
  assert(stats!.largestExpense === 1500, `largestExpense = 1500 (got ${stats!.largestExpense})`);
  assert(stats!.largestIncome === 5000, `largestIncome = 5000 (got ${stats!.largestIncome})`);

  // ─── 6. Budget Overview ────────────────────────────────────
  console.log("\n─── 6. Budget Overview ───");

  const budgets = data!.budgetStatuses as Array<Record<string, unknown>> | undefined;
  assert(budgets != null, "budgetStatuses array returned");
  assert(budgets!.length >= 1, "At least 1 budget status");
  const foodBudget = budgets!.find((b) => b.categoryName === "Food");
  assert(foodBudget != null, "Food budget found");
  assert(foodBudget!.budgeted === 800, "Food budget target = 800");
  assert(foodBudget!.spent === 470, `Food budget spent = 470 (got ${foodBudget!.spent})`);
  assert(
    foodBudget!.remaining === 330,
    `Food budget remaining = 330 (got ${foodBudget!.remaining})`,
  );
  assert(
    foodBudget!.percentage === Math.round((470 / 800) * 100),
    `Food budget % = ${Math.round((470 / 800) * 100)} (got ${foodBudget!.percentage})`,
  );

  // ─── 7. Recent Transactions ────────────────────────────────
  console.log("\n─── 7. Recent Transactions ───");

  const recent = data!.recentTransactions as Array<Record<string, unknown>> | undefined;
  assert(recent != null, "recentTransactions array returned");
  assert(recent!.length <= 5, "At most 5 recent transactions");
  assert(recent!.length >= 1, "At least 1 recent transaction");
  // Should be sorted by date descending
  for (let i = 1; i < recent!.length; i++) {
    const prevDate = new Date(recent![i - 1].date as string).getTime();
    const currDate = new Date(recent![i].date as string).getTime();
    assert(prevDate >= currDate, `Transaction ${i} is newer than ${i - 1}`);
  }

  // Verify relations are included
  const firstTxn = recent![0];
  assert(firstTxn.category != null, "Recent transaction has category relation");
  assert(
    typeof (firstTxn.category as Record<string, unknown>)?.name === "string",
    "Category name is included",
  );

  // ─── 8. Spending by Category ───────────────────────────────
  console.log("\n─── 8. Spending by Category ───");

  const catSpending = data!.spendingByCategory as Array<Record<string, unknown>> | undefined;
  assert(catSpending != null, "spendingByCategory array returned");
  assert(catSpending!.length >= 3, "At least 3 categories with spending");
  const foodSpending = catSpending!.find((c) => c.categoryName === "Food");
  assert(foodSpending != null, "Food category found in spending");
  assert(
    foodSpending!.totalSpent === 470,
    `Food totalSpent = 470 (got ${foodSpending!.totalSpent})`,
  );
  assert(typeof foodSpending!.percentage === "number", "Food percentage is a number");
  assert(
    foodSpending!.percentage === Math.round((470 / 2015) * 100),
    `Food % = ${Math.round((470 / 2015) * 100)} (got ${foodSpending!.percentage})`,
  );

  const housingSpending = catSpending!.find((c) => c.categoryName === "Housing");
  assert(housingSpending != null, "Housing category found in spending");
  assert(housingSpending!.totalSpent === 1500, "Housing totalSpent = 1500");

  // Spending should be sorted descending by totalSpent
  for (let i = 1; i < catSpending!.length; i++) {
    assert(
      (catSpending![i - 1].totalSpent as number) >= (catSpending![i].totalSpent as number),
      "Categories sorted descending by totalSpent",
    );
  }

  // ─── 9. Spending by Payment Method ─────────────────────────
  console.log("\n─── 9. Spending by Payment Method ───");

  const pmSpending = data!.spendingByPaymentMethod as Array<Record<string, unknown>> | undefined;
  assert(pmSpending != null, "spendingByPaymentMethod array returned");
  assert(pmSpending!.length >= 1, "At least 1 payment method with spending");
  const cardSpending = pmSpending!.find((p) => p.paymentMethodName === "Dashboard Test Card");
  assert(cardSpending != null, "Test payment method found in spending");
  assert(
    cardSpending!.totalExpense === 1895,
    `Card totalExpense = 1895 (got ${cardSpending!.totalExpense})`,
  );
  assert(cardSpending!.totalIncome === 0, "Card has no income");
  assert(cardSpending!.transactionCount === 3, "Card used in 3 transactions");

  // Most used payment method
  assert(data!.mostUsedPaymentMethod != null, "mostUsedPaymentMethod is not null");
  const mostUsed = data!.mostUsedPaymentMethod as Record<string, unknown>;
  assert(mostUsed!.paymentMethodName != null, "Most used method has a name");
  assert(typeof mostUsed!.transactionCount === "number", "Most used method has transaction count");

  // ─── 10. Savings Summary ──────────────────────────────────
  console.log("\n─── 10. Savings Summary ───");

  const savings = data!.savingsSummary as Record<string, unknown> | undefined;
  assert(savings != null, "savingsSummary returned");
  assert(typeof savings!.totalSaved === "number", "savingsSummary.totalSaved is number");
  assert(typeof savings!.totalTarget === "number", "savingsSummary.totalTarget is number");
  assert(typeof savings!.progress === "number", "savingsSummary.progress is number");
  assert(typeof savings!.goalCount === "number", "savingsSummary.goalCount is number");
  // No savings goals created, so all should be 0
  assert(savings!.goalCount === 0, "No savings goals created");

  // ─── 11. Yearly Overview ──────────────────────────────────
  console.log("\n─── 11. Yearly Overview ───");

  assert(typeof data!.yearlyIncome === "number", "yearlyIncome is a number");
  assert(data!.yearlyIncome === 5500, `yearlyIncome = 5500 (got ${data!.yearlyIncome})`);
  assert(typeof data!.yearlyExpense === "number", "yearlyExpense is a number");
  assert(data!.yearlyExpense === 2015, `yearlyExpense = 2015 (got ${data!.yearlyExpense})`);
  assert(typeof data!.yearlyNet === "number", "yearlyNet is a number");
  assert(data!.yearlyNet === 5500 - 2015, "yearlyNet = income - expense");

  // ─── 12. Auth Protected ───────────────────────────────────
  console.log("\n─── 12. Auth Protection ───");
  const noAuth = await request("GET", "/dashboard/overview");
  assert(noAuth.status === 401, "No auth token returns 401");

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
  server = app.listen(4004, async () => {
    console.log(`🧪 Test server running on port 4004`);
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
