/**
 * Notification Center Module — API Integration Tests
 *
 * Tests: list notifications (pagination + read/unread filter + type filter),
 *        get single notification, mark as read, mark all as read, unread count,
 *        delete notification, validation, ownership, unauthenticated access.
 *
 * Run: npx tsx src/modules/notifications/notification-center.test.ts
 *
 * Prerequisites: PostgreSQL running, migrations applied
 */

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, "../../../../.env") });

process.env.PORT = "4023";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-for-notification-center-integration-tests";
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

const BASE = "http://localhost:4023/api/v1";
const TEST_EMAIL = `nc-test-${Date.now()}@example.com`;
const TEST_PASSWORD = "Test@123456";
const SECOND_USER_EMAIL = `nc-test-2-${Date.now()}@example.com`;

interface ApiResult {
  success: boolean;
  data?: Record<string, unknown>;
  message?: string;
  error?: string;
  statusCode?: number;
  meta?: Record<string, unknown>;
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
  console.log("\n🧪 Notification Center Module — API Integration Tests\n");
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
    name: "Notification Center Tester",
  });
  assert(register.status === 201, "Register returns 201");
  userTokens = register.json.data?.tokens as { accessToken: string; refreshToken: string };
  assert(userTokens != null, "Register returns tokens");

  // ─── 2. Seed Notifications via Monthly Summary Generate ────
  console.log("\n─── 2. Seed Notifications ───");

  // Enable monthlySummary preference so generate creates notifications
  const enablePrefs = await request(
    "PUT",
    "/notifications/preferences",
    { monthlySummary: true },
    userTokens?.accessToken,
  );
  assert(enablePrefs.status === 200, "Enable monthlySummary preference");

  // Generate 3 monthly summaries for distinct months (24h dedup would block
  // same-day repeats, so use months far apart... dedup is window-based, so we
  // seed via a direct DB path instead: create notifications via reminders trigger).
  // Create a recurring expense reminder (amount required) and trigger it.
  const category = await request(
    "POST",
    "/categories",
    { name: "Notification Center Rent", icon: "Home", color: "#6366F1" },
    userTokens?.accessToken,
  );
  assert(category.status === 201, "Category created");
  const categoryId = (category.json.data?.category as Record<string, unknown>)?.id as string;

  // Three daily reminders that are due immediately (started yesterday)
  const reminderTitles = ["Rent Reminder", "Utilities Reminder", "Insurance Reminder"];
  for (const title of reminderTitles) {
    await request(
      "POST",
      "/reminders",
      {
        type: "RECURRING_EXPENSE",
        title,
        amount: 1200,
        frequency: "DAILY",
        startDate: pastDateStr(1),
        categoryId,
      },
      userTokens?.accessToken,
    );
  }

  // Trigger once to create 3 REMINDER notifications
  const trigger1 = await request("POST", "/reminders/trigger", undefined, userTokens?.accessToken);
  assert(trigger1.status === 200, "Trigger returns 200");

  // Generate one monthly summary notification (June 2026)
  const generate = await request(
    "POST",
    "/notifications/monthly-summary/generate?month=2026-06",
    undefined,
    userTokens?.accessToken,
  );
  assert(generate.status === 200, "Generate monthly summary returns 200");

  // ─── 3. List All Notifications (pagination) ────────────────
  console.log("\n─── 3. List All (GET /notifications) ───");
  const list = await request("GET", "/notifications", undefined, userTokens?.accessToken);
  assert(list.status === 200, "List returns 200");
  assert(list.json.success === true, "List success=true");
  const notifications = list.json.data?.notifications as Array<Record<string, unknown>> | undefined;
  assert(notifications != null, "Notifications array exists");
  assert(notifications!.length >= 3, "At least 3 notifications exist");
  const meta = list.json.meta;
  assert(meta != null, "Pagination meta present");
  assert((meta!.total as number) >= 3, "Meta total >= 3");
  assert(meta!.page === 1, "Meta page is 1");
  assert(meta!.limit === 20, "Meta limit is 20");

  // ─── 4. Filter by read=false ───────────────────────────────
  console.log("\n─── 4. Filter read=false ───");
  const unreadFilter = await request(
    "GET",
    "/notifications?read=false",
    undefined,
    userTokens?.accessToken,
  );
  assert(unreadFilter.status === 200, "Filter read=false returns 200");
  const unreadList = unreadFilter.json.data?.notifications as
    Array<Record<string, unknown>> | undefined;
  assert(unreadList!.length >= 3, "All seeded notifications are unread");
  for (const n of unreadList!) {
    assert(n.read === false, "Filtered list only contains unread");
  }

  // ─── 5. Filter by read=true (empty initially) ──────────────
  console.log("\n─── 5. Filter read=true ───");
  const readFilter = await request(
    "GET",
    "/notifications?read=true",
    undefined,
    userTokens?.accessToken,
  );
  assert(readFilter.status === 200, "Filter read=true returns 200");
  const readList = readFilter.json.data?.notifications as
    Array<Record<string, unknown>> | undefined;
  assert(readList!.length === 0, "No read notifications yet");
  const readMeta = readFilter.json.meta;
  assert((readMeta!.total as number) === 0, "Read total is 0");

  // ─── 6. Filter by type ─────────────────────────────────────
  console.log("\n─── 6. Filter by type=REMINDER ───");
  const typeFilter = await request(
    "GET",
    "/notifications?type=REMINDER",
    undefined,
    userTokens?.accessToken,
  );
  assert(typeFilter.status === 200, "Filter by type returns 200");
  const typeList = typeFilter.json.data?.notifications as
    Array<Record<string, unknown>> | undefined;
  assert(typeList!.length === 3, "Three REMINDER notifications");
  for (const n of typeList!) {
    assert(n.type === "REMINDER", "Filtered list only contains REMINDER type");
  }

  // ─── 7. Pagination ─────────────────────────────────────────
  console.log("\n─── 7. Pagination (limit=2) ───");
  const paged = await request(
    "GET",
    "/notifications?page=1&limit=2",
    undefined,
    userTokens?.accessToken,
  );
  assert(paged.status === 200, "Paginated request returns 200");
  const page1 = paged.json.data?.notifications as Array<Record<string, unknown>> | undefined;
  assert(page1!.length === 2, "Page 1 has 2 items");
  const page1Meta = paged.json.meta;
  assert((page1Meta!.totalPages as number) >= 2, "Has multiple pages");
  assert(page1Meta!.hasNextPage === true, "Has next page");

  const page2 = await request(
    "GET",
    "/notifications?page=2&limit=2",
    undefined,
    userTokens?.accessToken,
  );
  const page2List = page2.json.data?.notifications as Array<Record<string, unknown>> | undefined;
  assert(page2List!.length >= 1, "Page 2 has remaining items");

  // ─── 8. Get Single Notification ────────────────────────────
  console.log("\n─── 8. Get Notification (GET /notifications/:id) ───");
  const firstId = notifications![0].id as string;
  const byId = await request(
    "GET",
    `/notifications/${firstId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(byId.status === 200, "Get by ID returns 200");
  const fetched = byId.json.data?.notification as Record<string, unknown> | undefined;
  assert(fetched != null, "Notification returned");
  assert(fetched!.id === firstId, "Notification ID matches");
  assert(fetched!.read === false, "Notification is unread");

  // Invalid UUID returns 400
  const badId = await request(
    "GET",
    "/notifications/not-a-uuid",
    undefined,
    userTokens?.accessToken,
  );
  assert(badId.status === 400, "Invalid UUID returns 400");

  // ─── 9. Mark as Read ───────────────────────────────────────
  console.log("\n─── 9. Mark as Read (PATCH /notifications/:id/read) ───");
  const markRead = await request(
    "PATCH",
    `/notifications/${firstId}/read`,
    undefined,
    userTokens?.accessToken,
  );
  assert(markRead.status === 204, "Mark as read returns 204");

  const afterRead = await request(
    "GET",
    `/notifications/${firstId}`,
    undefined,
    userTokens?.accessToken,
  );
  const afterReadData = afterRead.json.data?.notification as Record<string, unknown> | undefined;
  assert(afterReadData!.read === true, "Notification now read");

  // Unread count decreases
  const unreadCount = await request(
    "GET",
    "/notifications/unread/count",
    undefined,
    userTokens?.accessToken,
  );
  const count = unreadCount.json.data?.count as number | undefined;
  assert(count === notifications!.length - 1, "Unread count decreased by 1");

  // read=true filter now returns it
  const readFilter2 = await request(
    "GET",
    "/notifications?read=true",
    undefined,
    userTokens?.accessToken,
  );
  const readList2 = readFilter2.json.data?.notifications as
    Array<Record<string, unknown>> | undefined;
  assert(readList2!.length === 1, "Read filter returns the marked notification");
  assert(readList2![0].id === firstId, "Marked notification appears in read filter");

  // Mark a non-existent notification returns 404
  const markGone = await request(
    "PATCH",
    "/notifications/00000000-0000-0000-0000-000000000000/read",
    undefined,
    userTokens?.accessToken,
  );
  assert(markGone.status === 404, "Mark non-existent returns 404");

  // ─── 10. Mark All as Read ──────────────────────────────────
  console.log("\n─── 10. Mark All as Read (PATCH /notifications/read-all) ───");
  const markAll = await request(
    "PATCH",
    "/notifications/read-all",
    undefined,
    userTokens?.accessToken,
  );
  assert(markAll.status === 204, "Mark all as read returns 204");

  const unreadAfter = await request(
    "GET",
    "/notifications/unread/count",
    undefined,
    userTokens?.accessToken,
  );
  assert(unreadAfter.json.data?.count === 0, "Unread count is 0 after mark-all");

  // ─── 11. Unread Endpoint ───────────────────────────────────
  console.log("\n─── 11. Unread List (GET /notifications/unread) ───");
  const unreadList2 = await request(
    "GET",
    "/notifications/unread",
    undefined,
    userTokens?.accessToken,
  );
  assert(unreadList2.status === 200, "Unread list returns 200");
  const unreadNotifs = unreadList2.json.data?.notifications as
    Array<Record<string, unknown>> | undefined;
  assert(unreadNotifs!.length === 0, "Unread list is empty after mark-all");

  // ─── 12. Delete Notification ───────────────────────────────
  console.log("\n─── 12. Delete (DELETE /notifications/:id) ───");
  const deleted = await request(
    "DELETE",
    `/notifications/${firstId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(deleted.status === 204, "Delete returns 204");

  const gone = await request(
    "GET",
    `/notifications/${firstId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(gone.status === 404, "Deleted notification returns 404");

  const deleteGone = await request(
    "DELETE",
    `/notifications/${firstId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(deleteGone.status === 404, "Delete non-existent returns 404");

  // ─── 13. Validation ────────────────────────────────────────
  console.log("\n─── 13. Validation ───");
  const badRead = await request(
    "GET",
    "/notifications?read=maybe",
    undefined,
    userTokens?.accessToken,
  );
  assert(badRead.status === 400, "Invalid read filter returns 400");

  const badType = await request(
    "GET",
    "/notifications?type=NOT_A_TYPE",
    undefined,
    userTokens?.accessToken,
  );
  assert(badType.status === 400, "Invalid type filter returns 400");

  const badPage = await request("GET", "/notifications?page=0", undefined, userTokens?.accessToken);
  assert(badPage.status === 400, "Page 0 returns 400");

  // ─── 14. Ownership Validation ──────────────────────────────
  console.log("\n─── 14. Ownership Validation ───");
  const register2 = await request("POST", "/auth/register", {
    email: SECOND_USER_EMAIL,
    password: TEST_PASSWORD,
    name: "Second User",
  });
  assert(register2.status === 201, "Second user registered");
  secondUserTokens = register2.json.data?.tokens as { accessToken: string; refreshToken: string };

  const secondList = await request(
    "GET",
    "/notifications",
    undefined,
    secondUserTokens?.accessToken,
  );
  const secondNotifs = secondList.json.data?.notifications as
    Array<Record<string, unknown>> | undefined;
  assert(secondNotifs!.length === 0, "Second user sees no notifications");

  // Second user cannot fetch primary's notification by ID
  const secondNotifId = notifications![1].id as string;
  const forbiddenGet = await request(
    "GET",
    `/notifications/${secondNotifId}`,
    undefined,
    secondUserTokens?.accessToken,
  );
  assert(forbiddenGet.status === 404, "Second user gets 404 on primary's notification");

  // Second user cannot mark primary's notification as read
  const forbiddenMark = await request(
    "PATCH",
    `/notifications/${secondNotifId}/read`,
    undefined,
    secondUserTokens?.accessToken,
  );
  assert(forbiddenMark.status === 404, "Second user gets 404 on mark-read");

  // Second user cannot delete primary's notification
  const forbiddenDelete = await request(
    "DELETE",
    `/notifications/${secondNotifId}`,
    undefined,
    secondUserTokens?.accessToken,
  );
  assert(forbiddenDelete.status === 404, "Second user gets 404 on delete");

  // ─── 15. Unauthenticated Access ────────────────────────────
  console.log("\n─── 15. Unauthenticated Access ───");
  const noAuthList = await request("GET", "/notifications");
  assert(noAuthList.status === 401, "List without token returns 401");

  const noAuthById = await request("GET", `/notifications/${firstId}`);
  assert(noAuthById.status === 401, "Get by ID without token returns 401");

  const noAuthMark = await request("PATCH", `/notifications/${firstId}/read`);
  assert(noAuthMark.status === 401, "Mark read without token returns 401");

  const noAuthDelete = await request("DELETE", `/notifications/${firstId}`);
  assert(noAuthDelete.status === 401, "Delete without token returns 401");

  // ─── Summary ──────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${"=".repeat(55)}`);
  console.log(`📊 Results: ${passed}/${total} passed, ${failed}/${total} failed`);
  console.log(`${"=".repeat(55)}`);

  if (failed > 0) {
    process.exit(1);
  }
}

function pastDateStr(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

// ─── Start Server & Run Tests ────────────────────────────────

async function main() {
  app = createApp();
  server = app.listen(4023, async () => {
    console.log(`🧪 Test server running on port 4023`);
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
