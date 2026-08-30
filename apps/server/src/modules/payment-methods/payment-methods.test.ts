/**
 * Payment Methods Module — Full API Integration Tests
 *
 * Tests: create payment method, list methods, get by ID (with stats),
 *        update (icon/color/name), delete (with/without transactions),
 *        default payment methods on registration, transaction integration,
 *        statistics, ownership validation, validation errors.
 *
 * Run: npx tsx src/modules/payment-methods/payment-methods.test.ts
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
process.env.JWT_SECRET = "test-secret-for-payment-methods-integration-tests";
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
const TEST_EMAIL = `pm-test-${Date.now()}@example.com`;
const TEST_PASSWORD = "Test@123456";
const SECOND_USER_EMAIL = `pm-test-2-${Date.now()}@example.com`;

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
  console.log("\n🧪 Payment Methods Module — API Integration Tests\n");
  console.log(`Test user: ${TEST_EMAIL}\n`);

  // ─── 0. Health Check ───────────────────────────────────────
  console.log("─── 0. Health Check ───");
  const health = await request("GET", "/health");
  assert(health.status === 200, "Health endpoint returns 200");
  assert(health.json.success === true, "Health response success=true");

  // ─── 1. Register Primary User & Verify Default Payment Methods ─
  console.log("\n─── 1. Register User + Default Payment Methods ───");
  const register = await request("POST", "/auth/register", {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    name: "PM Tester",
  });
  assert(register.status === 201, "Register returns 201");
  assert(register.json.data?.user != null, "Register returns user");
  assert(register.json.data?.tokens != null, "Register returns tokens");

  userTokens = register.json.data?.tokens as { accessToken: string; refreshToken: string };

  // Verify default payment methods were auto-created
  const defaults = await request("GET", "/payment-methods", undefined, userTokens?.accessToken);
  assert(defaults.status === 200, "List payment methods returns 200");
  assert(defaults.json.success === true, "List payment methods success=true");

  const defaultPms = defaults.json.data?.paymentMethods as
    Array<Record<string, unknown>> | undefined;
  assert(defaultPms != null, "Payment methods array exists");
  assert(
    defaultPms!.length >= 5,
    `At least 5 default payment methods created (got ${defaultPms!.length})`,
  );

  // Verify specific default payment methods
  const cashPm = defaultPms!.find((pm) => pm.name === "Cash");
  assert(cashPm != null, 'Default "Cash" payment method exists');
  assert(cashPm!.type === "CASH", "Cash method has type CASH");
  assert(cashPm!.icon === "Wallet", "Cash method has Wallet icon");
  assert(cashPm!.color === "#10B981", "Cash method has color #10B981");

  const creditCardPm = defaultPms!.find((pm) => pm.name === "Credit Card");
  assert(creditCardPm != null, 'Default "Credit Card" payment method exists');
  assert(creditCardPm!.type === "CREDIT_CARD", "Credit Card method has type CREDIT_CARD");
  assert(creditCardPm!.icon === "CreditCard", "Credit Card method has CreditCard icon");
  assert(creditCardPm!.color === "#3B82F6", "Credit Card method has color #3B82F6");

  const bankPm = defaultPms!.find((pm) => pm.name === "Bank Account");
  assert(bankPm != null, 'Default "Bank Account" payment method exists');
  assert(bankPm!.type === "BANK_TRANSFER", "Bank Account method has type BANK_TRANSFER");
  assert(bankPm!.icon === "Building2", "Bank Account method has Building2 icon");
  assert(bankPm!.color === "#F59E0B", "Bank Account method has color #F59E0B");

  const walletPm = defaultPms!.find((pm) => pm.name === "Digital Wallet");
  assert(walletPm != null, 'Default "Digital Wallet" payment method exists');

  // ─── 2. Create Custom Payment Method ────────────────────────
  console.log("\n─── 2. Create Custom Payment Method (POST /payment-methods) ───");
  const created = await request(
    "POST",
    "/payment-methods",
    {
      type: "CREDIT_CARD",
      name: "Chase Sapphire",
      lastFour: "1234",
      isDefault: true,
      icon: "CreditCard",
      color: "#3B82F6",
    },
    userTokens?.accessToken,
  );
  assert(created.status === 201, "Create returns 201");
  assert(created.json.success === true, "Create success=true");
  const createdPm = created.json.data?.paymentMethod as Record<string, unknown> | undefined;
  assert(createdPm != null, "Created payment method returned");
  assert(createdPm!.name === "Chase Sapphire", "Payment method name matches");
  assert(createdPm!.type === "CREDIT_CARD", "Payment method type matches");
  assert(createdPm!.icon === "CreditCard", "Payment method icon matches");
  assert(createdPm!.color === "#3B82F6", "Payment method color matches");
  assert(createdPm!.lastFour === "1234", "Payment method lastFour matches");
  assert(createdPm!.isDefault === true, "Payment method is default");
  const createdId = createdPm!.id as string;
  assert(createdId != null, "Payment method has an ID");

  // ─── 3. Get Payment Methods List ────────────────────────────
  console.log("\n─── 3. Get Payment Methods List (GET /payment-methods) ───");
  const list = await request("GET", "/payment-methods", undefined, userTokens?.accessToken);
  assert(list.status === 200, "List returns 200");
  assert(list.json.success === true, "List success=true");
  const allPms = list.json.data?.paymentMethods as Array<Record<string, unknown>> | undefined;
  assert(allPms != null, "Payment methods array exists");
  assert(
    allPms!.length >= 6,
    `At least 6 payment methods (defaults + custom) (got ${allPms!.length})`,
  );

  // Verify default payment method (isDefault should be ours now)
  const defaultPm = allPms!.find((pm) => pm.isDefault === true);
  assert(defaultPm != null, "A default payment method exists");
  assert(defaultPm!.name === "Chase Sapphire", "Our created method is now the default");

  // ─── 4. Get Payment Method Details (With Statistics) ─────────
  console.log("\n─── 4. Get Payment Method Details (GET /payment-methods/:id) ───");
  const byId = await request(
    "GET",
    `/payment-methods/${createdId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(byId.status === 200, "Get by ID returns 200");
  assert(byId.json.success === true, "Get by ID success=true");
  const fetchedPm = byId.json.data?.paymentMethod as Record<string, unknown> | undefined;
  assert(fetchedPm != null, "Payment method returned");
  assert(fetchedPm!.id === createdId, "Payment method ID matches");
  assert(fetchedPm!.name === "Chase Sapphire", "Payment method name matches");

  // Verify stats (empty — no transactions yet)
  const stats = fetchedPm!.stats as Record<string, unknown> | undefined;
  assert(stats != null, "Payment method has stats object");
  assert(stats!.totalTransactions === 0, "Stats totalTransactions is 0");
  assert(stats!.totalIncome === 0, "Stats totalIncome is 0");
  assert(stats!.totalExpense === 0, "Stats totalExpense is 0");
  assert(stats!.netAmount === 0, "Stats netAmount is 0");
  assert(stats!.firstUsed == null, "Stats firstUsed is null");
  assert(stats!.lastUsed == null, "Stats lastUsed is null");

  // ─── 5. Update Payment Method ───────────────────────────────
  console.log("\n─── 5. Update Payment Method (PATCH /payment-methods/:id) ───");

  // Update name, icon, color
  const updated = await request(
    "PATCH",
    `/payment-methods/${createdId}`,
    { name: "Chase Sapphire Preferred", icon: "Shield", color: "#6366F1", isDefault: false },
    userTokens?.accessToken,
  );
  assert(updated.status === 200, "Update returns 200");
  assert(updated.json.success === true, "Update success=true");
  const updatedPm = updated.json.data?.paymentMethod as Record<string, unknown> | undefined;
  assert(updatedPm != null, "Updated payment method returned");
  assert(updatedPm!.name === "Chase Sapphire Preferred", "Name updated");
  assert(updatedPm!.icon === "Shield", "Icon updated");
  assert(updatedPm!.color === "#6366F1", "Color updated");
  assert(updatedPm!.isDefault === false, "isDefault updated to false");

  // Partial update — only name
  const partialUpdate = await request(
    "PATCH",
    `/payment-methods/${createdId}`,
    { name: "Chase Sapphire Reserve" },
    userTokens?.accessToken,
  );
  assert(partialUpdate.status === 200, "Partial update returns 200");
  const partialPm = partialUpdate.json.data?.paymentMethod as Record<string, unknown> | undefined;
  assert(partialPm!.name === "Chase Sapphire Reserve", "Partial name update");
  assert(partialPm!.icon === "Shield", "Icon unchanged after partial update");
  assert(partialPm!.color === "#6366F1", "Color unchanged after partial update");

  // ─── 6. Delete Payment Method (Without Transactions) ────────
  console.log("\n─── 6. Delete Payment Method (DELETE /payment-methods/:id) ───");

  // Create a method to delete
  const toDelete = await request(
    "POST",
    "/payment-methods",
    { type: "DEBIT_CARD", name: "Temp Card", icon: "CreditCard", color: "#8B5CF6" },
    userTokens?.accessToken,
  );
  const deleteId = (toDelete.json.data?.paymentMethod as Record<string, unknown>)?.id as string;
  assert(toDelete.status === 201, "Payment method created for deletion test");

  const deleted = await request(
    "DELETE",
    `/payment-methods/${deleteId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(deleted.status === 204, "Delete returns 204 No Content");

  // Verify it's gone
  const gone = await request(
    "GET",
    `/payment-methods/${deleteId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(gone.status === 404, "Deleted payment method returns 404");

  // ─── 7. Delete Payment Method (With Transactions — Should Fail) ──
  console.log("\n─── 7. Cannot Delete Payment Method Linked to Transactions ───");

  // Get a category for creating a transaction
  const catsRes = await request("GET", "/categories", undefined, userTokens?.accessToken);
  const cats = catsRes.json.data?.categories as Array<Record<string, unknown>> | undefined;
  const foodCat = cats!.find((c) => c.name === "Food");
  assert(foodCat != null, "Food category exists for transaction creation");

  // Get a payment method to use in the transaction (use one of the defaults)
  const pmsRes = await request("GET", "/payment-methods", undefined, userTokens?.accessToken);
  const allPms2 = pmsRes.json.data?.paymentMethods as Array<Record<string, unknown>> | undefined;
  const targetPm = allPms2!.find((pm) => pm.name === "Credit Card") as Record<string, unknown>;
  const targetPmId = targetPm!.id as string;
  assert(targetPm != null, "Credit Card payment method exists");

  // Create a transaction linked to this payment method
  const txn = await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: 42.5,
      description: "Test transaction for payment method delete guard",
      date: "2026-07-01",
      categoryId: foodCat!.id,
      paymentMethodId: targetPmId,
    },
    userTokens?.accessToken,
  );
  assert(txn.status === 201, "Transaction created with payment method");

  // Try to delete the payment method — should fail
  const deleteWithTxn = await request(
    "DELETE",
    `/payment-methods/${targetPmId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(
    deleteWithTxn.status === 400,
    "Cannot delete payment method with linked transactions (400)",
  );
  const deleteErr = deleteWithTxn.json;
  assert(deleteErr.success === false, "Delete with transactions fails");
  const errMsg = String(deleteErr.message ?? "");
  assert(
    errMsg.includes("transaction") || errMsg.includes("reassign"),
    "Error message mentions transactions/reassignment",
  );

  // ─── 8. Transaction Integration (Statistics Update) ─────────
  console.log("\n─── 8. Payment Method Statistics via Transaction Integration ───");

  // Get the stats for the payment method that now has a transaction
  const statsById = await request(
    "GET",
    `/payment-methods/${targetPmId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(statsById.status === 200, "Get payment method with stats returns 200");

  const pmWithStats = statsById.json.data?.paymentMethod as Record<string, unknown> | undefined;
  const pmStats = pmWithStats!.stats as Record<string, unknown>;
  assert(pmStats != null, "Payment method has stats");

  // Create an income transaction too
  const incomeTxn = await request(
    "POST",
    "/transactions",
    {
      type: "INCOME",
      amount: 1000,
      description: "Income test for payment method stats",
      date: "2026-07-01",
      categoryId: foodCat!.id,
      paymentMethodId: targetPmId,
    },
    userTokens?.accessToken,
  );
  assert(incomeTxn.status === 201, "Income transaction created with payment method");

  // Fetch stats again to verify aggregation
  const statsAfterIncome = await request(
    "GET",
    `/payment-methods/${targetPmId}`,
    undefined,
    userTokens?.accessToken,
  );
  const pmStatsAfter = statsAfterIncome.json.data?.paymentMethod as Record<string, unknown>;
  const stats2 = pmStatsAfter.stats as Record<string, unknown>;

  assert(
    stats2.totalTransactions === 2,
    `Stats shows 2 transactions (got ${stats2.totalTransactions})`,
  );
  assert(stats2.totalIncome === 1000, `Stats shows total income $1000 (got ${stats2.totalIncome})`);
  assert(
    stats2.totalExpense === 42.5,
    `Stats shows total expense $42.5 (got ${stats2.totalExpense})`,
  );
  assert(stats2.netAmount === 957.5, `Stats shows net amount $957.5 (got ${stats2.netAmount})`);
  assert(stats2.firstUsed != null, "Stats has firstUsed date");
  assert(stats2.lastUsed != null, "Stats has lastUsed date");

  // ─── 9. Ownership Validation ────────────────────────────────
  console.log("\n─── 9. Ownership Scoping ───");

  // Register a second user
  const register2 = await request("POST", "/auth/register", {
    email: SECOND_USER_EMAIL,
    password: TEST_PASSWORD,
    name: "Second User",
  });
  assert(register2.status === 201, "Second user registered");
  secondUserTokens = register2.json.data?.tokens as { accessToken: string; refreshToken: string };

  // Second user's list should NOT include primary user's custom payment methods
  const secondUserPms = await request(
    "GET",
    "/payment-methods",
    undefined,
    secondUserTokens?.accessToken,
  );
  assert(secondUserPms.status === 200, "Second user list returns 200");
  const secondPms = secondUserPms.json.data?.paymentMethods as
    Array<Record<string, unknown>> | undefined;
  const hasChase = secondPms!.some((pm) => pm.name === "Chase Sapphire Reserve");
  assert(!hasChase, "Second user cannot see primary user's custom payment methods");

  // Second user CAN see their own default payment methods
  const secondCash = secondPms!.find((pm) => pm.name === "Cash");
  assert(secondCash != null, "Second user has their own 'Cash' default payment method");

  // Second user cannot get primary user's payment method by ID
  const forbiddenGet = await request(
    "GET",
    `/payment-methods/${createdId}`,
    undefined,
    secondUserTokens?.accessToken,
  );
  assert(forbiddenGet.status === 404, "Second user cannot get primary's payment method (404)");

  // Second user cannot update primary user's payment method
  const forbiddenUpdate = await request(
    "PATCH",
    `/payment-methods/${createdId}`,
    { name: "Hacked" },
    secondUserTokens?.accessToken,
  );
  assert(
    forbiddenUpdate.status === 404,
    "Second user cannot update primary's payment method (404)",
  );

  // Second user cannot delete primary user's payment method
  const forbiddenDelete = await request(
    "DELETE",
    `/payment-methods/${createdId}`,
    undefined,
    secondUserTokens?.accessToken,
  );
  assert(
    forbiddenDelete.status === 404,
    "Second user cannot delete primary's payment method (404)",
  );

  // ─── 10. Validation Errors ──────────────────────────────────
  console.log("\n─── 10. Validation Errors ───");

  // Invalid icon should be rejected
  const invalidIcon = await request(
    "POST",
    "/payment-methods",
    { type: "CASH", name: "Bad Icon PM", icon: "NonExistentIcon", color: "#10B981" },
    userTokens?.accessToken,
  );
  assert(invalidIcon.status === 400, "Invalid icon returns 400");
  assert(invalidIcon.json.success === false, "Invalid icon response success=false");
  assert(invalidIcon.json.error != null, "Invalid icon returns error");

  // Invalid color format (not a hex color)
  const badColor = await request(
    "POST",
    "/payment-methods",
    { type: "CASH", name: "Bad Color PM", icon: "Wallet", color: "not-a-color" },
    userTokens?.accessToken,
  );
  assert(badColor.status === 400, "Invalid color format returns 400");
  assert(badColor.json.success === false, "Invalid color response success=false");

  // Valid hex but NOT in palette
  const nonPaletteColor = await request(
    "POST",
    "/payment-methods",
    { type: "CASH", name: "Non-Palette PM", icon: "Wallet", color: "#000000" },
    userTokens?.accessToken,
  );
  assert(nonPaletteColor.status === 400, "Non-palette color returns 400");
  assert(nonPaletteColor.json.success === false, "Non-palette color rejected");

  // Missing required fields
  const missingName = await request(
    "POST",
    "/payment-methods",
    { type: "CASH" },
    userTokens?.accessToken,
  );
  assert(missingName.status === 400, "Missing name returns 400");

  // Invalid UUID for get
  const invalidUuid = await request(
    "GET",
    "/payment-methods/not-a-uuid",
    undefined,
    userTokens?.accessToken,
  );
  assert(invalidUuid.status === 400, "Invalid UUID returns 400");

  // Non-existent UUID for get
  const nonExistent = await request(
    "GET",
    "/payment-methods/00000000-0000-0000-0000-000000000000",
    undefined,
    userTokens?.accessToken,
  );
  assert(nonExistent.status === 404, "Non-existent UUID returns 404");

  // ─── 11. Duplicate Name Prevention ──────────────────────────
  console.log("\n─── 11. Duplicate Name Prevention ───");
  const duplicate = await request(
    "POST",
    "/payment-methods",
    { type: "CASH", name: "Cash", icon: "Wallet", color: "#10B981" },
    userTokens?.accessToken,
  );
  assert(duplicate.status === 409, "Duplicate payment method name returns 409");
  assert(duplicate.json.success === false, "Duplicate name fails");

  // Update duplicate name prevention
  const updateDuplicate = await request(
    "PATCH",
    `/payment-methods/${createdId}`,
    { name: "Cash" },
    userTokens?.accessToken,
  );
  assert(updateDuplicate.status === 409, "Updating to duplicate name returns 409");

  // ─── 12. Unauthenticated Access ─────────────────────────────
  console.log("\n─── 12. Unauthenticated Access ───");
  const unauthList = await request("GET", "/payment-methods", undefined, null);
  assert(unauthList.status === 401, "List without auth returns 401");

  const unauthCreate = await request(
    "POST",
    "/payment-methods",
    { type: "CASH", name: "Unauth", icon: "Wallet", color: "#10B981" },
    null,
  );
  assert(unauthCreate.status === 401, "Create without auth returns 401");

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
