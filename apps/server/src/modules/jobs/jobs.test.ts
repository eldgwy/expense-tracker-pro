/**
 * Background Jobs Module — API Integration Tests
 *
 * Tests: token-guarded manual triggers (run-all / run-one), each background
 *        job producing the right notifications (budget alerts, reminder
 *        triggers, upcoming bills, monthly summaries), scheduler lifecycle,
 *        validation, and unauthenticated/unauthorized access.
 *
 * Run: npx tsx src/modules/jobs/jobs.test.ts
 *
 * Prerequisites: PostgreSQL running, migrations applied
 */

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env before any imports that read it
config({ path: resolve(__dirname, "../../../../.env") });

// Override env for test isolation. NOTE: env.ts is evaluated at import time,
// so these must be set before `createApp` is imported — we use a dynamic
// import below to guarantee ordering.
process.env.PORT = "4012";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-for-jobs-integration-tests-0123456789";
process.env.JWT_EXPIRES_IN = "1h";
process.env.JWT_REFRESH_EXPIRES_IN = "7d";
process.env.JOBS_TRIGGER_TOKEN = "test-jobs-trigger-token";

import type { Application } from "express";
import type { Server } from "node:http";

// ─── Test Runner ──────────────────────────────────────────────

let passed = 0;
let failed = 0;
let userTokens: { accessToken: string; refreshToken: string } | null = null;
let server: Server;
let app: Application;

const BASE = "http://localhost:4012/api/v1";
const JOBS_TOKEN = "test-jobs-trigger-token";
const TEST_EMAIL = `jobs-test-${Date.now()}@example.com`;
const TEST_PASSWORD = "Test@123456";

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
  jobsToken?: string | null,
): Promise<{ status: number; json: ApiResult }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (jobsToken) headers["x-jobs-token"] = jobsToken;

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

function pastDateStr(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function futureDateStr(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

/** First day of the previous calendar month, YYYY-MM-DD. */
function previousMonthStartStr(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-01`;
}

// ─── Tests ────────────────────────────────────────────────────

async function runTests() {
  // Lazy import so env.ts evaluates AFTER the env overrides above.
  const { startJobsScheduler, stopJobsScheduler, isJobsSchedulerRunning } =
    await import("./jobs.scheduler");

  console.log("\n🧪 Background Jobs Module — API Integration Tests\n");
  console.log(`Test user: ${TEST_EMAIL}\n`);

  // ─── 0. Health Check ───────────────────────────────────────
  console.log("─── 0. Health Check ───");
  const health = await request("GET", "/health");
  assert(health.status === 200, "Health endpoint returns 200");
  assert(health.json.success === true, "Health response success=true");

  // ─── 1. Register Primary User ──────────────────────────────
  console.log("\n─── 1. Register Primary User ───");
  const register = await request("POST", "/auth/register", {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    name: "Jobs Tester",
  });
  assert(register.status === 201, "Register returns 201");
  userTokens = register.json.data?.tokens as { accessToken: string; refreshToken: string };
  assert(userTokens?.accessToken != null, "Access token returned");

  // Category for budget + transactions
  const category = await request(
    "POST",
    "/categories",
    { name: "Groceries", icon: "ShoppingBag", color: "#F59E0B" },
    userTokens?.accessToken,
  );
  assert(category.status === 201, "Category created");
  const categoryId = (category.json.data?.category as Record<string, unknown>)?.id as string;

  // ─── 2. Seed Data for the Four Jobs ────────────────────────
  console.log("\n─── 2. Seed Data (budget, reminders, transactions) ───");

  // 2a. Budget that triggers a warning alert (spend >= 80% threshold)
  const budget = await request(
    "POST",
    "/budgets",
    {
      targetAmount: 1000,
      alertThreshold: 80,
      period: "MONTHLY",
      startDate: previousMonthStartStr(),
      categoryId,
    },
    userTokens?.accessToken,
  );
  assert(budget.status === 201, "Budget created");

  // Expense pushing this month's spend past the 80% threshold
  const txn1 = await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: 850,
      description: "Monthly Groceries Run",
      date: previousMonthStartStr(),
      categoryId,
    },
    userTokens?.accessToken,
  );
  assert(txn1.status === 201, "Expense transaction created");

  // 2b. A due recurring reminder (fires via process-reminders). DAILY with
  // startDate yesterday → nextTriggerDate lands on today.
  const reminder = await request(
    "POST",
    "/reminders",
    {
      type: "RECURRING_EXPENSE",
      title: "Internet Bill",
      amount: 60,
      frequency: "DAILY",
      startDate: pastDateStr(1),
      categoryId,
    },
    userTokens?.accessToken,
  );
  assert(reminder.status === 201, "Due reminder created");

  // 2c. A bill due within the upcoming-bills window (next trigger in ~3 days)
  const bill = await request(
    "POST",
    "/reminders",
    {
      type: "RECURRING_EXPENSE",
      title: "Electricity Bill",
      amount: 120,
      frequency: "DAILY",
      startDate: futureDateStr(2),
    },
    userTokens?.accessToken,
  );
  assert(bill.status === 201, "Upcoming bill reminder created");

  // 2d. Transactions for the monthly summary (previous month income + expense)
  const incomeTxn = await request(
    "POST",
    "/transactions",
    {
      type: "INCOME",
      amount: 5000,
      description: "Salary",
      date: previousMonthStartStr(),
      categoryId,
    },
    userTokens?.accessToken,
  );
  assert(incomeTxn.status === 201, "Income transaction created");

  // 2e. Enable the monthly-summary preference (default is off — the job must
  // respect it, and we need it on to generate a MONTHLY_SUMMARY notification).
  const enableMonthly = await request(
    "PUT",
    "/notifications/preferences",
    { monthlySummary: true },
    userTokens?.accessToken,
  );
  assert(enableMonthly.status === 200, "Monthly summary preference enabled");

  // ─── 3. Token Guarding ─────────────────────────────────────
  console.log("\n─── 3. Token Guarding (POST /jobs) ───");

  const noToken = await request("POST", "/jobs/run-all", undefined, undefined, null);
  assert(noToken.status === 401, "run-all without token returns 401");

  const wrongToken = await request("POST", "/jobs/run-all", undefined, undefined, "wrong-token");
  assert(wrongToken.status === 401, "run-all with wrong token returns 401");

  const noTokenOne = await request("POST", "/jobs/run/check-budgets");
  assert(noTokenOne.status === 401, "run-one without token returns 401");

  // ─── 4. Run a Single Job: check-budgets ────────────────────
  console.log("\n─── 4. Run Single Job (POST /jobs/run/check-budgets) ───");
  const runBudgets = await request(
    "POST",
    "/jobs/run/check-budgets",
    undefined,
    undefined,
    JOBS_TOKEN,
  );
  assert(runBudgets.status === 200, "run check-budgets returns 200");
  assert(runBudgets.json.success === true, "run check-budgets success=true");
  const budgetsData = runBudgets.json.data as Record<string, unknown> | undefined;
  assert(budgetsData?.job === "check-budgets", "Job name reported");
  assert((budgetsData?.generated as number) >= 1, "Budget warning notification generated");

  // ─── 5. Run Single Job: process-reminders ──────────────────
  console.log("\n─── 5. Run Single Job (POST /jobs/run/process-reminders) ───");
  const runReminders = await request(
    "POST",
    "/jobs/run/process-reminders",
    undefined,
    undefined,
    JOBS_TOKEN,
  );
  assert(runReminders.status === 200, "run process-reminders returns 200");
  const remindersData = runReminders.json.data as Record<string, unknown> | undefined;
  assert(remindersData?.job === "process-reminders", "Job name reported");
  assert((remindersData?.generated as number) >= 1, "Reminder notification generated");

  // ─── 6. Run Single Job: detect-upcoming-bills ──────────────
  console.log("\n─── 6. Run Single Job (POST /jobs/run/detect-upcoming-bills) ───");
  const runBills = await request(
    "POST",
    "/jobs/run/detect-upcoming-bills",
    undefined,
    undefined,
    JOBS_TOKEN,
  );
  assert(runBills.status === 200, "run detect-upcoming-bills returns 200");
  const billsData = runBills.json.data as Record<string, unknown> | undefined;
  assert(billsData?.job === "detect-upcoming-bills", "Job name reported");
  const billResults = billsData?.results as Array<Record<string, unknown>> | undefined;
  assert(
    billResults?.some((r) => (r.generated as number) > 0),
    "Bill notification generated for the user",
  );

  // ─── 7. Run Single Job: generate-monthly-summaries ─────────
  console.log("\n─── 7. Run Single Job (POST /jobs/run/generate-monthly-summaries) ───");
  const runSummaries = await request(
    "POST",
    "/jobs/run/generate-monthly-summaries",
    undefined,
    undefined,
    JOBS_TOKEN,
  );
  assert(runSummaries.status === 200, "run generate-monthly-summaries returns 200");
  const summariesData = runSummaries.json.data as Record<string, unknown> | undefined;
  assert(summariesData?.job === "generate-monthly-summaries", "Job name reported");
  assert((summariesData?.generated as number) >= 1, "Monthly summary notification generated");

  // ─── 8. Notifications Created by the Jobs ──────────────────
  console.log("\n─── 8. Notifications Created (GET /notifications) ───");
  const notifications = await request(
    "GET",
    "/notifications?limit=100",
    undefined,
    userTokens?.accessToken,
  );
  assert(notifications.status === 200, "List notifications returns 200");
  const notifList = notifications.json.data?.notifications as
    Array<Record<string, unknown>> | undefined;
  assert(notifList != null, "Notifications array exists");

  const types = notifList!.map((n) => n.type);
  assert(types.includes("BUDGET_WARNING"), "BUDGET_WARNING notification created");
  assert(types.includes("REMINDER"), "REMINDER notification created");
  assert(types.includes("BILL_DUE_SOON"), "BILL_DUE_SOON notification created");
  assert(types.includes("MONTHLY_SUMMARY"), "MONTHLY_SUMMARY notification created");

  // ─── 9. Re-run Deduplication (24h window) ──────────────────
  console.log("\n─── 9. Re-run Jobs (dedup within 24h) ───");
  const rerunBudgets = await request(
    "POST",
    "/jobs/run/check-budgets",
    undefined,
    undefined,
    JOBS_TOKEN,
  );
  assert(rerunBudgets.status === 200, "Re-run check-budgets returns 200");
  const rerunBudgetsData = rerunBudgets.json.data as Record<string, unknown> | undefined;
  assert(
    (rerunBudgetsData?.generated as number) === 0,
    "No duplicate budget alerts on re-run (dedup)",
  );

  const rerunSummaries = await request(
    "POST",
    "/jobs/run/generate-monthly-summaries",
    undefined,
    undefined,
    JOBS_TOKEN,
  );
  assert(rerunSummaries.status === 200, "Re-run summaries returns 200");
  const rerunSummariesData = rerunSummaries.json.data as Record<string, unknown> | undefined;
  assert(
    (rerunSummariesData?.generated as number) === 0,
    "No duplicate monthly summary on re-run (dedup)",
  );

  // ─── 10. Run All ───────────────────────────────────────────
  console.log("\n─── 10. Run All (POST /jobs/run-all) ───");
  const runAll = await request("POST", "/jobs/run-all", undefined, undefined, JOBS_TOKEN);
  assert(runAll.status === 200, "run-all returns 200");
  assert(runAll.json.success === true, "run-all success=true");
  const runAllData = runAll.json.data as Record<string, unknown> | undefined;
  const allResults = runAllData?.results as Record<string, unknown> | undefined;
  assert(allResults != null, "Per-job results returned");
  assert(typeof runAllData?.totalGenerated === "number", "totalGenerated present");
  assert(typeof runAllData?.totalErrors === "number", "totalErrors present");

  // ─── 11. Validation ────────────────────────────────────────
  console.log("\n─── 11. Validation ───");
  const badJob = await request("POST", "/jobs/run/not-a-job", undefined, undefined, JOBS_TOKEN);
  assert(badJob.status === 400, "Invalid job name returns 400");

  const badWindow = await request(
    "POST",
    "/jobs/run/detect-upcoming-bills?windowDays=0",
    undefined,
    undefined,
    JOBS_TOKEN,
  );
  assert(badWindow.status === 400, "Invalid windowDays returns 400");

  // ─── 12. Scheduler Lifecycle ───────────────────────────────
  console.log("\n─── 12. Scheduler Lifecycle ───");
  assert(isJobsSchedulerRunning() === false, "Scheduler not running before start");
  startJobsScheduler();
  assert(isJobsSchedulerRunning() === true, "Scheduler running after start");
  startJobsScheduler(); // idempotent
  assert(isJobsSchedulerRunning() === true, "Scheduler start is idempotent");
  stopJobsScheduler();
  assert(isJobsSchedulerRunning() === false, "Scheduler stopped after stop");

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
  // Dynamic imports AFTER env overrides are set (see note at top of file).
  const { createApp } = await import("../../app.js");
  const { stopJobsScheduler } = await import("./jobs.scheduler");
  app = createApp();
  server = app.listen(4012, async () => {
    console.log(`🧪 Test server running on port 4012`);
    try {
      await runTests();
    } finally {
      stopJobsScheduler();
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
