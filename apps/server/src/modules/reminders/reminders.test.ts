/**
 * Recurring Reminders Module — Full API Integration Tests
 *
 * Tests: create reminders for recurring expenses, recurring income,
 *        savings contributions, and custom reminders; list/get/update/delete;
 *        trigger due reminders (creates notifications + advances schedule);
 *        notification preferences gating; validation; ownership.
 *
 * Run: npx tsx src/modules/reminders/reminders.test.ts
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

// Override port for test isolation
process.env.PORT = "4009";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-for-reminders-integration-tests";
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
let server: Server;
let app: Application;

const BASE = "http://localhost:4009/api/v1";
const TEST_EMAIL = `rem-test-${Date.now()}@example.com`;
const TEST_PASSWORD = "Test@123456";
const SECOND_USER_EMAIL = `rem-test-2-${Date.now()}@example.com`;

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

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
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

// ─── Tests ────────────────────────────────────────────────────

async function runTests() {
  console.log("\n🧪 Recurring Reminders Module — API Integration Tests\n");
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
    name: "Reminder Tester",
  });
  assert(register.status === 201, "Register returns 201");
  assert(register.json.data?.user != null, "Register returns user");
  assert(register.json.data?.tokens != null, "Register returns tokens");
  userTokens = register.json.data?.tokens as { accessToken: string; refreshToken: string };

  // Create a category + savings goal for linked reminders
  const category = await request(
    "POST",
    "/categories",
    { name: "Rent", icon: "Home", color: "#6366F1" },
    userTokens?.accessToken,
  );
  assert(category.status === 201, "Category created");
  const categoryId = (category.json.data?.category as Record<string, unknown>)?.id as string;

  const goal = await request(
    "POST",
    "/savings-goals",
    { name: "Emergency Fund", targetAmount: 5000, currentAmount: 1000, priority: "HIGH" },
    userTokens?.accessToken,
  );
  assert(goal.status === 201, "Savings goal created");
  const goalId = (goal.json.data?.savingsGoal as Record<string, unknown>)?.id as string;

  // ─── 2. Create Recurring Expense Reminder ──────────────────
  console.log("\n─── 2. Create Recurring Expense (POST /reminders) ───");
  const expData = {
    type: "RECURRING_EXPENSE",
    title: "Monthly Rent",
    amount: 1200,
    frequency: "MONTHLY",
    dayOfMonth: 1,
    startDate: pastDateStr(5),
    categoryId,
  };
  const createdExp = await request("POST", "/reminders", expData, userTokens?.accessToken);
  assert(createdExp.status === 201, "Create recurring expense returns 201");
  assert(createdExp.json.success === true, "Create recurring expense success=true");
  const expReminder = createdExp.json.data?.reminder as Record<string, unknown> | undefined;
  assert(expReminder != null, "Reminder returned");
  assert(expReminder!.type === "RECURRING_EXPENSE", "Type matches");
  assert(expReminder!.title === "Monthly Rent", "Title matches");
  assert(expReminder!.amount === 1200, "Amount matches");
  assert(expReminder!.frequency === "MONTHLY", "Frequency matches");
  assert(expReminder!.interval === 1, "Interval defaults to 1");
  assert(expReminder!.dayOfMonth === 1, "Day of month matches");
  assert(expReminder!.enabled === true, "Enabled defaults to true");
  assert(expReminder!.nextTriggerDate != null, "Next trigger date computed");
  assert(expReminder!.category != null, "Category relation included");
  const expId = expReminder!.id as string;
  assert(expId != null, "Reminder has an ID");

  // ─── 3. Create Recurring Income Reminder ───────────────────
  console.log("\n─── 3. Create Recurring Income ───");
  const incomeData = {
    type: "RECURRING_INCOME",
    title: "Salary",
    amount: 5000,
    frequency: "WEEKLY",
    dayOfWeek: 5,
    startDate: pastDateStr(3),
  };
  const createdInc = await request("POST", "/reminders", incomeData, userTokens?.accessToken);
  assert(createdInc.status === 201, "Create recurring income returns 201");
  const incReminder = createdInc.json.data?.reminder as Record<string, unknown> | undefined;
  assert(incReminder!.type === "RECURRING_INCOME", "Type matches");
  assert(incReminder!.frequency === "WEEKLY", "Frequency matches");
  assert(incReminder!.dayOfWeek === 5, "Day of week matches");

  // ─── 4. Create Savings Contribution Reminder ───────────────
  console.log("\n─── 4. Create Savings Contribution ───");
  const contribData = {
    type: "SAVINGS_CONTRIBUTION",
    title: "Emergency Fund Top-up",
    amount: 250,
    frequency: "MONTHLY",
    dayOfMonth: 15,
    startDate: pastDateStr(10),
    savingsGoalId: goalId,
  };
  const createdContrib = await request("POST", "/reminders", contribData, userTokens?.accessToken);
  assert(createdContrib.status === 201, "Create savings contribution returns 201");
  const contribReminder = createdContrib.json.data?.reminder as Record<string, unknown> | undefined;
  assert(contribReminder!.type === "SAVINGS_CONTRIBUTION", "Type matches");
  assert(contribReminder!.savingsGoal != null, "Savings goal relation included");
  assert(
    (contribReminder!.savingsGoal as Record<string, unknown>)!.name === "Emergency Fund",
    "Goal name included",
  );

  // ─── 5. Create Custom Reminder ─────────────────────────────
  console.log("\n─── 5. Create Custom Reminder ───");
  const customData = {
    type: "CUSTOM",
    title: "Renew Car Insurance",
    message: "Shop around for the best quote this month.",
    frequency: "YEARLY",
    dayOfMonth: 20,
    startDate: todayStr(),
  };
  const createdCustom = await request("POST", "/reminders", customData, userTokens?.accessToken);
  assert(createdCustom.status === 201, "Create custom reminder returns 201");
  const customReminder = createdCustom.json.data?.reminder as Record<string, unknown> | undefined;
  assert(customReminder!.type === "CUSTOM", "Type matches");
  assert(
    customReminder!.message === "Shop around for the best quote this month.",
    "Message matches",
  );
  assert(customReminder!.amount == null, "Custom reminder has no amount");
  assert(customReminder!.frequency === "YEARLY", "Frequency matches");
  const customId = customReminder!.id as string;

  // Daily reminder that will be due for the trigger tests
  const dailyData = {
    type: "CUSTOM",
    title: "Daily Standup Note",
    frequency: "DAILY",
    startDate: pastDateStr(1),
  };
  const createdDaily = await request("POST", "/reminders", dailyData, userTokens?.accessToken);
  assert(createdDaily.status === 201, "Create daily reminder returns 201");
  const dailyReminder = createdDaily.json.data?.reminder as Record<string, unknown> | undefined;
  const dailyId = dailyReminder!.id as string;

  // ─── 6. List Reminders ─────────────────────────────────────
  console.log("\n─── 6. List Reminders (GET /reminders) ───");
  const list = await request("GET", "/reminders", undefined, userTokens?.accessToken);
  assert(list.status === 200, "List reminders returns 200");
  assert(list.json.success === true, "List reminders success=true");
  const remindersList = list.json.data?.reminders as Array<Record<string, unknown>> | undefined;
  assert(remindersList != null, "Reminders array exists");
  assert(remindersList!.length >= 5, "At least 5 reminders exist");
  assert(remindersList![0].category !== undefined, "Reminder includes relations");

  // Filter by type
  const typeFilter = await request(
    "GET",
    "/reminders?type=RECURRING_EXPENSE",
    undefined,
    userTokens?.accessToken,
  );
  assert(typeFilter.status === 200, "Type filter returns 200");
  const typeFiltered = typeFilter.json.data?.reminders as
    Array<Record<string, unknown>> | undefined;
  assert(typeFiltered!.length === 1, "Type filter returns only expense reminders");
  for (const r of typeFiltered!) {
    assert(r.type === "RECURRING_EXPENSE", "Type filter only returns matching type");
  }

  // Filter by frequency
  const freqFilter = await request(
    "GET",
    "/reminders?frequency=DAILY",
    undefined,
    userTokens?.accessToken,
  );
  assert(freqFilter.status === 200, "Frequency filter returns 200");
  const freqFiltered = freqFilter.json.data?.reminders as
    Array<Record<string, unknown>> | undefined;
  assert(freqFiltered!.length >= 1, "Frequency filter returns daily reminders");
  for (const r of freqFiltered!) {
    assert(r.frequency === "DAILY", "Frequency filter only returns matching frequency");
  }

  // Filter by enabled=false
  const disabledFilter = await request(
    "GET",
    "/reminders?enabled=false",
    undefined,
    userTokens?.accessToken,
  );
  assert(disabledFilter.status === 200, "Enabled filter returns 200");
  const disabledList = disabledFilter.json.data?.reminders as
    Array<Record<string, unknown>> | undefined;
  assert(disabledList!.length === 0, "No disabled reminders yet");

  // ─── 7. Get Reminder by ID ─────────────────────────────────
  console.log("\n─── 7. Get Reminder (GET /reminders/:id) ───");
  const byId = await request("GET", `/reminders/${expId}`, undefined, userTokens?.accessToken);
  assert(byId.status === 200, "Get reminder by ID returns 200");
  assert(byId.json.success === true, "Get reminder success=true");
  const fetched = byId.json.data?.reminder as Record<string, unknown> | undefined;
  assert(fetched!.id === expId, "Reminder ID matches");
  assert(fetched!.title === "Monthly Rent", "Title matches");

  // Non-existent reminder returns 404
  const notFound = await request(
    "GET",
    "/reminders/00000000-0000-0000-0000-000000000000",
    undefined,
    userTokens?.accessToken,
  );
  assert(notFound.status === 404, "Non-existent reminder returns 404");

  // Invalid UUID returns 400
  const badId = await request("GET", "/reminders/not-a-uuid", undefined, userTokens?.accessToken);
  assert(badId.status === 400, "Invalid UUID returns 400");

  // ─── 8. Update Reminder ────────────────────────────────────
  console.log("\n─── 8. Update Reminder (PATCH /reminders/:id) ───");

  // Partial update — only title
  const partialUpdate = await request(
    "PATCH",
    `/reminders/${expId}`,
    { title: "Monthly Rent (Apartment)" },
    userTokens?.accessToken,
  );
  assert(partialUpdate.status === 200, "Partial update returns 200");
  const partialReminder = partialUpdate.json.data?.reminder as Record<string, unknown> | undefined;
  assert(partialReminder!.title === "Monthly Rent (Apartment)", "Title updated");
  assert(partialReminder!.amount === 1200, "Amount unchanged");

  // Disable reminder
  const disable = await request(
    "PATCH",
    `/reminders/${dailyId}`,
    { enabled: false },
    userTokens?.accessToken,
  );
  assert(disable.status === 200, "Disable reminder returns 200");
  const disabledReminder = disable.json.data?.reminder as Record<string, unknown> | undefined;
  assert(disabledReminder!.enabled === false, "Reminder disabled");

  // Re-enable for trigger tests
  await request("PATCH", `/reminders/${dailyId}`, { enabled: true }, userTokens?.accessToken);

  // ─── 9. Trigger Due Reminders ──────────────────────────────
  console.log("\n─── 9. Trigger Due (POST /reminders/trigger) ───");
  const trigger = await request("POST", "/reminders/trigger", undefined, userTokens?.accessToken);
  assert(trigger.status === 200, "Trigger returns 200");
  assert(trigger.json.success === true, "Trigger success=true");
  const triggerData = trigger.json.data as Record<string, unknown> | undefined;
  assert(triggerData != null, "Trigger result returned");
  assert((triggerData!.generated as number) >= 1, "At least one notification generated");
  const triggeredList = triggerData!.triggered as Array<Record<string, unknown>> | undefined;
  assert(triggeredList!.length >= 1, "Triggered list populated");

  // The daily reminder should have been triggered
  const dailyTriggered = triggeredList!.some((t) => t.title === "Daily Standup Note");
  assert(dailyTriggered, "Daily reminder was triggered");

  // ─── 10. Notifications Created by Trigger ──────────────────
  console.log("\n─── 10. Notifications Created (GET /notifications) ───");
  const notifications = await request("GET", "/notifications", undefined, userTokens?.accessToken);
  assert(notifications.status === 200, "List notifications returns 200");
  const notifList = notifications.json.data?.notifications as
    Array<Record<string, unknown>> | undefined;
  const reminderNotifications = notifList!.filter((n) => n.type === "REMINDER");
  assert(reminderNotifications.length >= 1, "At least one REMINDER notification exists");
  const firstNotif = reminderNotifications[0];
  assert(firstNotif!.title === "Daily Standup Note", "Notification title matches reminder title");
  assert(
    typeof firstNotif!.message === "string" && (firstNotif!.message as string).length > 0,
    "Notification has a message",
  );

  // ─── 11. Trigger Advances Schedule (no duplicate re-trigger) ─
  console.log("\n─── 11. Trigger Again (dedup via schedule advance) ───");
  const trigger2 = await request("POST", "/reminders/trigger", undefined, userTokens?.accessToken);
  assert(trigger2.status === 200, "Second trigger returns 200");
  const trigger2Data = trigger2.json.data as Record<string, unknown> | undefined;
  const dailyTriggered2 = (trigger2Data!.triggered as
    Array<Record<string, unknown>> | undefined)!.some((t) => t.title === "Daily Standup Note");
  assert(!dailyTriggered2, "Daily reminder not triggered again (schedule advanced)");

  // Daily reminder's nextTriggerDate should be tomorrow
  const dailyAfter = await request(
    "GET",
    `/reminders/${dailyId}`,
    undefined,
    userTokens?.accessToken,
  );
  const dailyAfterData = dailyAfter.json.data?.reminder as Record<string, unknown> | undefined;
  const nextStr = (dailyAfterData!.nextTriggerDate as string).slice(0, 10);
  assert(nextStr === futureDateStr(1), "Daily reminder advanced to tomorrow");
  assert(dailyAfterData!.lastTriggeredAt != null, "lastTriggeredAt recorded");

  // ─── 12. Preferences Gating ────────────────────────────────
  console.log("\n─── 12. Notification Preferences Gating ───");

  // Disable notifications globally
  const disablePrefs = await request(
    "PUT",
    "/notifications/preferences",
    { enabled: false },
    userTokens?.accessToken,
  );
  assert(disablePrefs.status === 200, "Update preferences returns 200");

  // Create a fresh daily reminder that is due immediately
  await request(
    "POST",
    "/reminders",
    { type: "CUSTOM", title: "Due While Disabled", frequency: "DAILY", startDate: pastDateStr(1) },
    userTokens?.accessToken,
  );

  const triggerDisabled = await request(
    "POST",
    "/reminders/trigger",
    undefined,
    userTokens?.accessToken,
  );
  assert(triggerDisabled.status === 200, "Trigger with prefs disabled returns 200");
  const disabledData = triggerDisabled.json.data as Record<string, unknown> | undefined;
  assert(
    disabledData!.suppressedByPreferences === true,
    "suppressedByPreferences=true when globally disabled",
  );
  const freshTriggered = (disabledData!.triggered as
    Array<Record<string, unknown>> | undefined)!.some(
    (t) => t.title === "Due While Disabled" && t.suppressed === true,
  );
  assert(freshTriggered, "Due reminder marked suppressed but schedule advanced");

  // No REMINDER notification created while disabled
  const notificationsDisabled = await request(
    "GET",
    "/notifications",
    undefined,
    userTokens?.accessToken,
  );
  const notifListDisabled = notificationsDisabled.json.data?.notifications as
    Array<Record<string, unknown>> | undefined;
  const suppressedNotifs = notifListDisabled!.filter((n) => n.title === "Due While Disabled");
  assert(suppressedNotifs.length === 0, "No notification created while disabled");

  // Re-enable notifications
  const enablePrefs = await request(
    "PUT",
    "/notifications/preferences",
    { enabled: true },
    userTokens?.accessToken,
  );
  assert(enablePrefs.status === 200, "Re-enable preferences returns 200");

  // ─── 13. Validation ────────────────────────────────────────
  console.log("\n─── 13. Validation ───");

  // Missing title
  const missingTitle = await request(
    "POST",
    "/reminders",
    { type: "CUSTOM", startDate: todayStr() },
    userTokens?.accessToken,
  );
  assert(missingTitle.status === 400, "Missing title returns 400");

  // Missing startDate
  const missingStart = await request(
    "POST",
    "/reminders",
    { type: "CUSTOM", title: "No Start" },
    userTokens?.accessToken,
  );
  assert(missingStart.status === 400, "Missing startDate returns 400");

  // Invalid type
  const badType = await request(
    "POST",
    "/reminders",
    { type: "EVERYTHING", title: "Bad", startDate: todayStr() },
    userTokens?.accessToken,
  );
  assert(badType.status === 400, "Invalid type returns 400");

  // Invalid frequency
  const badFreq = await request(
    "POST",
    "/reminders",
    { type: "CUSTOM", title: "Bad", frequency: "HOURLY", startDate: todayStr() },
    userTokens?.accessToken,
  );
  assert(badFreq.status === 400, "Invalid frequency returns 400");

  // Negative amount
  const negAmount = await request(
    "POST",
    "/reminders",
    { type: "RECURRING_EXPENSE", title: "Bad", amount: -5, startDate: todayStr() },
    userTokens?.accessToken,
  );
  assert(negAmount.status === 400, "Negative amount returns 400");

  // Invalid dayOfWeek
  const badDow = await request(
    "POST",
    "/reminders",
    { type: "CUSTOM", title: "Bad", frequency: "WEEKLY", dayOfWeek: 9, startDate: todayStr() },
    userTokens?.accessToken,
  );
  assert(badDow.status === 400, "Invalid dayOfWeek returns 400");

  // Invalid dayOfMonth
  const badDom = await request(
    "POST",
    "/reminders",
    { type: "CUSTOM", title: "Bad", frequency: "MONTHLY", dayOfMonth: 32, startDate: todayStr() },
    userTokens?.accessToken,
  );
  assert(badDom.status === 400, "Invalid dayOfMonth returns 400");

  // Invalid date format
  const badDate = await request(
    "POST",
    "/reminders",
    { type: "CUSTOM", title: "Bad", startDate: "not-a-date" },
    userTokens?.accessToken,
  );
  assert(badDate.status === 400, "Invalid date format returns 400");

  // Category not owned by user
  const foreignCategory = await request(
    "POST",
    "/reminders",
    {
      type: "RECURRING_EXPENSE",
      title: "Foreign",
      amount: 100,
      startDate: todayStr(),
      categoryId: "00000000-0000-0000-0000-000000000000",
    },
    userTokens?.accessToken,
  );
  assert(foreignCategory.status === 400, "Category not owned returns 400");

  // Amount required for financial reminder types
  const missingAmount = await request(
    "POST",
    "/reminders",
    { type: "RECURRING_EXPENSE", title: "No Amount", startDate: todayStr() },
    userTokens?.accessToken,
  );
  assert(missingAmount.status === 400, "Financial reminder without amount returns 400");

  // ─── 14. Ownership Validation ──────────────────────────────
  console.log("\n─── 14. Ownership Validation ───");

  // Register a second user
  const register2 = await request("POST", "/auth/register", {
    email: SECOND_USER_EMAIL,
    password: TEST_PASSWORD,
    name: "Second User",
  });
  assert(register2.status === 201, "Second user registered");
  secondUserTokens = register2.json.data?.tokens as { accessToken: string; refreshToken: string };

  // Second user's list should NOT include primary user's reminders
  const secondList = await request("GET", "/reminders", undefined, secondUserTokens?.accessToken);
  assert(secondList.status === 200, "Second user list returns 200");
  const secondReminders = secondList.json.data?.reminders as
    Array<Record<string, unknown>> | undefined;
  assert(secondReminders!.length === 0, "Second user has no reminders");

  // Second user cannot get primary user's reminder by ID
  const forbiddenGet = await request(
    "GET",
    `/reminders/${expId}`,
    undefined,
    secondUserTokens?.accessToken,
  );
  assert(forbiddenGet.status === 404, "Second user gets 404 on primary's reminder");

  // Second user cannot update primary user's reminder
  const forbiddenUpdate = await request(
    "PATCH",
    `/reminders/${expId}`,
    { title: "Hacked" },
    secondUserTokens?.accessToken,
  );
  assert(forbiddenUpdate.status === 404, "Second user gets 404 on update");

  // Second user cannot delete primary user's reminder
  const forbiddenDelete = await request(
    "DELETE",
    `/reminders/${expId}`,
    undefined,
    secondUserTokens?.accessToken,
  );
  assert(forbiddenDelete.status === 404, "Second user gets 404 on delete");

  // ─── 15. Delete Reminder ───────────────────────────────────
  console.log("\n─── 15. Delete Reminder (DELETE /reminders/:id) ───");
  const deleted = await request(
    "DELETE",
    `/reminders/${customId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(deleted.status === 204, "Delete returns 204 No Content");

  // Verify it's gone
  const gone = await request("GET", `/reminders/${customId}`, undefined, userTokens?.accessToken);
  assert(gone.status === 404, "Deleted reminder returns 404");

  // Delete non-existent reminder
  const deleteGone = await request(
    "DELETE",
    `/reminders/${customId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(deleteGone.status === 404, "Delete non-existent returns 404");

  // ─── 16. Unauthenticated Access ────────────────────────────
  console.log("\n─── 16. Unauthenticated Access ───");
  const noAuthList = await request("GET", "/reminders");
  assert(noAuthList.status === 401, "List reminders without token returns 401");

  const noAuthTrigger = await request("POST", "/reminders/trigger");
  assert(noAuthTrigger.status === 401, "Trigger without token returns 401");

  const noAuthCreate = await request("POST", "/reminders", {
    type: "CUSTOM",
    title: "No Auth",
    startDate: todayStr(),
  });
  assert(noAuthCreate.status === 401, "Create reminder without token returns 401");

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
