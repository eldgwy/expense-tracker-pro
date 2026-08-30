/**
 * Notifications Module — API Integration Tests
 *
 * Tests: Notification preferences CRUD.
 *
 * Run: npx tsx src/modules/notifications/notifications.test.ts
 *
 * Prerequisites: PostgreSQL running, migrations applied
 */

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, "../../../../.env") });

process.env.PORT = "4021";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-for-notification-integration-tests";
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

const BASE = "http://localhost:4021/api/v1";
const TEST_EMAIL = `notif-test-${Date.now()}@example.com`;
const TEST_PASSWORD = "Test@123456";

async function request(
  method: string,
  path: string,
  reqBody?: unknown,
  token?: string | null,
): Promise<{ status: number; data: any; text: string }> {
  const headers: Record<string, string> = {};
  if (reqBody !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: reqBody ? JSON.stringify(reqBody) : undefined,
  });

  const status = response.status;
  const text = await response.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    // Non-JSON response
  }

  return { status, data, text };
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
  console.log("\n🧪 Notifications Module — API Integration Tests\n");
  console.log(`Test user: ${TEST_EMAIL}\n`);

  // ─── 0. Health Check ───────────────────────────────────────
  console.log("─── 0. Health Check ───");
  const health = await request("GET", "/health");
  assert(health.status === 200, "Health endpoint returns 200");

  // ─── 1. Register User ──────────────────────────────────────
  console.log("\n─── 1. Register User ───");
  const register = await request("POST", "/auth/register", {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    name: "Notification Tester",
  });
  assert(register.status === 201, "Register returns 201");
  userTokens = register.data?.data?.tokens as { accessToken: string; refreshToken: string };
  assert(userTokens != null, "Register returns tokens");

  // ─── 2. Get Default Notification Preferences ───────────────
  console.log("\n─── 2. Get Default Preferences ───");
  const getPrefs = await request(
    "GET",
    "/notifications/preferences",
    undefined,
    userTokens?.accessToken,
  );
  assert(getPrefs.status === 200, "GET preferences returns 200");
  assert(getPrefs.data?.success === true, "Response has success: true");

  const prefs = getPrefs.data?.data?.preferences;
  assert(prefs != null, "Response includes preferences object");
  assert(prefs.enabled === true, "Default notifications enabled");
  assert(prefs.budgetAlerts === true, "Default budgetAlerts enabled");
  assert(prefs.budgetCriticalAlerts === true, "Default budgetCriticalAlerts enabled");
  assert(prefs.emailWarnings === true, "Default emailWarnings enabled");
  assert(prefs.weeklyDigest === false, "Default weeklyDigest disabled");
  assert(prefs.monthlySummary === false, "Default monthlySummary disabled");
  assert(prefs.reminderTime === "09:00", "Default reminderTime is 09:00");
  assert(prefs.channels?.inApp === true, "Default inApp channel enabled");
  assert(prefs.channels?.email === true, "Default email channel enabled");
  assert(prefs.channels?.push === false, "Default push channel disabled");

  // ─── 3. Update Single Preference ───────────────────────────
  console.log("\n─── 3. Update Single Preference ───");
  const updateWeeklyDigest = await request(
    "PUT",
    "/notifications/preferences",
    { weeklyDigest: true },
    userTokens?.accessToken,
  );
  assert(updateWeeklyDigest.status === 200, "PUT preferences returns 200");
  const updated = updateWeeklyDigest.data?.data?.preferences;
  assert(updated?.weeklyDigest === true, "weeklyDigest updated to true");
  assert(updated?.budgetAlerts === true, "budgetAlerts still true (no regression)");
  assert(updated?.enabled === true, "enabled still true (no regression)");

  // ─── 4. Update Multiple Preferences ─────────────────────────
  console.log("\n─── 4. Update Multiple Preferences ───");
  const updateMultiple = await request(
    "PUT",
    "/notifications/preferences",
    {
      enabled: false,
      budgetAlerts: false,
      reminderTime: "14:30",
    },
    userTokens?.accessToken,
  );
  assert(updateMultiple.status === 200, "PUT multiple preferences returns 200");
  const multiUpdated = updateMultiple.data?.data?.preferences;
  assert(multiUpdated?.enabled === false, "enabled updated to false");
  assert(multiUpdated?.budgetAlerts === false, "budgetAlerts updated to false");
  assert(multiUpdated?.reminderTime === "14:30", "reminderTime updated to 14:30");
  assert(multiUpdated?.weeklyDigest === true, "weeklyDigest still true (from previous update)");

  // ─── 5. Verify Persistence ─────────────────────────────────
  console.log("\n─── 5. Verify Persistence ───");
  const verifyPrefs = await request(
    "GET",
    "/notifications/preferences",
    undefined,
    userTokens?.accessToken,
  );
  assert(verifyPrefs.status === 200, "GET preferences still returns 200");
  const verified = verifyPrefs.data?.data?.preferences;
  assert(verified?.enabled === false, "Persisted: enabled is false");
  assert(verified?.reminderTime === "14:30", "Persisted: reminderTime is 14:30");

  // ─── 6. Update Channels (Nested Object) ────────────────────
  console.log("\n─── 6. Update Channels ───");
  const updateChannels = await request(
    "PUT",
    "/notifications/preferences",
    { channels: { push: true, email: false } },
    userTokens?.accessToken,
  );
  assert(updateChannels.status === 200, "PUT channels returns 200");
  const channelsUpdated = updateChannels.data?.data?.preferences;
  assert(channelsUpdated?.channels?.push === true, "push channel updated to true");
  assert(channelsUpdated?.channels?.email === false, "email channel updated to false");
  assert(channelsUpdated?.channels?.inApp === true, "inApp channel still true (no regression)");

  // ─── 7. Validation: Invalid Reminder Time ───────────────────
  console.log("\n─── 7. Validation: Invalid Reminder Time ───");
  const badTime1 = await request(
    "PUT",
    "/notifications/preferences",
    { reminderTime: "25:00" },
    userTokens?.accessToken,
  );
  assert(badTime1.status === 400, "Invalid reminderTime (25:00) returns 400");

  const badTime2 = await request(
    "PUT",
    "/notifications/preferences",
    { reminderTime: "not-a-time" },
    userTokens?.accessToken,
  );
  assert(badTime2.status === 400, "Invalid reminderTime (not-a-time) returns 400");

  // ─── 8. Validation: Invalid Boolean ─────────────────────────
  console.log("\n─── 8. Validation: Invalid Boolean ───");
  const badBool = await request(
    "PUT",
    "/notifications/preferences",
    { enabled: "not-a-boolean" },
    userTokens?.accessToken,
  );
  assert(badBool.status === 400, "Non-boolean value returns 400");

  // ─── 9. Unauthenticated Access ──────────────────────────────
  console.log("\n─── 9. Unauthenticated Access ───");
  const noAuth = await request("GET", "/notifications/preferences");
  assert(noAuth.status === 401, "GET preferences without auth returns 401");

  const noAuthPut = await request("PUT", "/notifications/preferences", { enabled: true });
  assert(noAuthPut.status === 401, "PUT preferences without auth returns 401");

  // ─── 10. Reset to Defaults ─────────────────────────────────
  console.log("\n─── 10. Reset to Defaults ───");
  const reset = await request(
    "PUT",
    "/notifications/preferences",
    {
      enabled: true,
      budgetAlerts: true,
      budgetCriticalAlerts: true,
      emailWarnings: true,
      weeklyDigest: false,
      monthlySummary: false,
      reminderTime: "09:00",
      channels: { inApp: true, email: true, push: false },
    },
    userTokens?.accessToken,
  );
  assert(reset.status === 200, "Reset preferences returns 200");
  const resetPrefs = reset.data?.data?.preferences;
  assert(resetPrefs?.enabled === true, "Reset: enabled restored");
  assert(resetPrefs?.reminderTime === "09:00", "Reset: reminderTime restored");

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
  server = app.listen(4021, async () => {
    console.log(`🧪 Test server running on port 4021`);
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
