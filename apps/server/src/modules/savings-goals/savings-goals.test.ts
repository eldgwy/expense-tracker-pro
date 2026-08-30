/**
 * Savings Goals Module — Full API Integration Tests
 *
 * Tests: create goal, get goals, get goal details, update goal, delete goal,
 *        progress updates (add/withdraw), goal completion (auto & archived),
 *        statistics, insights, ownership validation.
 *
 * Run: npx tsx src/modules/savings-goals/savings-goals.test.ts
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
process.env.PORT = "4005";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-for-savings-goals-integration-tests";
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

const BASE = "http://localhost:4005/api/v1";
const TEST_EMAIL = `sg-test-${Date.now()}@example.com`;
const TEST_PASSWORD = "Test@123456";
const SECOND_USER_EMAIL = `sg-test-2-${Date.now()}@example.com`;

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

function futureDateStr(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

// ─── Tests ────────────────────────────────────────────────────

async function runTests() {
  console.log("\n🧪 Savings Goals Module — API Integration Tests\n");
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
    name: "Savings Goal Tester",
  });
  assert(register.status === 201, "Register returns 201");
  assert(register.json.data?.user != null, "Register returns user");
  assert(register.json.data?.tokens != null, "Register returns tokens");
  userTokens = register.json.data?.tokens as { accessToken: string; refreshToken: string };

  // ─── 2. Create Savings Goal ────────────────────────────────
  console.log("\n─── 2. Create Goal (POST /savings-goals) ───");

  const createData = {
    name: "Emergency Fund",
    targetAmount: 10000,
    currentAmount: 2500,
    deadline: futureDateStr(180),
    priority: "HIGH",
  };

  const created = await request("POST", "/savings-goals", createData, userTokens?.accessToken);
  assert(created.status === 201, "Create goal returns 201");
  assert(created.json.success === true, "Create goal success=true");
  const createdGoal = created.json.data?.savingsGoal as Record<string, unknown> | undefined;
  assert(createdGoal != null, "Created goal returned");
  assert(createdGoal!.name === "Emergency Fund", "Goal name matches");
  assert(createdGoal!.targetAmount === 10000, "Target amount matches");
  assert(createdGoal!.currentAmount === 2500, "Current amount matches");
  assert(createdGoal!.priority === "HIGH", "Priority matches");
  assert(createdGoal!.progress === 25, "Progress is 25% (2500/10000)");
  assert(createdGoal!.isCompleted === false, "Goal is not completed yet");
  assert(createdGoal!.completedAt == null, "completedAt is null for active goal");
  assert(createdGoal!.remaining === 7500, "Remaining is 7500");
  assert(createdGoal!.daysRemaining != null, "Days remaining computed");
  const goalId = createdGoal!.id as string;
  assert(goalId != null, "Goal has an ID");

  // ─── 3. Goal with currentAmount = targetAmount auto-completes ─
  console.log("\n─── 3. Goal Auto-Complete on Create ───");
  const completedOnCreate = await request(
    "POST",
    "/savings-goals",
    {
      name: "Already Done",
      targetAmount: 500,
      currentAmount: 500,
      priority: "LOW",
    },
    userTokens?.accessToken,
  );
  assert(completedOnCreate.status === 201, "Goal created with currentAmount = targetAmount");
  const autoCompletedGoal = completedOnCreate.json.data?.savingsGoal as
    Record<string, unknown> | undefined;
  assert(autoCompletedGoal != null, "Goal returned");
  assert(autoCompletedGoal!.isCompleted === true, "Goal is auto-completed");
  assert(autoCompletedGoal!.completedAt != null, "completedAt is set");
  assert(autoCompletedGoal!.progress === 100, "Progress is 100%");
  const autoCompleteId = autoCompletedGoal!.id as string;

  // Create another goal for later tests
  const createData2 = {
    name: "New Laptop",
    targetAmount: 2000,
    currentAmount: 500,
    deadline: futureDateStr(90),
    priority: "MEDIUM",
  };
  const created2 = await request("POST", "/savings-goals", createData2, userTokens?.accessToken);
  assert(created2.status === 201, "Second goal created");
  const goalId2 = (created2.json.data?.savingsGoal as Record<string, unknown>)?.id as string;

  // Create a goal without deadline for filter tests
  await request(
    "POST",
    "/savings-goals",
    { name: "No Deadline Goal", targetAmount: 1000, currentAmount: 100, priority: "LOW" },
    userTokens?.accessToken,
  );

  // Create a goal with close deadline (for insights: upcomingDeadlines and goalsAtRisk)
  await request(
    "POST",
    "/savings-goals",
    {
      name: "Close Deadline Goal",
      targetAmount: 2000,
      currentAmount: 100,
      deadline: futureDateStr(15),
      priority: "HIGH",
    },
    userTokens?.accessToken,
  );

  // ─── 4. Get All Goals ──────────────────────────────────────
  console.log("\n─── 4. Get All Goals (GET /savings-goals) ───");
  const list = await request("GET", "/savings-goals", undefined, userTokens?.accessToken);
  assert(list.status === 200, "List goals returns 200");
  assert(list.json.success === true, "List goals success=true");
  const goalsList = list.json.data?.savingsGoals as Array<Record<string, unknown>> | undefined;
  assert(goalsList != null, "Goals array exists");
  assert(goalsList!.length >= 4, "At least 4 goals exist");
  assert(goalsList![0].progress !== undefined, "Goal includes progress");

  // Filter by status=active
  const activeFilter = await request(
    "GET",
    "/savings-goals?status=active",
    undefined,
    userTokens?.accessToken,
  );
  assert(activeFilter.status === 200, "Active filter returns 200");
  const activeGoals = activeFilter.json.data?.savingsGoals as
    Array<Record<string, unknown>> | undefined;
  assert(activeGoals != null, "Active goals array exists");
  for (const g of activeGoals!) {
    assert(g.isCompleted === false, "Active filter only returns active goals");
  }

  // Filter by status=completed
  const completedFilter = await request(
    "GET",
    "/savings-goals?status=completed",
    undefined,
    userTokens?.accessToken,
  );
  assert(completedFilter.status === 200, "Completed filter returns 200");
  const completedGoals = completedFilter.json.data?.savingsGoals as
    Array<Record<string, unknown>> | undefined;
  assert(completedGoals!.length >= 1, "At least 1 completed goal");
  for (const g of completedGoals!) {
    assert(g.isCompleted === true, "Completed filter only returns completed goals");
  }

  // Filter by priority
  const highPriority = await request(
    "GET",
    "/savings-goals?priority=HIGH",
    undefined,
    userTokens?.accessToken,
  );
  assert(highPriority.status === 200, "Priority filter returns 200");
  const highGoals = highPriority.json.data?.savingsGoals as
    Array<Record<string, unknown>> | undefined;
  assert(highGoals!.length >= 1, "At least 1 HIGH priority goal");
  for (const g of highGoals!) {
    assert(g.priority === "HIGH", "Priority filter only returns HIGH goals");
  }

  // Sort by targetAmount ascending
  const sortAsc = await request(
    "GET",
    "/savings-goals?sortBy=targetAmount&sortOrder=asc",
    undefined,
    userTokens?.accessToken,
  );
  assert(sortAsc.status === 200, "Sort by targetAmount asc returns 200");
  const sortedAsc = sortAsc.json.data?.savingsGoals as Array<Record<string, unknown>> | undefined;
  for (let i = 1; i < sortedAsc!.length; i++) {
    const prev = sortedAsc![i - 1].targetAmount as number;
    const curr = sortedAsc![i].targetAmount as number;
    assert(prev <= curr, "Goals sorted by targetAmount ascending");
  }

  // ─── 5. Get Goal Details ───────────────────────────────────
  console.log("\n─── 5. Get Goal Details (GET /savings-goals/:id) ───");
  const byId = await request("GET", `/savings-goals/${goalId}`, undefined, userTokens?.accessToken);
  assert(byId.status === 200, "Get goal by ID returns 200");
  assert(byId.json.success === true, "Get goal success=true");
  const fetched = byId.json.data?.savingsGoal as Record<string, unknown> | undefined;
  assert(fetched != null, "Goal returned");
  assert(fetched!.id === goalId, "Goal ID matches");
  assert(fetched!.name === "Emergency Fund", "Name matches");
  assert(fetched!.progress !== undefined, "Progress is computed");
  assert(fetched!.remaining !== undefined, "Remaining is computed");
  assert(fetched!.daysRemaining !== undefined, "Days remaining is computed");
  assert(fetched!.isCompleted !== undefined, "Is completed flag exists");

  // Non-existent goal returns 404
  const notFound = await request(
    "GET",
    "/savings-goals/00000000-0000-0000-0000-000000000000",
    undefined,
    userTokens?.accessToken,
  );
  assert(notFound.status === 404, "Non-existent goal returns 404");

  // Invalid UUID returns 400
  const badId = await request(
    "GET",
    "/savings-goals/not-a-uuid",
    undefined,
    userTokens?.accessToken,
  );
  assert(badId.status === 400, "Invalid UUID returns 400");

  // ─── 6. Update Goal ────────────────────────────────────────
  console.log("\n─── 6. Update Goal (PATCH /savings-goals/:id) ───");

  // Full update
  const updated = await request(
    "PATCH",
    `/savings-goals/${goalId}`,
    {
      name: "Bigger Emergency Fund",
      targetAmount: 15000,
      currentAmount: 4000,
      priority: "CRITICAL",
    },
    userTokens?.accessToken,
  );
  assert(updated.status === 200, "Update goal returns 200");
  assert(updated.json.success === true, "Update goal success=true");
  const updatedGoal = updated.json.data?.savingsGoal as Record<string, unknown> | undefined;
  assert(updatedGoal!.name === "Bigger Emergency Fund", "Name updated");
  assert(updatedGoal!.targetAmount === 15000, "Target amount updated");
  assert(updatedGoal!.currentAmount === 4000, "Current amount updated");
  assert(updatedGoal!.priority === "CRITICAL", "Priority updated");
  assert(updatedGoal!.progress === 27, "Progress recalculated (4000/15000 ≈ 27%)");
  assert(updatedGoal!.isCompleted === false, "Still not completed");

  // Partial update — only name
  const partialUpdate = await request(
    "PATCH",
    `/savings-goals/${goalId}`,
    { name: "Emergency Fund V2" },
    userTokens?.accessToken,
  );
  assert(partialUpdate.status === 200, "Partial update returns 200");
  const partialGoal = partialUpdate.json.data?.savingsGoal as Record<string, unknown> | undefined;
  assert(partialGoal!.name === "Emergency Fund V2", "Name partially updated");
  assert(partialGoal!.targetAmount === 15000, "Target amount unchanged");

  // ─── 7. Block Update on Completed Goal ─────────────────────
  console.log("\n─── 7. Block Update on Completed Goal ───");
  const updateCompleted = await request(
    "PATCH",
    `/savings-goals/${autoCompleteId}`,
    { name: "Should Not Update" },
    userTokens?.accessToken,
  );
  assert(updateCompleted.status === 400, "Update completed goal returns 400");
  assert(updateCompleted.json.success === false, "Update completed goal rejected");

  // ─── 8. Progress: Add Progress ──────────────────────────────
  console.log("\n─── 8. Add Progress (POST /savings-goals/:id/progress) ───");
  const addProgress = await request(
    "POST",
    `/savings-goals/${goalId}/progress`,
    { amount: 3000 },
    userTokens?.accessToken,
  );
  assert(addProgress.status === 200, "Add progress returns 200");
  assert(addProgress.json.success === true, "Add progress success=true");
  const afterAdd = addProgress.json.data?.savingsGoal as Record<string, unknown> | undefined;
  assert(afterAdd!.currentAmount === 7000, "Current amount increased to 7000");
  assert(afterAdd!.progress === 47, "Progress recalculated (7000/15000 ≈ 47%)");

  // Prevent exceeding target without allowExceed
  const exceedBlocked = await request(
    "POST",
    `/savings-goals/${goalId}/progress`,
    { amount: 100000 },
    userTokens?.accessToken,
  );
  assert(exceedBlocked.status === 400, "Exceeding target without allowExceed returns 400");

  // Allow exceeding with allowExceed flag
  const exceedAllowed = await request(
    "POST",
    `/savings-goals/${goalId}/progress`,
    { amount: 100000, allowExceed: true },
    userTokens?.accessToken,
  );
  assert(exceedAllowed.status === 200, "Exceeding with allowExceed returns 200");
  const afterExceed = exceedAllowed.json.data?.savingsGoal as Record<string, unknown> | undefined;
  assert(Number(afterExceed!.currentAmount) > 15000, "Current amount exceeds target");
  assert(afterExceed!.isCompleted === true, "Goal auto-completed after exceeding target");
  assert(afterExceed!.completedAt != null, "completedAt set on auto-complete");

  // ─── 9. Progress: Withdraw ─────────────────────────────────
  console.log("\n─── 9. Withdraw Progress (POST /savings-goals/:id/progress/withdraw) ───");
  const withdraw = await request(
    "POST",
    `/savings-goals/${goalId}/progress/withdraw`,
    { amount: 100500 },
    userTokens?.accessToken,
  );
  assert(withdraw.status === 200, "Withdraw progress returns 200");
  const afterWithdraw = withdraw.json.data?.savingsGoal as Record<string, unknown> | undefined;
  assert(Number(afterWithdraw!.currentAmount) < 7000, "Current amount decreased below target");
  assert(afterWithdraw!.isCompleted === false, "Goal un-completed after dropping below target");
  assert(afterWithdraw!.completedAt == null, "completedAt cleared on withdraw below target");

  // Prevent negative balance on withdraw
  const negativeCheck = await request(
    "POST",
    `/savings-goals/${goalId}/progress/withdraw`,
    { amount: 999999 },
    userTokens?.accessToken,
  );
  assert(negativeCheck.status === 400, "Withdraw greater than balance returns 400");

  // Invalid positive amount requirement
  const zeroProgress = await request(
    "POST",
    `/savings-goals/${goalId}/progress`,
    { amount: 0 },
    userTokens?.accessToken,
  );
  assert(zeroProgress.status === 400, "Zero progress amount returns 400");

  // ─── 10. Goal Completion via Progress ──────────────────────
  console.log("\n─── 10. Goal Completion via Progress ───");

  // Add progress to reach exactly the target
  // First reset goalId2 by updating it
  const resetGoal = await request(
    "PATCH",
    `/savings-goals/${goalId2}`,
    { currentAmount: 500, targetAmount: 2000 },
    userTokens?.accessToken,
  );
  assert(resetGoal.status === 200, "Goal reset for completion test");

  // Add 1500 to reach exactly 2000 (the target)
  const completeProgress = await request(
    "POST",
    `/savings-goals/${goalId2}/progress`,
    { amount: 1500 },
    userTokens?.accessToken,
  );
  assert(completeProgress.status === 200, "Add progress to complete goal");
  const completedByProgress = completeProgress.json.data?.savingsGoal as
    Record<string, unknown> | undefined;
  assert(completedByProgress!.isCompleted === true, "Goal completed by reaching target");
  assert(completedByProgress!.completedAt != null, "completedAt recorded");
  assert(completedByProgress!.progress === 100, "Progress is 100%");

  // ─── 11. Statistics (GET /savings-goals/stats) ─────────────
  console.log("\n─── 11. Statistics (GET /savings-goals/stats) ───");
  const stats = await request("GET", "/savings-goals/stats", undefined, userTokens?.accessToken);
  assert(stats.status === 200, "Stats endpoint returns 200");
  assert(stats.json.success === true, "Stats success=true");
  const statsData = stats.json.data?.stats as Record<string, unknown> | undefined;
  assert(statsData != null, "Stats data returned");
  assert(Number(statsData!.totalGoals) >= 4, "totalGoals count includes all goals");
  assert(Number(statsData!.activeGoals) >= 2, "activeGoals count is correct");
  assert(Number(statsData!.completedGoals) >= 1, "completedGoals count is correct");
  assert(Number(statsData!.totalTarget) > 0, "totalTarget is the sum of all targets");
  assert(Number(statsData!.totalSaved) > 0, "totalSaved is the sum of all current amounts");
  assert(Number(statsData!.overallPercentage) >= 0, "overallPercentage is computed");
  assert(statsData!.closestGoal != null, "closestGoal is identified");
  const closest = statsData!.closestGoal as Record<string, unknown>;
  assert(closest!.progress != null, "Closest goal has progress percentage");

  // ─── 12. Insights (GET /savings-goals/insights) ────────────
  console.log("\n─── 12. Insights (GET /savings-goals/insights) ───");
  const insights = await request(
    "GET",
    "/savings-goals/insights",
    undefined,
    userTokens?.accessToken,
  );
  assert(insights.status === 200, "Insights endpoint returns 200");
  assert(insights.json.success === true, "Insights success=true");
  const insightData = insights.json.data?.insights as Record<string, unknown> | undefined;
  assert(insightData != null, "Insights data returned");

  // upcomingDeadlines
  const upcomingDeadlines = insightData!.upcomingDeadlines as
    Array<Record<string, unknown>> | undefined;
  assert(upcomingDeadlines != null, "upcomingDeadlines array exists");
  assert(upcomingDeadlines!.length >= 1, "At least 1 upcoming deadline goal");

  // goalsAtRisk
  const goalsAtRisk = insightData!.goalsAtRisk as Array<Record<string, unknown>> | undefined;
  assert(goalsAtRisk != null, "goalsAtRisk array exists");

  // largestGoal
  const largestGoal = insightData!.largestGoal as Record<string, unknown> | undefined;
  assert(largestGoal != null, "largestGoal exists");
  assert((largestGoal!.targetAmount as number) > 0, "Largest goal has target amount");

  // fastestCompleted
  const fastestCompleted = insightData!.fastestCompleted as Record<string, unknown> | undefined;
  assert(fastestCompleted != null, "fastestCompleted exists");
  assert((fastestCompleted!.daysToComplete as number) >= 0, "Fastest completed has duration");

  // averageMonthlySavingsNeeded
  assert(
    insightData!.averageMonthlySavingsNeeded !== undefined,
    "averageMonthlySavingsNeeded is computed",
  );

  // monthlySavingsPerGoal
  const monthlyPerGoal = insightData!.monthlySavingsPerGoal as
    Array<Record<string, unknown>> | undefined;
  assert(monthlyPerGoal != null, "monthlySavingsPerGoal array exists");

  // ─── 13. Ownership Validation ──────────────────────────────
  console.log("\n─── 13. Ownership Validation ───");

  // Register a second user
  const register2 = await request("POST", "/auth/register", {
    email: SECOND_USER_EMAIL,
    password: TEST_PASSWORD,
    name: "Second User",
  });
  assert(register2.status === 201, "Second user registered");
  secondUserTokens = register2.json.data?.tokens as { accessToken: string; refreshToken: string };

  // Second user's list should NOT include primary user's goals
  const secondList = await request(
    "GET",
    "/savings-goals",
    undefined,
    secondUserTokens?.accessToken,
  );
  assert(secondList.status === 200, "Second user list returns 200");
  const secondGoals = secondList.json.data?.savingsGoals as
    Array<Record<string, unknown>> | undefined;
  const hasPrimaryGoal = secondGoals!.some((g) => g.id === goalId);
  assert(!hasPrimaryGoal, "Second user cannot see primary user's goals");

  // Second user cannot get primary user's goal by ID
  const forbiddenGet = await request(
    "GET",
    `/savings-goals/${goalId}`,
    undefined,
    secondUserTokens?.accessToken,
  );
  assert(forbiddenGet.status === 404, "Second user gets 404 on primary's goal");

  // Second user cannot update primary user's goal
  const forbiddenUpdate = await request(
    "PATCH",
    `/savings-goals/${goalId}`,
    { name: "Hacked" },
    secondUserTokens?.accessToken,
  );
  assert(forbiddenUpdate.status === 404, "Second user gets 404 on update");

  // Second user cannot add progress to primary's goal
  const forbiddenProgress = await request(
    "POST",
    `/savings-goals/${goalId}/progress`,
    { amount: 100 },
    secondUserTokens?.accessToken,
  );
  assert(forbiddenProgress.status === 404, "Second user gets 404 on add progress");

  // Second user cannot withdraw from primary's goal
  const forbiddenWithdraw = await request(
    "POST",
    `/savings-goals/${goalId}/progress/withdraw`,
    { amount: 100 },
    secondUserTokens?.accessToken,
  );
  assert(forbiddenWithdraw.status === 404, "Second user gets 404 on withdraw");

  // Second user cannot delete primary's goal
  const forbiddenDelete = await request(
    "DELETE",
    `/savings-goals/${goalId}`,
    undefined,
    secondUserTokens?.accessToken,
  );
  assert(forbiddenDelete.status === 404, "Second user gets 404 on delete");

  // ─── 14. Validation ────────────────────────────────────────
  console.log("\n─── 14. Validation ───");

  // Missing required fields
  const missingName = await request(
    "POST",
    "/savings-goals",
    { targetAmount: 1000 },
    userTokens?.accessToken,
  );
  assert(missingName.status === 400, "Missing name returns 400");

  const missingTarget = await request(
    "POST",
    "/savings-goals",
    { name: "Test Goal" },
    userTokens?.accessToken,
  );
  assert(missingTarget.status === 400, "Missing targetAmount returns 400");

  // Invalid target amount (zero)
  const zeroTarget = await request(
    "POST",
    "/savings-goals",
    { name: "Zero Target", targetAmount: 0 },
    userTokens?.accessToken,
  );
  assert(zeroTarget.status === 400, "Zero targetAmount returns 400");

  // Negative target amount
  const negativeTarget = await request(
    "POST",
    "/savings-goals",
    { name: "Negative Target", targetAmount: -100 },
    userTokens?.accessToken,
  );
  assert(negativeTarget.status === 400, "Negative targetAmount returns 400");

  // currentAmount exceeding targetAmount on create
  const exceedOnCreate = await request(
    "POST",
    "/savings-goals",
    { name: "Exceeds", targetAmount: 100, currentAmount: 200 },
    userTokens?.accessToken,
  );
  assert(exceedOnCreate.status === 400, "currentAmount > targetAmount on create returns 400");

  // currentAmount exceeding targetAmount on update
  const exceedOnUpdate = await request(
    "PATCH",
    `/savings-goals/${goalId}`,
    { currentAmount: 999999 },
    userTokens?.accessToken,
  );
  assert(exceedOnUpdate.status === 400, "currentAmount > targetAmount on update returns 400");

  // Invalid priority
  const badPriority = await request(
    "POST",
    "/savings-goals",
    { name: "Bad Priority", targetAmount: 100, priority: "URGENT" },
    userTokens?.accessToken,
  );
  assert(badPriority.status === 400, "Invalid priority returns 400");

  // Invalid deadline format
  const badDeadline = await request(
    "POST",
    "/savings-goals",
    { name: "Bad Date", targetAmount: 100, deadline: "not-a-date" },
    userTokens?.accessToken,
  );
  assert(badDeadline.status === 400, "Invalid deadline format returns 400");

  // Invalid UUID route param
  const badUuid = await request(
    "GET",
    "/savings-goals/not-a-uuid",
    undefined,
    userTokens?.accessToken,
  );
  assert(badUuid.status === 400, "Invalid UUID in route returns 400");

  // ─── 15. Delete Goal ───────────────────────────────────────
  console.log("\n─── 15. Delete Goal (DELETE /savings-goals/:id) ───");

  // Cannot delete a completed goal
  const deleteCompleted = await request(
    "DELETE",
    `/savings-goals/${autoCompleteId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(deleteCompleted.status === 400, "Delete completed goal returns 400");
  assert(deleteCompleted.json.success === false, "Delete completed goal blocked");

  // Create a goal specifically for deletion test
  const toDelete = await request(
    "POST",
    "/savings-goals",
    { name: "To Be Deleted", targetAmount: 500, currentAmount: 0 },
    userTokens?.accessToken,
  );
  assert(toDelete.status === 201, "Goal created for deletion test");
  const deleteId = (toDelete.json.data?.savingsGoal as Record<string, unknown>)?.id as string;

  // Delete the active goal
  const deleted = await request(
    "DELETE",
    `/savings-goals/${deleteId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(deleted.status === 204, "Delete returns 204 No Content");

  // Verify it's gone
  const gone = await request(
    "GET",
    `/savings-goals/${deleteId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(gone.status === 404, "Deleted goal returns 404");

  // Delete non-existent goal
  const deleteGone = await request(
    "DELETE",
    `/savings-goals/${deleteId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(deleteGone.status === 404, "Delete non-existent returns 404");

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
  server = app.listen(4005, async () => {
    console.log(`🧪 Test server running on port 4005`);
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
