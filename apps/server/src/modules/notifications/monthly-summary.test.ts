/**
 * Monthly Summary Module — API Integration Tests
 *
 * Tests: compute monthly summary (income, expenses, net savings, top category,
 *        budget performance, largest transaction), generate MONTHLY_SUMMARY
 *        notification, 24h dedup, preference gating, validation, ownership.
 *
 * Run: npx tsx src/modules/notifications/monthly-summary.test.ts
 *
 * Prerequisites: PostgreSQL running, migrations applied
 */

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, "../../../../.env") });

process.env.PORT = "4022";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-for-monthly-summary-integration-tests";
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

const BASE = "http://localhost:4022/api/v1";
const TEST_EMAIL = `ms-test-${Date.now()}@example.com`;
const TEST_PASSWORD = "Test@123456";

// Fixed test month: June 2026
const TEST_MONTH_STR = "2026-06";

interface ApiResult {
  success: boolean;
  data?: Record<string, unknown>;
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
  console.log("\n🧪 Monthly Summary Module — API Integration Tests\n");
  console.log(`Test user: ${TEST_EMAIL}\n`);

  // ─── 0. Health Check ───────────────────────────────────────
  console.log("─── 0. Health Check ───");
  const health = await request("GET", "/health");
  assert(health.status === 200, "Health endpoint returns 200");
  assert(health.json.success === true, "Health response success=true");

  // ─── 1. Register User ──────────────────────────────────────
  console.log("\n─── 1. Register User ───");
  const register = await request("POST", "/auth/register", {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    name: "Monthly Summary Tester",
  });
  assert(register.status === 201, "Register returns 201");
  userTokens = register.json.data?.tokens as { accessToken: string; refreshToken: string };
  assert(userTokens != null, "Register returns tokens");

  // ─── 2. Seed Data (categories, transactions, budget) ────────
  console.log("\n─── 2. Seed Data ───");

  // Use unique category names (not in the auto-created defaults)
  const groceries = await request(
    "POST",
    "/categories",
    { name: "Groceries Plus", icon: "Apple", color: "#22C55E" },
    userTokens?.accessToken,
  );
  assert(groceries.status === 201, "Groceries category created");
  const groceriesId = (groceries.json.data?.category as Record<string, unknown>)?.id as string;

  const utilities = await request(
    "POST",
    "/categories",
    { name: "Power & Water", icon: "Zap", color: "#F59E0B" },
    userTokens?.accessToken,
  );
  assert(utilities.status === 201, "Utilities category created");
  const utilitiesId = (utilities.json.data?.category as Record<string, unknown>)?.id as string;

  const incomeCat = await request(
    "POST",
    "/categories",
    { name: "Freelance Income", icon: "Briefcase", color: "#3B82F6" },
    userTokens?.accessToken,
  );
  assert(incomeCat.status === 201, "Income category created");
  const incomeCatId = (incomeCat.json.data?.category as Record<string, unknown>)?.id as string;

  // June 2026 transactions
  // Expenses: $600 in Groceries (top category), $400 in Utilities
  // Income: $5000 Salary (largest transaction)
  await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: 250,
      description: "Weekly groceries",
      date: "2026-06-05",
      categoryId: groceriesId,
    },
    userTokens?.accessToken,
  );
  await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: 350,
      description: "Monthly groceries haul",
      date: "2026-06-18",
      categoryId: groceriesId,
    },
    userTokens?.accessToken,
  );
  await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: 400,
      description: "Electricity bill",
      date: "2026-06-10",
      categoryId: utilitiesId,
    },
    userTokens?.accessToken,
  );
  await request(
    "POST",
    "/transactions",
    {
      type: "INCOME",
      amount: 5000,
      description: "June salary",
      date: "2026-06-01",
      categoryId: incomeCatId,
    },
    userTokens?.accessToken,
  );

  // A transaction outside the month (must be excluded)
  await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: 999,
      description: "May expense",
      date: "2026-05-20",
      categoryId: utilitiesId,
    },
    userTokens?.accessToken,
  );

  // Budget on Groceries: $500 target → $600 spent → over budget
  const budget = await request(
    "POST",
    "/budgets",
    {
      targetAmount: 500,
      alertThreshold: 80,
      period: "MONTHLY",
      startDate: "2026-06-01",
      categoryId: groceriesId,
    },
    userTokens?.accessToken,
  );
  assert(budget.status === 201, "Budget created");
  const budgetId = (budget.json.data?.budget as Record<string, unknown>)?.id as string;
  assert(budgetId != null, "Budget has an ID");

  // ─── 3. Get Monthly Summary (compute only) ─────────────────
  console.log("\n─── 3. Get Summary (GET /notifications/monthly-summary) ───");
  const summaryRes = await request(
    "GET",
    `/notifications/monthly-summary?month=${TEST_MONTH_STR}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(summaryRes.status === 200, "Get summary returns 200");
  assert(summaryRes.json.success === true, "Get summary success=true");

  const summary = summaryRes.json.data?.summary as Record<string, any> | undefined;
  assert(summary != null, "Summary returned");
  assert(summary!.label === "June 2026", `Label is "June 2026" (got ${summary!.label})`);
  assert(summary!.totalIncome === 5000, "Total income is 5000");
  assert(summary!.totalExpenses === 1000, "Total expenses is 1000 (600 + 400)");
  assert(summary!.netSavings === 4000, "Net savings is 4000");
  assert(summary!.transactionCount === 4, "Transaction count is 4 (excludes May expense)");

  // Top spending category
  assert(summary!.topCategory != null, "Top category present");
  assert(summary!.topCategory.categoryName === "Groceries Plus", "Top category is Groceries Plus");
  assert(summary!.topCategory.totalSpent === 600, "Top category spent is 600");
  assert(summary!.topCategory.percentage === 60, "Top category percentage is 60%");

  // Budget performance
  const bp = summary!.budgetPerformance as Record<string, any> | undefined;
  assert(bp != null, "Budget performance present");
  assert(bp!.budgets.length === 1, "One budget in performance");
  assert(bp!.budgets[0].categoryName === "Groceries Plus", "Budget category matches");
  assert(bp!.budgets[0].budgeted === 500, "Budgeted is 500");
  assert(bp!.budgets[0].spent === 600, "Budget spent is 600");
  assert(bp!.budgets[0].percentage === 120, "Budget percentage is 120%");
  assert(bp!.budgets[0].status === "critical", "Budget status is critical (over budget)");
  assert(bp!.onTrackCount === 0, "No on-track budgets");
  assert(bp!.warningCount === 0, "No warning budgets");
  assert(bp!.criticalCount === 1, "One critical budget");
  assert(bp!.overallPercentage === 120, "Overall budget percentage is 120%");

  // Largest transaction
  assert(summary!.largestTransaction != null, "Largest transaction present");
  assert(summary!.largestTransaction.description === "June salary", "Largest is the salary");
  assert(summary!.largestTransaction.amount === 5000, "Largest amount is 5000");

  // ─── 4. Summary with No Data Month ─────────────────────────
  console.log("\n─── 4. Summary for Empty Month ───");
  const emptySummary = await request(
    "GET",
    "/notifications/monthly-summary?month=2025-01",
    undefined,
    userTokens?.accessToken,
  );
  assert(emptySummary.status === 200, "Empty month returns 200");
  const emptyData = emptySummary.json.data?.summary as Record<string, any> | undefined;
  assert(emptyData!.totalIncome === 0, "Empty month income is 0");
  assert(emptyData!.totalExpenses === 0, "Empty month expenses is 0");
  assert(emptyData!.topCategory == null, "Empty month has no top category");
  assert(emptyData!.largestTransaction == null, "Empty month has no largest transaction");

  // ─── 5. Generate Monthly Summary Notification ──────────────
  console.log("\n─── 5. Generate (POST /notifications/monthly-summary/generate) ───");

  // Enable monthlySummary preference first
  const enablePrefs = await request(
    "PUT",
    "/notifications/preferences",
    { monthlySummary: true },
    userTokens?.accessToken,
  );
  assert(enablePrefs.status === 200, "Enable monthlySummary preference");
  const prefsData = enablePrefs.json.data?.preferences as Record<string, unknown> | undefined;
  assert(prefsData?.monthlySummary === true, "Preference persisted");

  const generate = await request(
    "POST",
    `/notifications/monthly-summary/generate?month=${TEST_MONTH_STR}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(generate.status === 200, "Generate returns 200");
  const genData = generate.json.data as Record<string, any> | undefined;
  assert(genData != null, "Generate result returned");
  assert(genData!.generated === 1, "One notification generated");
  assert(genData!.suppressedByPreferences === false, "Not suppressed");
  assert(genData!.notification != null, "Notification returned");
  assert(genData!.notification.type === "MONTHLY_SUMMARY", "Notification type is MONTHLY_SUMMARY");
  assert(
    (genData!.notification.title as string).includes("June 2026"),
    "Notification title contains the month label",
  );
  const notifId = genData!.notification.id as string;
  assert(notifId != null, "Notification has an ID");

  // Notification appears in the notifications list
  const notifs = await request("GET", "/notifications", undefined, userTokens?.accessToken);
  assert(notifs.status === 200, "List notifications returns 200");
  const notifList = notifs.json.data?.notifications as Array<Record<string, any>> | undefined;
  const monthlyNotifs = notifList?.filter((n) => n.type === "MONTHLY_SUMMARY");
  assert(
    monthlyNotifs != null && monthlyNotifs.length === 1,
    "Exactly one MONTHLY_SUMMARY notification",
  );
  assert(
    typeof monthlyNotifs![0].message === "string" &&
      (monthlyNotifs![0].message as string).includes("Income: $5,000.00"),
    "Notification message contains income line",
  );

  // ─── 6. Dedup Within 24h ───────────────────────────────────
  console.log("\n─── 6. Generate Again (24h dedup) ───");
  const generateAgain = await request(
    "POST",
    `/notifications/monthly-summary/generate?month=${TEST_MONTH_STR}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(generateAgain.status === 200, "Second generate returns 200");
  const genData2 = generateAgain.json.data as Record<string, any> | undefined;
  assert(genData2!.generated === 0, "Second generate creates no duplicate");
  assert(genData2!.deduplicated === true, "Second generate flagged as deduplicated");

  // Still only one notification
  const notifsAfter = await request("GET", "/notifications", undefined, userTokens?.accessToken);
  const notifListAfter = notifsAfter.json.data?.notifications as
    Array<Record<string, any>> | undefined;
  const monthlyAfter = notifListAfter?.filter((n) => n.type === "MONTHLY_SUMMARY");
  assert(monthlyAfter?.length === 1, "Still exactly one MONTHLY_SUMMARY notification");

  // ─── 7. Preference Gating ──────────────────────────────────
  console.log("\n─── 7. Preference Gating (monthlySummary=false) ───");
  const disablePrefs = await request(
    "PUT",
    "/notifications/preferences",
    { monthlySummary: false },
    userTokens?.accessToken,
  );
  assert(disablePrefs.status === 200, "Disable monthlySummary preference");

  const generateDisabled = await request(
    "POST",
    "/notifications/monthly-summary/generate?month=2025-01",
    undefined,
    userTokens?.accessToken,
  );
  assert(generateDisabled.status === 200, "Generate with pref disabled returns 200");
  const genDisabled = generateDisabled.json.data as Record<string, any> | undefined;
  assert(genDisabled!.generated === 0, "No notification generated");
  assert(genDisabled!.suppressedByPreferences === true, "Suppressed by preferences");
  assert(genDisabled!.summary != null, "Summary still returned for preview");

  // No notification created for January 2025
  const notifsDisabled = await request("GET", "/notifications", undefined, userTokens?.accessToken);
  const notifListDisabled = notifsDisabled.json.data?.notifications as
    Array<Record<string, any>> | undefined;
  const janNotifs = notifListDisabled?.filter((n) => (n.title as string).includes("January 2025"));
  assert(janNotifs?.length === 0, "No notification created while disabled");

  // GET preview still works while disabled (compute-only endpoint)
  const previewDisabled = await request(
    "GET",
    "/notifications/monthly-summary?month=2025-01",
    undefined,
    userTokens?.accessToken,
  );
  assert(previewDisabled.status === 200, "GET preview works regardless of preference");

  // Re-enable for later tests
  await request(
    "PUT",
    "/notifications/preferences",
    { monthlySummary: true },
    userTokens?.accessToken,
  );

  // ─── 8. Validation ─────────────────────────────────────────
  console.log("\n─── 8. Validation ───");
  const badMonth = await request(
    "GET",
    "/notifications/monthly-summary?month=not-a-month",
    undefined,
    userTokens?.accessToken,
  );
  assert(badMonth.status === 400, "Invalid month format returns 400");

  const badMonth2 = await request(
    "POST",
    "/notifications/monthly-summary/generate?month=2026-13",
    undefined,
    userTokens?.accessToken,
  );
  assert(badMonth2.status === 400, "Month 13 returns 400");

  // ─── 9. Unauthenticated Access ─────────────────────────────
  console.log("\n─── 9. Unauthenticated Access ───");
  const noAuthGet = await request("GET", "/notifications/monthly-summary?month=2026-06");
  assert(noAuthGet.status === 401, "GET summary without token returns 401");

  const noAuthGen = await request("POST", "/notifications/monthly-summary/generate?month=2026-06");
  assert(noAuthGen.status === 401, "Generate without token returns 401");

  // ─── 10. Ownership Isolation ───────────────────────────────
  console.log("\n─── 10. Ownership Isolation ───");
  const register2 = await request("POST", "/auth/register", {
    email: `ms-test-2-${Date.now()}@example.com`,
    password: TEST_PASSWORD,
    name: "Second User",
  });
  assert(register2.status === 201, "Second user registered");
  const secondTokens = register2.json.data?.tokens as { accessToken: string; refreshToken: string };

  // Second user sees zero data
  const secondSummary = await request(
    "GET",
    `/notifications/monthly-summary?month=${TEST_MONTH_STR}`,
    undefined,
    secondTokens.accessToken,
  );
  assert(secondSummary.status === 200, "Second user summary returns 200");
  const secondData = secondSummary.json.data?.summary as Record<string, any> | undefined;
  assert(secondData!.totalIncome === 0, "Second user sees no income");
  assert(secondData!.totalExpenses === 0, "Second user sees no expenses");

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
  server = app.listen(4022, async () => {
    console.log(`🧪 Test server running on port 4022`);
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
