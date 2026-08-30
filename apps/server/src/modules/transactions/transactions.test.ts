/**
 * Transactions Module — Full API Integration Tests
 *
 * Tests: create transaction, get transactions (pagination), get by ID,
 *        update transaction, delete transaction, receipt upload/search,
 *        filters, sorting, pagination, bulk operations, statistics.
 *
 * Run: npx tsx src/modules/transactions/transactions.test.ts
 *
 * Prerequisites: PostgreSQL running, migrations applied
 */

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, "../../../../.env") });

process.env.PORT = "4001";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-for-transactions-integration-tests";
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

const BASE = "http://localhost:4001/api/v1";
const TEST_EMAIL = `txn-test-${Date.now()}@example.com`;
const TEST_PASSWORD = "Test@123456";
const SECOND_USER_EMAIL = `txn-test-2-${Date.now()}@example.com`;

interface ApiResult {
  success: boolean;
  data?: Record<string, unknown>;
  message?: string;
  error?: string;
  statusCode?: number;
  details?: Record<string, string[]>;
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
    json = { success: false, message: "No JSON body" };
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

// Helper to create a tiny test PNG for receipt upload
function createTestPng(): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x03, 0x00, 0x01, 0x36, 0x28, 0x19, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
    0xae, 0x42, 0x60, 0x82,
  ]);
}

// ─── Tests ────────────────────────────────────────────────────

async function runTests() {
  console.log("\n🧪 Transactions Module — API Integration Tests\n");
  console.log(`Test user: ${TEST_EMAIL}\n`);

  // ─── 0. Health Check ───────────────────────────────────────
  console.log("─── 0. Health Check ───");
  const health = await request("GET", "/health");
  assert(health.status === 200, "Health endpoint returns 200");
  assert(health.json.success === true, "Health response success=true");

  // ─── 1. Register Primary User & Set Up Test Data ───────────
  console.log("\n─── 1. Register & Set Up Test Data ───");
  const register = await request("POST", "/auth/register", {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    name: "Transaction Tester",
  });
  assert(register.status === 201, "Register returns 201");
  assert(register.json.data?.tokens != null, "Register returns tokens");
  userTokens = register.json.data?.tokens as { accessToken: string; refreshToken: string };

  // Get default categories created on registration
  const defaultCats = await request("GET", "/categories", undefined, userTokens?.accessToken);
  assert(defaultCats.status === 200, "Default categories fetched");

  // Pick an expense category (e.g. Food) and an income category (e.g. Salary)
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

  // Set up created transaction IDs for later tests
  const createdIds: string[] = [];

  // ─── 2. Create Transactions ────────────────────────────────
  console.log("\n─── 2. Create Transaction (POST /transactions) ───");

  // Create an expense transaction
  const expenseTxn = await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: 42.5,
      description: "Whole Foods Market",
      date: "2026-07-01",
      notes: "Weekly grocery shopping",
      categoryId: testCategoryId,
      paymentMethodId: testPaymentMethodId,
    },
    userTokens?.accessToken,
  );
  assert(expenseTxn.status === 201, "Create expense returns 201");
  assert(expenseTxn.json.success === true, "Create expense success=true");
  const expense = expenseTxn.json.data?.transaction as Record<string, unknown> | undefined;
  assert(expense != null, "Created expense transaction returned");
  assert(expense!.type === "EXPENSE", "Transaction type is EXPENSE");
  assert(expense!.amount === 42.5, "Transaction amount matches");
  assert(expense!.description === "Whole Foods Market", "Transaction description matches");
  assert(expense!.notes === "Weekly grocery shopping", "Transaction notes match");
  assert(expense!.categoryId === testCategoryId, "Transaction categoryId matches");
  assert(expense!.paymentMethodId === testPaymentMethodId, "Transaction paymentMethodId matches");
  const expenseId = expense!.id as string;
  assert(expenseId != null, "Expense transaction has ID");
  createdIds.push(expenseId);

  // Create an income transaction
  const incomeTxn = await request(
    "POST",
    "/transactions",
    {
      type: "INCOME",
      amount: 5000.0,
      description: "July Paycheck",
      date: "2026-07-15",
      categoryId: incomeCategoryId!,
    },
    userTokens?.accessToken,
  );
  assert(incomeTxn.status === 201, "Create income returns 201");
  const income = incomeTxn.json.data?.transaction as Record<string, unknown> | undefined;
  assert(income != null, "Created income transaction returned");
  assert(income!.type === "INCOME", "Income type is INCOME");
  assert(income!.amount === 5000, "Income amount matches");
  assert(income!.paymentMethodId == null, "Income payment method is null (not provided)");
  const incomeId = income!.id as string;
  createdIds.push(incomeId);

  // Create a transfer transaction
  const transferTxn = await request(
    "POST",
    "/transactions",
    {
      type: "TRANSFER",
      amount: 200.0,
      description: "Transfer to Savings",
      date: "2026-07-20",
      categoryId: testCategoryId!,
    },
    userTokens?.accessToken,
  );
  assert(transferTxn.status === 201, "Create transfer returns 201");
  const transfer = transferTxn.json.data?.transaction as Record<string, unknown> | undefined;
  assert(transfer != null, "Created transfer transaction returned");
  assert(transfer!.type === "TRANSFER", "Transfer type is TRANSFER");
  const transferId = transfer!.id as string;
  createdIds.push(transferId);

  // Create another expense for filter/sort tests
  await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: 9.99,
      description: "Netflix Subscription",
      date: "2026-06-15",
      categoryId: testCategoryId!,
    },
    userTokens?.accessToken,
  );

  await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: 150.0,
      description: "Electric Bill",
      date: "2026-07-05",
      notes: "Monthly utility payment",
      categoryId: testCategoryId!,
    },
    userTokens?.accessToken,
  );

  // ─── 3. Validation — Missing / Invalid Fields ──────────────
  console.log("\n─── 3. Validation Errors ───");

  // Missing required fields
  const noType = await request(
    "POST",
    "/transactions",
    { amount: 10, description: "Test", date: "2026-07-01", categoryId: testCategoryId },
    userTokens?.accessToken,
  );
  assert(noType.status === 400, "Missing type returns 400");

  const noAmount = await request(
    "POST",
    "/transactions",
    { type: "EXPENSE", description: "Test", date: "2026-07-01", categoryId: testCategoryId },
    userTokens?.accessToken,
  );
  assert(noAmount.status === 400, "Missing amount returns 400");

  const noDescription = await request(
    "POST",
    "/transactions",
    { type: "EXPENSE", amount: 10, date: "2026-07-01", categoryId: testCategoryId },
    userTokens?.accessToken,
  );
  assert(noDescription.status === 400, "Missing description returns 400");

  // Zero / negative amount
  const zeroAmount = await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: 0,
      description: "Zero",
      date: "2026-07-01",
      categoryId: testCategoryId,
    },
    userTokens?.accessToken,
  );
  assert(zeroAmount.status === 400, "Zero amount returns 400");

  const negativeAmount = await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: -10,
      description: "Negative",
      date: "2026-07-01",
      categoryId: testCategoryId,
    },
    userTokens?.accessToken,
  );
  assert(negativeAmount.status === 400, "Negative amount returns 400");

  // Invalid type enum
  const badType = await request(
    "POST",
    "/transactions",
    {
      type: "INVALID",
      amount: 10,
      description: "Bad type",
      date: "2026-07-01",
      categoryId: testCategoryId,
    },
    userTokens?.accessToken,
  );
  assert(badType.status === 400, "Invalid type returns 400");

  // Invalid categoryId (non-existent)
  const badCat = await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: 10,
      description: "Bad cat",
      date: "2026-07-01",
      categoryId: "00000000-0000-0000-0000-000000000000",
    },
    userTokens?.accessToken,
  );
  assert(badCat.status === 400, "Non-existent category returns 400");

  // Invalid payment method (non-existent)
  const badPm = await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: 10,
      description: "Bad PM",
      date: "2026-07-01",
      categoryId: testCategoryId,
      paymentMethodId: "00000000-0000-0000-0000-000000000000",
    },
    userTokens?.accessToken,
  );
  assert(badPm.status === 400, "Non-existent payment method returns 400");

  // ─── 4. Get Transactions (List) ────────────────────────────
  console.log("\n─── 4. Get Transactions (GET /transactions) ───");

  const list = await request("GET", "/transactions", undefined, userTokens?.accessToken);
  assert(list.status === 200, "List returns 200");
  assert(list.json.success === true, "List success=true");
  const txnList = list.json.data?.transactions as Array<Record<string, unknown>> | undefined;
  assert(txnList != null, "Transactions array exists");
  assert(txnList!.length >= 5, `At least 5 transactions returned (got ${txnList!.length})`);
  assert(list.json.meta != null, "Pagination metadata returned");
  assert(Number(list.json.meta!.total) >= 5, "Meta.total >= 5");
  assert(list.json.meta!.page === 1, "Meta.page defaults to 1");
  assert(list.json.meta!.limit === 20, "Meta.limit defaults to 20");

  // ─── 5. Get Transaction By ID ──────────────────────────────
  console.log("\n─── 5. Get Transaction By ID (GET /transactions/:id) ───");

  const byId = await request(
    "GET",
    `/transactions/${expenseId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(byId.status === 200, "Get by ID returns 200");
  assert(byId.json.success === true, "Get by ID success=true");
  const fetched = byId.json.data?.transaction as Record<string, unknown> | undefined;
  assert(fetched != null, "Transaction returned");
  assert(fetched!.id === expenseId, "Transaction ID matches");
  assert(fetched!.description === "Whole Foods Market", "Description matches");
  assert(fetched!.category != null, "Category relation included");
  assert((fetched!.category as Record<string, unknown>)?.name === "Food", "Category name included");
  assert(fetched!.paymentMethod != null, "Payment method relation included");
  assert(
    (fetched!.paymentMethod as Record<string, unknown>)?.name === "Test Visa",
    "Payment method name included",
  );

  // Non-existent ID returns 404
  const notFound = await request(
    "GET",
    "/transactions/00000000-0000-0000-0000-000000000000",
    undefined,
    userTokens?.accessToken,
  );
  assert(notFound.status === 404, "Non-existent ID returns 404");

  // Invalid UUID returns 400
  const badId = await request(
    "GET",
    "/transactions/not-a-uuid",
    undefined,
    userTokens?.accessToken,
  );
  assert(badId.status === 400, "Invalid UUID returns 400");

  // ─── 6. Update Transaction ─────────────────────────────────
  console.log("\n─── 6. Update Transaction (PATCH /transactions/:id) ───");

  // Full update
  const updated = await request(
    "PATCH",
    `/transactions/${expenseId}`,
    {
      amount: 45.0,
      description: "Whole Foods Updated",
      notes: "Updated notes",
      categoryId: testCategoryId,
    },
    userTokens?.accessToken,
  );
  assert(updated.status === 200, "Update returns 200");
  assert(updated.json.success === true, "Update success=true");
  const updatedTxn = updated.json.data?.transaction as Record<string, unknown> | undefined;
  assert(updatedTxn?.amount === 45, "Amount updated");
  assert(updatedTxn?.description === "Whole Foods Updated", "Description updated");
  assert(updatedTxn?.notes === "Updated notes", "Notes updated");

  // Partial update (only notes)
  const partialUpdate = await request(
    "PATCH",
    `/transactions/${expenseId}`,
    { notes: "Partial update test" },
    userTokens?.accessToken,
  );
  assert(partialUpdate.status === 200, "Partial update returns 200");
  const partialTxn = partialUpdate.json.data?.transaction as Record<string, unknown> | undefined;
  assert(partialTxn?.notes === "Partial update test", "Notes partially updated");
  assert(partialTxn?.amount === 45, "Amount unchanged after partial update");
  assert(partialTxn?.description === "Whole Foods Updated", "Description unchanged");

  // Update with wrong category ownership (non-existent)
  const badCatUpdate = await request(
    "PATCH",
    `/transactions/${expenseId}`,
    { categoryId: "00000000-0000-0000-0000-000000000000" },
    userTokens?.accessToken,
  );
  assert(badCatUpdate.status === 400, "Update with invalid category returns 400");

  // ─── 7. Search Transactions ────────────────────────────────
  console.log("\n─── 7. Search Transactions ───");

  // Search description (partial match)
  const searchFoods = await request(
    "GET",
    "/transactions?search=Whole%20Foods",
    undefined,
    userTokens?.accessToken,
  );
  assert(searchFoods.status === 200, "Search 'Whole Foods' returns 200");
  const foodResults = (searchFoods.json.data?.transactions ?? []) as Array<Record<string, unknown>>;
  assert(foodResults.length >= 1, "Search found at least 1 result");
  assert(foodResults[0].description === "Whole Foods Updated", "Found updated description");

  // Search notes
  const searchNotes = await request(
    "GET",
    "/transactions?search=Monthly",
    undefined,
    userTokens?.accessToken,
  );
  assert(searchNotes.status === 200, "Search 'Monthly' returns 200");
  const notesResults = (searchNotes.json.data?.transactions ?? []) as Array<
    Record<string, unknown>
  >;
  assert(notesResults.length >= 1, "Search found note match");
  const hasMonthly = notesResults.some((t) => t.notes === "Monthly utility payment");
  assert(hasMonthly, "Search 'Monthly' found transaction with that note");

  // Search with no matches
  const searchNone = await request(
    "GET",
    "/transactions?search=zzzznotfound",
    undefined,
    userTokens?.accessToken,
  );
  assert(searchNone.status === 200, "No-match search returns 200");
  const emptyResults = (searchNone.json.data?.transactions ?? []) as Array<unknown>;
  assert(emptyResults.length === 0, "No-match search returns empty array");
  assert(searchNone.json.meta!.total === 0, "Meta.total is 0 for no results");

  // ─── 8. Filters ────────────────────────────────────────────
  console.log("\n─── 8. Filter Transactions ───");

  // Filter by type
  const incomeFilter = await request(
    "GET",
    "/transactions?type=INCOME",
    undefined,
    userTokens?.accessToken,
  );
  assert(incomeFilter.status === 200, "Income filter returns 200");
  const incomeList = (incomeFilter.json.data?.transactions ?? []) as Array<Record<string, unknown>>;
  assert(incomeList.length > 0, "Income filter returned results");
  assert(
    incomeList.every((t): boolean => t.type === "INCOME"),
    "All results are INCOME type",
  );

  const expenseFilter = await request(
    "GET",
    "/transactions?type=EXPENSE",
    undefined,
    userTokens?.accessToken,
  );
  assert(expenseFilter.status === 200, "Expense filter returns 200");
  const expenseList = (expenseFilter.json.data?.transactions ?? []) as Array<
    Record<string, unknown>
  >;
  assert(expenseList.length > 0, "Expense filter returned results");
  assert(
    expenseList.every((t): boolean => t.type === "EXPENSE"),
    "All results are EXPENSE type",
  );

  // Filter by category
  const catFilter = await request(
    "GET",
    `/transactions?categoryId=${testCategoryId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(catFilter.status === 200, "Category filter returns 200");
  const catList = (catFilter.json.data?.transactions ?? []) as Array<Record<string, unknown>>;
  assert(catList.length > 0, "Category filter returned results");
  assert(
    catList.every((t): boolean => t.categoryId === testCategoryId),
    "All results match category",
  );

  // Filter by payment method
  const pmFilter = await request(
    "GET",
    `/transactions?paymentMethodId=${testPaymentMethodId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(pmFilter.status === 200, "Payment method filter returns 200");
  const pmList = (pmFilter.json.data?.transactions ?? []) as Array<Record<string, unknown>>;
  assert(pmList.length > 0, "Payment method filter returned results");
  assert(
    pmList.every((t): boolean => t.paymentMethodId === testPaymentMethodId),
    "All results match payment method",
  );

  // Filter by date range
  const dateFilter = await request(
    "GET",
    "/transactions?startDate=2026-07-01&endDate=2026-07-31",
    undefined,
    userTokens?.accessToken,
  );
  assert(dateFilter.status === 200, "Date range filter returns 200");
  assert(Number(dateFilter.json.meta!.total) >= 3, "July date range finds 3+ transactions");

  // Filter by amount range
  const amountFilter = await request(
    "GET",
    "/transactions?minAmount=100&maxAmount=1000",
    undefined,
    userTokens?.accessToken,
  );
  assert(amountFilter.status === 200, "Amount range filter returns 200");
  const amountList = (amountFilter.json.data?.transactions ?? []) as Array<Record<string, unknown>>;
  assert(amountList.length >= 1, "Amount range finds transactions");
  assert(
    amountList.every((t): boolean => (t.amount as number) >= 100 && (t.amount as number) <= 1000),
    "All results in amount range",
  );

  // Combined filters
  const combined = await request(
    "GET",
    `/transactions?type=EXPENSE&categoryId=${testCategoryId}&minAmount=40&maxAmount=100`,
    undefined,
    userTokens?.accessToken,
  );
  assert(combined.status === 200, "Combined filters return 200");
  const combinedList = (combined.json.data?.transactions ?? []) as Array<Record<string, unknown>>;
  for (const txn of combinedList) {
    const t = txn as Record<string, unknown>;
    assert(t.type === "EXPENSE", "Combined filter — type is EXPENSE");
    assert(t.categoryId === testCategoryId, "Combined filter — category matches");
    assert(
      (t.amount as number) >= 40 && (t.amount as number) <= 100,
      "Combined filter — amount in range",
    );
  }

  // ─── 9. Sorting ────────────────────────────────────────────
  console.log("\n─── 9. Sort Transactions ───");

  // Sort by amount ascending
  const sortAmountAsc = await request(
    "GET",
    "/transactions?sortBy=amount&sortOrder=asc",
    undefined,
    userTokens?.accessToken,
  );
  assert(sortAmountAsc.status === 200, "Sort by amount asc returns 200");
  const ascList = (sortAmountAsc.json.data?.transactions ?? []) as Array<Record<string, unknown>>;
  assert(ascList.length >= 2, "Sort results have transactions");
  for (let i = 1; i < ascList.length; i++) {
    assert(
      (ascList[i].amount as number) >= (ascList[i - 1].amount as number),
      "Amount ascending order",
    );
  }

  // Sort by amount descending
  const sortAmountDesc = await request(
    "GET",
    "/transactions?sortBy=amount&sortOrder=desc",
    undefined,
    userTokens?.accessToken,
  );
  assert(sortAmountDesc.status === 200, "Sort by amount desc returns 200");
  const descList = (sortAmountDesc.json.data?.transactions ?? []) as Array<Record<string, unknown>>;
  for (let i = 1; i < descList.length; i++) {
    assert(
      (descList[i].amount as number) <= (descList[i - 1].amount as number),
      "Amount descending order",
    );
  }

  // Sort by date ascending
  const sortDateAsc = await request(
    "GET",
    "/transactions?sortBy=date&sortOrder=asc",
    undefined,
    userTokens?.accessToken,
  );
  assert(sortDateAsc.status === 200, "Sort by date asc returns 200");

  // Sort by description ascending (title)
  const sortTitleAsc = await request(
    "GET",
    "/transactions?sortBy=description&sortOrder=asc",
    undefined,
    userTokens?.accessToken,
  );
  assert(sortTitleAsc.status === 200, "Sort by description asc returns 200");

  // Sort by createdAt
  const sortCreatedAt = await request(
    "GET",
    "/transactions?sortBy=createdAt&sortOrder=desc",
    undefined,
    userTokens?.accessToken,
  );
  assert(sortCreatedAt.status === 200, "Sort by createdAt desc returns 200");

  // Sort by updatedAt
  const sortUpdatedAt = await request(
    "GET",
    "/transactions?sortBy=updatedAt&sortOrder=asc",
    undefined,
    userTokens?.accessToken,
  );
  assert(sortUpdatedAt.status === 200, "Sort by updatedAt asc returns 200");

  // ─── 10. Pagination ────────────────────────────────────────
  console.log("\n─── 10. Pagination ───");

  // First page with limit 2
  const page1 = await request(
    "GET",
    "/transactions?page=1&limit=2",
    undefined,
    userTokens?.accessToken,
  );
  assert(page1.status === 200, "Page 1 returns 200");
  assert(page1.json.meta!.page === 1, "Meta.page is 1");
  assert(page1.json.meta!.limit === 2, "Meta.limit is 2");
  assert(Number(page1.json.meta!.total) >= 5, "Meta.total >= 5");
  assert(page1.json.meta!.hasPrevPage === false, "Page 1 hasPrevPage=false");
  assert(page1.json.meta!.hasNextPage === true, "Page 1 hasNextPage=true");
  const page1List = (page1.json.data?.transactions ?? []) as Array<Record<string, unknown>>;
  assert(page1List.length === 2, "Page 1 returns exactly 2 items");

  // Second page
  const page2 = await request(
    "GET",
    "/transactions?page=2&limit=2",
    undefined,
    userTokens?.accessToken,
  );
  assert(page2.status === 200, "Page 2 returns 200");
  assert(page2.json.meta!.page === 2, "Meta.page is 2");
  assert(page2.json.meta!.hasPrevPage === true, "Page 2 hasPrevPage=true");

  // Verify pages are different
  const page2List = (page2.json.data?.transactions ?? []) as Array<Record<string, unknown>>;
  const page1Ids = new Set(page1List.map((t) => t.id));
  const page2Ids = new Set(page2List.map((t) => t.id));
  let overlap = false;
  for (const id of page1Ids) {
    if (page2Ids.has(id)) overlap = true;
  }
  assert(!overlap, "Page 1 and Page 2 have no overlapping items");

  // Last page (should have less than limit items or exact)
  const page999 = await request(
    "GET",
    "/transactions?page=999&limit=2",
    undefined,
    userTokens?.accessToken,
  );
  assert(page999.status === 200, "Out-of-range page returns 200");
  const page999List = (page999.json.data?.transactions ?? []) as Array<unknown>;
  assert(page999List.length === 0, "Out-of-range page returns empty array");
  assert(page999.json.meta!.hasNextPage === false, "Out-of-range page hasNextPage=false");

  // Invalid limit
  const badLimit = await request(
    "GET",
    "/transactions?limit=999",
    undefined,
    userTokens?.accessToken,
  );
  assert(badLimit.status === 400, "Limit > 100 returns 400");

  const zeroLimit = await request(
    "GET",
    "/transactions?limit=0",
    undefined,
    userTokens?.accessToken,
  );
  assert(zeroLimit.status === 400, "Limit of 0 returns 400");

  // ─── 11. Statistics / Summary ──────────────────────────────
  console.log("\n─── 11. Statistics (GET /transactions/summary) ───");

  const summary = await request("GET", "/transactions/summary", undefined, userTokens?.accessToken);
  assert(summary.status === 200, "Summary returns 200");
  assert(summary.json.success === true, "Summary success=true");
  const sum = summary.json.data?.summary as Record<string, unknown> | undefined;
  assert(sum != null, "Summary data returned");
  assert(typeof sum!.totalIncome === "number", "totalIncome is a number");
  assert(typeof sum!.totalExpense === "number", "totalExpense is a number");
  assert(typeof sum!.netAmount === "number", "netAmount is a number");
  assert(typeof sum!.count === "number", "count is a number");
  assert(sum!.totalIncome === 5000, "totalIncome is 5000 (July Paycheck)");
  assert(
    sum!.netAmount === (sum!.totalIncome as number) - (sum!.totalExpense as number),
    "netAmount = income - expense",
  );
  assert((sum!.count as number) >= 5, "count >= 5 transactions");

  // Summary with filters
  const filteredSummary = await request(
    "GET",
    "/transactions/summary?type=EXPENSE",
    undefined,
    userTokens?.accessToken,
  );
  assert(filteredSummary.status === 200, "Filtered summary returns 200");
  const filteredSum = filteredSummary.json.data?.summary as Record<string, unknown> | undefined;
  assert((filteredSum!.totalIncome as number) === 0, "Filtered expense summary has 0 income");
  assert((filteredSum!.totalExpense as number) > 0, "Filtered expense summary has expenses");

  // Summary with date range
  const julySummary = await request(
    "GET",
    "/transactions/summary?startDate=2026-07-01&endDate=2026-07-31",
    undefined,
    userTokens?.accessToken,
  );
  assert(julySummary.status === 200, "July summary returns 200");
  const julySum = julySummary.json.data?.summary as Record<string, unknown> | undefined;
  assert((julySum!.count as number) >= 3, "July summary has 3+ transactions");

  // ─── 12. Receipt Upload ────────────────────────────────────
  console.log("\n─── 12. Receipt Upload (POST /transactions/:id/receipt) ───");

  const pngBuffer = createTestPng();
  const receiptBlob = new Blob([pngBuffer], { type: "image/png" });
  const formData = new FormData();
  formData.append("receipt", receiptBlob, "receipt-test.png");

  const receiptUpload = await fetch(`${BASE}/transactions/${expenseId}/receipt`, {
    method: "POST",
    headers: { Authorization: `Bearer ${userTokens?.accessToken ?? ""}` },
    body: formData,
  });
  assert(receiptUpload.status === 200, "Receipt upload returns 200");
  let receiptJson: ApiResult = { success: false };
  try {
    receiptJson = (await receiptUpload.json()) as ApiResult;
  } catch {
    /* ignore */
  }
  assert(receiptJson.success === true, "Receipt upload success=true");
  assert(receiptJson.data?.receiptUrl != null, "Receipt upload returns receiptUrl");
  assert(receiptJson.data?.transaction != null, "Receipt upload returns transaction");
  const receiptTxn = receiptJson.data?.transaction as Record<string, unknown> | undefined;
  assert(receiptTxn?.receiptUrl != null, "Transaction has receiptUrl after upload");

  // Upload without file
  const emptyForm = new FormData();
  const noFileUpload = await fetch(`${BASE}/transactions/${expenseId}/receipt`, {
    method: "POST",
    headers: { Authorization: `Bearer ${userTokens?.accessToken ?? ""}` },
    body: emptyForm,
  });
  assert(noFileUpload.status === 400, "Receipt upload without file returns 400");

  // Remove receipt
  const removeReceipt = await request(
    "DELETE",
    `/transactions/${expenseId}/receipt`,
    undefined,
    userTokens?.accessToken,
  );
  assert(removeReceipt.status === 200, "Remove receipt returns 200");
  const removedTxn = removeReceipt.json.data?.transaction as Record<string, unknown> | undefined;
  assert(removedTxn?.receiptUrl == null, "Transaction receiptUrl is null after removal");

  // ─── 13. Bulk Operations ───────────────────────────────────
  console.log("\n─── 13. Bulk Operations ───");

  // Create a few transactions to bulk-operate on
  const bulk1 = await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: 11.0,
      description: "Bulk Item 1",
      date: "2026-07-01",
      categoryId: testCategoryId,
    },
    userTokens?.accessToken,
  );
  const bulk1Id = (bulk1.json.data?.transaction as Record<string, unknown>)?.id as string;

  const bulk2 = await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: 22.0,
      description: "Bulk Item 2",
      date: "2026-07-02",
      categoryId: testCategoryId,
    },
    userTokens?.accessToken,
  );
  const bulk2Id = (bulk2.json.data?.transaction as Record<string, unknown>)?.id as string;

  // Bulk update category
  const bulkUpdate = await request(
    "POST",
    "/transactions/bulk/update",
    { ids: [bulk1Id, bulk2Id], categoryId: incomeCategoryId },
    userTokens?.accessToken,
  );
  assert(bulkUpdate.status === 200, "Bulk update returns 200");
  assert(bulkUpdate.json.data?.count === 2, "Bulk update affected 2 transactions");

  // Verify the update took effect
  const bulk1After = await request(
    "GET",
    `/transactions/${bulk1Id}`,
    undefined,
    userTokens?.accessToken,
  );
  const afterCat = (bulk1After.json.data?.transaction as Record<string, unknown>)?.categoryId;
  assert(afterCat === incomeCategoryId, "Bulk updated category on transaction 1");

  // Bulk delete
  const bulkDelete = await request(
    "POST",
    "/transactions/bulk/delete",
    { ids: [bulk1Id, bulk2Id] },
    userTokens?.accessToken,
  );
  assert(bulkDelete.status === 200, "Bulk delete returns 200");
  assert(bulkDelete.json.data?.count === 2, "Bulk delete removed 2 transactions");

  // Verify the delete took effect
  const bulk1Gone = await request(
    "GET",
    `/transactions/${bulk1Id}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(bulk1Gone.status === 404, "Bulk deleted transaction returns 404");

  // Empty ids array
  const emptyBulkDelete = await request(
    "POST",
    "/transactions/bulk/delete",
    { ids: [] },
    userTokens?.accessToken,
  );
  assert(emptyBulkDelete.status === 400, "Empty ids array for bulk delete returns 400");

  const emptyBulkUpdate = await request(
    "POST",
    "/transactions/bulk/update",
    { ids: [], categoryId: testCategoryId },
    userTokens?.accessToken,
  );
  assert(emptyBulkUpdate.status === 400, "Empty ids array for bulk update returns 400");

  // Non-existent IDs (should just delete nothing)
  const phantomDelete = await request(
    "POST",
    "/transactions/bulk/delete",
    { ids: ["00000000-0000-0000-0000-000000000000"] },
    userTokens?.accessToken,
  );
  assert(phantomDelete.status === 404, "Bulk delete non-existent IDs returns 404");

  // ─── 14. Single Delete Transaction ─────────────────────────
  console.log("\n─── 14. Delete Transaction (DELETE /transactions/:id) ───");

  const toDelete = await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: 5.0,
      description: "To Be Deleted",
      date: "2026-07-01",
      categoryId: testCategoryId,
    },
    userTokens?.accessToken,
  );
  const deleteId = (toDelete.json.data?.transaction as Record<string, unknown>)?.id as string;
  assert(toDelete.status === 201, "Created transaction for deletion test");

  const deleted = await request(
    "DELETE",
    `/transactions/${deleteId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(deleted.status === 204, "Delete returns 204 No Content");

  const gone = await request(
    "GET",
    `/transactions/${deleteId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(gone.status === 404, "Deleted transaction returns 404");

  // ─── 15. Ownership Validation ──────────────────────────────
  console.log("\n─── 15. Ownership Scoping ───");

  // Register a second user
  const register2 = await request("POST", "/auth/register", {
    email: SECOND_USER_EMAIL,
    password: TEST_PASSWORD,
    name: "Second User",
  });
  assert(register2.status === 201, "Second user registered");
  secondUserTokens = register2.json.data?.tokens as { accessToken: string; refreshToken: string };

  // Second user cannot get primary's transaction
  const forbiddenGet = await request(
    "GET",
    `/transactions/${expenseId}`,
    undefined,
    secondUserTokens?.accessToken,
  );
  assert(forbiddenGet.status === 404, "Second user cannot get primary's transaction (404)");

  // Second user cannot update primary's transaction
  const forbiddenUpdate = await request(
    "PATCH",
    `/transactions/${expenseId}`,
    { description: "Hacked" },
    secondUserTokens?.accessToken,
  );
  assert(forbiddenUpdate.status === 404, "Second user cannot update primary's transaction (404)");

  // Second user cannot delete primary's transaction
  const forbiddenDelete = await request(
    "DELETE",
    `/transactions/${expenseId}`,
    undefined,
    secondUserTokens?.accessToken,
  );
  assert(forbiddenDelete.status === 404, "Second user cannot delete primary's transaction (404)");

  // Second user's list does NOT include primary's transactions
  const secondUserList = await request(
    "GET",
    "/transactions",
    undefined,
    secondUserTokens?.accessToken,
  );
  const secondTxns = (secondUserList.json.data?.transactions ?? []) as Array<
    Record<string, unknown>
  >;
  assert(secondTxns.length === 0, "Second user has 0 transactions (no crossover)");

  // Second user cannot upload receipt on primary's transaction
  const forbiddenReceipt = await fetch(`${BASE}/transactions/${expenseId}/receipt`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secondUserTokens?.accessToken ?? ""}` },
    body: formData,
  });
  assert(
    forbiddenReceipt.status === 404,
    "Second user cannot upload receipt on primary's txn (404)",
  );

  // ─── 16. Unauthenticated Access ────────────────────────────
  console.log("\n─── 16. Unauthenticated Access ───");

  const noAuthList = await request("GET", "/transactions");
  assert(noAuthList.status === 401, "List without auth returns 401");

  const noAuthCreate = await request("POST", "/transactions", {
    type: "EXPENSE",
    amount: 10,
    description: "No auth",
    date: "2026-07-01",
    categoryId: testCategoryId,
  });
  assert(noAuthCreate.status === 401, "Create without auth returns 401");

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
  server = app.listen(4001, async () => {
    console.log(`🧪 Test server running on port 4001`);
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
