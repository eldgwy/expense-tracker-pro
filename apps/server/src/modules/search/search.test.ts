/**
 * Search Module — API Integration Tests
 *
 * Tests: Global search across all entities.
 *
 * Run: npx tsx src/modules/search/search.test.ts
 *
 * Prerequisites: PostgreSQL running, migrations applied
 */

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, "../../../../.env") });

process.env.PORT = "4011";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-for-search-integration-tests";
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

const BASE = "http://localhost:4011/api/v1";
const TEST_EMAIL = `search-test-${Date.now()}@example.com`;
const TEST_PASSWORD = "Test@123456";
const SECOND_USER_EMAIL = `search-test-2-${Date.now()}@example.com`;

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
  console.log("\n🧪 Search Module — API Integration Tests\n");
  console.log(`Test user: ${TEST_EMAIL}\n`);

  // ─── 0. Health Check ───────────────────────────────────────
  console.log("─── 0. Health Check ───");
  const health = await request("GET", "/health");
  assert(health.status === 200, "Health endpoint returns 200");

  // ─── 1. Register User & Set Up Test Data ───────────────────
  console.log("\n─── 1. Register & Create Test Data ───");
  const register = await request("POST", "/auth/register", {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    name: "Search Tester",
  });
  assert(register.status === 201, "Register returns 201");
  userTokens = register.data?.data?.tokens as { accessToken: string; refreshToken: string };
  assert(userTokens != null, "Register returns tokens");

  // Get default categories
  const defaultCats = await request("GET", "/categories", undefined, userTokens?.accessToken);
  assert(defaultCats.status === 200, "Default categories fetched");
  const cats = defaultCats.data?.data?.categories as Array<Record<string, unknown>> | undefined;

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
  testPaymentMethodId = pm.data?.data?.paymentMethod?.id ?? pm.data?.data?.id ?? null;
  assert(testPaymentMethodId != null, "Payment method has ID");

  // Create transactions
  const today = new Date().toISOString().slice(0, 10);

  const tx1 = await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: 42.5,
      description: "Whole Foods Market groceries",
      date: today,
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
      date: today,
      categoryId: incomeCategoryId,
    },
    userTokens?.accessToken,
  );
  assert(tx2.status === 201, "Created income transaction");

  // Create a budget
  const budget = await request(
    "POST",
    "/budgets",
    {
      targetAmount: 500,
      categoryId: testCategoryId,
      startDate: today,
      period: "MONTHLY",
    },
    userTokens?.accessToken,
  );
  assert(budget.status === 201, "Budget created");

  // Create a savings goal
  const goal = await request(
    "POST",
    "/savings-goals",
    {
      name: "Emergency Fund",
      targetAmount: 10000,
      deadline: "2027-01-01",
      priority: "HIGH",
    },
    userTokens?.accessToken,
  );
  assert(goal.status === 201, "Savings goal created");

  // ─── 2. Basic Global Search ────────────────────────────────
  console.log("\n─── 2. Basic Global Search (GET /search?q=...) ───");

  // Search for "Whole Foods"
  const search1 = await request("GET", `/search?q=Whole+Foods`, undefined, userTokens?.accessToken);
  assert(search1.status === 200, "Search for 'Whole Foods' returns 200");
  assert(search1.data?.success === true, "Response has success: true");
  assert(search1.data?.data?.query === "Whole Foods", "Response includes query");
  assert(search1.data?.data?.results?.length > 0, "Search returns results");

  // Should find the transaction
  const hasTx = search1.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title === "Whole Foods Market groceries",
  );
  assert(hasTx === true, "Search finds transaction by description");

  // ─── 3. Partial Match ───────────────────────────────────────
  console.log("\n─── 3. Partial Match ───");

  const searchPartial = await request("GET", "/search?q=Food", undefined, userTokens?.accessToken);
  assert(searchPartial.status === 200, "Search for 'Food' returns 200");
  const partialMatch = searchPartial.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title.includes("Whole Foods"),
  );
  assert(partialMatch === true, "Partial match finds 'Whole Foods' from 'Food'");

  // Should also find the "Food" category
  const catMatch = searchPartial.data?.data?.results?.some(
    (r: any) => r.entity === "categories" && r.title === "Food",
  );
  assert(catMatch === true, "Partial match also finds 'Food' category");

  // ─── 4. Case-Insensitive Search ─────────────────────────────
  console.log("\n─── 4. Case-Insensitive Search ───");

  const searchUpper = await request("GET", "/search?q=WHOLE", undefined, userTokens?.accessToken);
  assert(searchUpper.status === 200, "Search for 'WHOLE' returns 200");
  const upperMatch = searchUpper.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title.includes("Whole Foods"),
  );
  assert(upperMatch === true, "Case-insensitive search finds match");

  const searchLower = await request(
    "GET",
    "/search?q=paycheck",
    undefined,
    userTokens?.accessToken,
  );
  assert(searchLower.status === 200, "Search for 'paycheck' returns 200");
  const lowerMatch = searchLower.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title === "Monthly Paycheck",
  );
  assert(lowerMatch === true, "Case-insensitive search finds 'Monthly Paycheck'");

  // ─── 5. Multiple Keywords ──────────────────────────────────
  console.log("\n─── 5. Multiple Keywords ───");

  const searchMulti = await request(
    "GET",
    "/search?q=Whole+groceries",
    undefined,
    userTokens?.accessToken,
  );
  assert(searchMulti.status === 200, "Search for 'Whole groceries' returns 200");
  const multiMatch = searchMulti.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title === "Whole Foods Market groceries",
  );
  assert(multiMatch === true, "Multiple keywords find transaction");

  // ─── 6. Entity-Specific Search ─────────────────────────────
  console.log("\n─── 6. Entity-Specific Search ───");

  // Search only transactions
  const searchTxOnly = await request(
    "GET",
    "/search?q=Whole&entities=transactions",
    undefined,
    userTokens?.accessToken,
  );
  assert(searchTxOnly.status === 200, "Entity-specific search returns 200");
  const allTx = searchTxOnly.data?.data?.results?.every((r: any) => r.entity === "transactions");
  assert(allTx === true, "Only transactions returned");

  // Search only categories
  const searchCatOnly = await request(
    "GET",
    "/search?q=Food&entities=categories",
    undefined,
    userTokens?.accessToken,
  );
  assert(searchCatOnly.status === 200, "Category-only search returns 200");
  const allCat = searchCatOnly.data?.data?.results?.every((r: any) => r.entity === "categories");
  assert(allCat === true, "Only categories returned");

  // Search only savings goals
  const searchGoalOnly = await request(
    "GET",
    "/search?q=Emergency&entities=savings-goals",
    undefined,
    userTokens?.accessToken,
  );
  assert(searchGoalOnly.status === 200, "Savings goal search returns 200");
  const goalMatch = searchGoalOnly.data?.data?.results?.some(
    (r: any) => r.entity === "savings-goals" && r.title === "Emergency Fund",
  );
  assert(goalMatch === true, "Finds savings goal by name");

  // Search payment methods
  const searchPm = await request(
    "GET",
    "/search?q=Visa&entities=payment-methods",
    undefined,
    userTokens?.accessToken,
  );
  assert(searchPm.status === 200, "Payment method search returns 200");
  const pmMatch = searchPm.data?.data?.results?.some(
    (r: any) => r.entity === "payment-methods" && r.title === "Test Visa",
  );
  assert(pmMatch === true, "Finds payment method by name");

  // ─── 7. Counts By Entity ──────────────────────────────────
  console.log("\n─── 7. Counts By Entity ───");

  const searchCounts = await request("GET", "/search?q=Food", undefined, userTokens?.accessToken);
  assert(searchCounts.data?.data?.countsByEntity != null, "Response includes countsByEntity");
  assert(
    typeof searchCounts.data?.data?.countsByEntity === "object",
    "countsByEntity is an object",
  );

  // ─── 8. Limit Parameter ────────────────────────────────────
  console.log("\n─── 8. Limit Parameter ───");

  const searchLimit = await request(
    "GET",
    "/search?q=a&limit=1",
    undefined,
    userTokens?.accessToken,
  );
  assert(searchLimit.status === 200, "Search with limit returns 200");

  // ─── 9. Empty Query ────────────────────────────────────────
  console.log("\n─── 9. Validation: Empty Query ───");

  const emptyQ = await request("GET", "/search?q=", undefined, userTokens?.accessToken);
  assert(emptyQ.status === 400, "Empty query returns 400");

  // ─── 10. Invalid Entity ─────────────────────────────────────
  console.log("\n─── 10. Validation: Invalid Entity ───");

  const badEntity = await request(
    "GET",
    "/search?q=test&entities=invalid",
    undefined,
    userTokens?.accessToken,
  );
  assert(badEntity.status === 400, "Invalid entity returns 400");

  // ─── 11. Empty Results ─────────────────────────────────────
  console.log("\n─── 11. Empty Results ───");

  const noResults = await request(
    "GET",
    "/search?q=xyznonexistent2026",
    undefined,
    userTokens?.accessToken,
  );
  assert(noResults.status === 200, "Search with no matches returns 200");
  assert(noResults.data?.data?.results?.length === 0, "Empty results array");
  assert(noResults.data?.data?.totalCount === 0, "Total count is 0");

  // ─── 12. Unauthenticated Access ────────────────────────────
  console.log("\n─── 12. Unauthenticated Access ───");

  const noAuth = await request("GET", "/search?q=test");
  assert(noAuth.status === 401, "Search without auth returns 401");

  // ─── 14. Category Filter: Single Category ─────────────────
  console.log("\n─── 14. Category Filter: Single Category ───");

  // Filter by expense category (Food) - should find expense transactions + budgets
  const catFilter = await request(
    "GET",
    `/search?q=a&categoryIds=${testCategoryId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(catFilter.status === 200, "Category filter returns 200");
  const catFilteredTx = catFilter.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title === "Whole Foods Market groceries",
  );
  assert(catFilteredTx === true, "Category filter finds expense transaction");
  const catFilteredBudget = catFilter.data?.data?.results?.some(
    (r: any) => r.entity === "budgets" && r.title === "Food",
  );
  assert(catFilteredBudget === true, "Category filter finds budget by category");

  // Should NOT find income transaction (different category)
  const catFilteredIncome = catFilter.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title === "Monthly Paycheck",
  );
  assert(catFilteredIncome !== true, "Category filter excludes other category transactions");

  // ─── 15. Category Filter: Multiple Categories ──────────────
  console.log("\n─── 15. Category Filter: Multiple Categories ───");

  const multiCatFilter = await request(
    "GET",
    `/search?q=a&categoryIds=${testCategoryId},${incomeCategoryId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(multiCatFilter.status === 200, "Multi-category filter returns 200");
  const multiTx1 = multiCatFilter.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title === "Whole Foods Market groceries",
  );
  assert(multiTx1 === true, "Multi-category finds expense transaction");
  const multiTx2 = multiCatFilter.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title === "Monthly Paycheck",
  );
  assert(multiTx2 === true, "Multi-category finds income transaction");

  // ─── 16. Category Type: Income ─────────────────────────────
  console.log("\n─── 16. Category Type: Income ───");

  const incomeTypeFilter = await request(
    "GET",
    "/search?q=a&categoryType=income",
    undefined,
    userTokens?.accessToken,
  );
  assert(incomeTypeFilter.status === 200, "Income category type filter returns 200");
  const incomeTx = incomeTypeFilter.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title === "Monthly Paycheck",
  );
  assert(incomeTx === true, "Income type filter finds income transaction");
  const incomeNoExpense = incomeTypeFilter.data?.data?.results?.every(
    (r: any) => r.entity !== "transactions" || !r.title.includes("Whole Foods"),
  );
  assert(incomeNoExpense !== false, "Income type filter excludes expense transactions");

  // ─── 17. Category Type: Expense ────────────────────────────
  console.log("\n─── 17. Category Type: Expense ───");

  const expenseTypeFilter = await request(
    "GET",
    "/search?q=a&categoryType=expense",
    undefined,
    userTokens?.accessToken,
  );
  assert(expenseTypeFilter.status === 200, "Expense category type filter returns 200");
  const expenseTx = expenseTypeFilter.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title === "Whole Foods Market groceries",
  );
  assert(expenseTx === true, "Expense type filter finds expense transaction");

  // ─── 18. Combined: Category IDs + Category Type ────────────
  console.log("\n─── 18. Combined: Category IDs + Category Type ───");

  const combinedFilter = await request(
    "GET",
    `/search?q=a&categoryIds=${testCategoryId},${incomeCategoryId}&categoryType=income`,
    undefined,
    userTokens?.accessToken,
  );
  assert(combinedFilter.status === 200, "Combined filter returns 200");
  const combinedIncome = combinedFilter.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title === "Monthly Paycheck",
  );
  assert(combinedIncome === true, "Combined filter finds income transaction");
  const combinedNoExpense = combinedFilter.data?.data?.results?.every(
    (r: any) => r.entity !== "transactions" || !r.title.includes("Whole Foods"),
  );
  assert(
    combinedNoExpense !== false,
    "Combined filter excludes expense even though Food category is in categoryIds",
  );

  // ─── 19. Validation: Invalid Category UUID ─────────────────
  console.log("\n─── 19. Validation: Invalid Category UUID ───");

  const badCategoryUuid = await request(
    "GET",
    "/search?q=a&categoryIds=not-a-uuid",
    undefined,
    userTokens?.accessToken,
  );
  assert(badCategoryUuid.status === 400, "Invalid category UUID returns 400");

  // ─── 20. Validation: Invalid Category Type ─────────────────
  console.log("\n─── 20. Validation: Invalid Category Type ───");

  const badCategoryType = await request(
    "GET",
    "/search?q=a&categoryType=invalid",
    undefined,
    userTokens?.accessToken,
  );
  assert(badCategoryType.status === 400, "Invalid category type returns 400");

  // ─── 21. Date Filters: This Month ─────────────────────────
  console.log("\n─── 21. Date Filters: This Month ───");

  const dateThisMonth = await request(
    "GET",
    "/search?q=a&datePreset=this_month",
    undefined,
    userTokens?.accessToken,
  );
  assert(dateThisMonth.status === 200, "Date preset 'this_month' returns 200");
  const thisMonthTx = dateThisMonth.data?.data?.results?.some(
    (r: any) => r.entity === "transactions",
  );
  assert(thisMonthTx === true, "Date filter 'this_month' finds transactions");

  // ─── 22. Date Filters: This Year ──────────────────────────
  console.log("\n─── 22. Date Filters: This Year ───");

  const dateThisYear = await request(
    "GET",
    "/search?q=a&datePreset=this_year",
    undefined,
    userTokens?.accessToken,
  );
  assert(dateThisYear.status === 200, "Date preset 'this_year' returns 200");
  const thisYearTx = dateThisYear.data?.data?.results?.some(
    (r: any) => r.entity === "transactions",
  );
  assert(thisYearTx === true, "Date filter 'this_year' finds transactions");

  // ─── 23. Date Filters: Today ───────────────────────────────
  console.log("\n─── 23. Date Filters: Today ───");

  const dateToday = await request(
    "GET",
    "/search?q=a&datePreset=today",
    undefined,
    userTokens?.accessToken,
  );
  assert(dateToday.status === 200, "Date preset 'today' returns 200");
  const todayTx = dateToday.data?.data?.results?.some((r: any) => r.entity === "transactions");
  assert(todayTx === true, "Date filter 'today' finds today's transactions");

  // ─── 24. Date Filters: Yesterday ───────────────────────────
  console.log("\n─── 24. Date Filters: Yesterday ───");

  const dateYesterday = await request(
    "GET",
    "/search?q=a&datePreset=yesterday",
    undefined,
    userTokens?.accessToken,
  );
  assert(dateYesterday.status === 200, "Date preset 'yesterday' returns 200");
  // Yesterday may not have transactions (depends on when tests run)
  // Just verify the request succeeds and returns valid structure
  assert(
    typeof dateYesterday.data?.data?.totalCount === "number",
    "Date filter 'yesterday' returns valid count",
  );

  // ─── 25. Date Filters: This Week ───────────────────────────
  console.log("\n─── 25. Date Filters: This Week ───");

  const dateThisWeek = await request(
    "GET",
    "/search?q=a&datePreset=this_week",
    undefined,
    userTokens?.accessToken,
  );
  assert(dateThisWeek.status === 200, "Date preset 'this_week' returns 200");
  const thisWeekTx = dateThisWeek.data?.data?.results?.some(
    (r: any) => r.entity === "transactions",
  );
  assert(thisWeekTx === true, "Date filter 'this_week' finds transactions");

  // ─── 26. Date Filters: Last Week ───────────────────────────
  console.log("\n─── 26. Date Filters: Last Week ───");

  const dateLastWeek = await request(
    "GET",
    "/search?q=a&datePreset=last_week",
    undefined,
    userTokens?.accessToken,
  );
  assert(dateLastWeek.status === 200, "Date preset 'last_week' returns 200");
  // Just verify structure
  assert(
    typeof dateLastWeek.data?.data?.totalCount === "number",
    "Date filter 'last_week' returns valid count",
  );

  // ─── 27. Date Filters: Last Month ──────────────────────────
  console.log("\n─── 27. Date Filters: Last Month ───");

  const dateLastMonth = await request(
    "GET",
    "/search?q=a&datePreset=last_month",
    undefined,
    userTokens?.accessToken,
  );
  assert(dateLastMonth.status === 200, "Date preset 'last_month' returns 200");
  assert(
    typeof dateLastMonth.data?.data?.totalCount === "number",
    "Date filter 'last_month' returns valid count",
  );

  // ─── 28. Date Filters: Custom Date Range ───────────────────
  console.log("\n─── 28. Date Filters: Custom Date Range ───");

  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 30);
  const endStr = futureDate.toISOString().slice(0, 10);
  const startStr = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const customRange = await request(
    "GET",
    `/search?q=a&startDate=${startStr}&endDate=${endStr}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(customRange.status === 200, "Custom date range returns 200");
  const rangeTx = customRange.data?.data?.results?.some((r: any) => r.entity === "transactions");
  assert(rangeTx === true, "Custom date range finds transactions");

  // ─── 29. Date Filters: datePreset + startDate Conflict ─────
  console.log("\n─── 29. Date Filters: datePreset + startDate Conflict ───");

  const conflict = await request(
    "GET",
    `/search?q=a&datePreset=today&startDate=${startStr}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(conflict.status === 400, "datePreset + startDate returns 400");

  // ─── 30. Date Filters: startDate without endDate ───────────
  console.log("\n─── 30. Date Filters: startDate without endDate ───");

  const missingEnd = await request(
    "GET",
    `/search?q=a&startDate=${startStr}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(missingEnd.status === 400, "startDate without endDate returns 400");

  // ─── 31. Date Filters: endDate without startDate ───────────
  console.log("\n─── 31. Date Filters: endDate without startDate ───");

  const missingStart = await request(
    "GET",
    `/search?q=a&endDate=${endStr}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(missingStart.status === 400, "endDate without startDate returns 400");

  // ─── 32. Date Filters: Invalid date format ─────────────────
  console.log("\n─── 32. Date Filters: Invalid date format ───");

  const badDate = await request(
    "GET",
    "/search?q=a&startDate=not-a-date&endDate=also-bad",
    undefined,
    userTokens?.accessToken,
  );
  assert(badDate.status === 400, "Invalid date format returns 400");

  // ─── 33. Combined: Category + Date Filter ───────────────────
  console.log("\n─── 33. Combined: Category + Date Filter ───");

  const combinedCatDate = await request(
    "GET",
    `/search?q=a&categoryIds=${testCategoryId}&datePreset=this_year`,
    undefined,
    userTokens?.accessToken,
  );
  assert(combinedCatDate.status === 200, "Category + date filter returns 200");
  const comboMatch = combinedCatDate.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title === "Whole Foods Market groceries",
  );
  assert(comboMatch === true, "Category + date filter finds expected transaction");

  // Create a small-amount transaction for amount filter testing
  const tx3 = await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: 3.5,
      description: "Coffee and bagel",
      date: today,
      categoryId: testCategoryId,
      paymentMethodId: testPaymentMethodId,
    },
    userTokens?.accessToken,
  );
  assert(tx3.status === 201, "Created small expense transaction");

  // ─── 34. Amount Filter: minAmount ──────────────────────────
  console.log("\n─── 34. Amount Filter: minAmount ───");

  const minAmountSearch = await request(
    "GET",
    "/search?q=a&minAmount=10",
    undefined,
    userTokens?.accessToken,
  );
  assert(minAmountSearch.status === 200, "Min amount filter returns 200");
  const minAmtTx = minAmountSearch.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title === "Whole Foods Market groceries",
  );
  assert(minAmtTx === true, "minAmount=10 finds $42.50 transaction");
  const minAmtSmall = minAmountSearch.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title === "Coffee and bagel",
  );
  assert(minAmtSmall !== true, "minAmount=10 excludes $3.50 transaction");

  // ─── 35. Amount Filter: maxAmount ──────────────────────────
  console.log("\n─── 35. Amount Filter: maxAmount ───");

  const maxAmountSearch = await request(
    "GET",
    "/search?q=a&maxAmount=10",
    undefined,
    userTokens?.accessToken,
  );
  assert(maxAmountSearch.status === 200, "Max amount filter returns 200");
  const maxAmtSmall = maxAmountSearch.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title === "Coffee and bagel",
  );
  assert(maxAmtSmall === true, "maxAmount=10 finds $3.50 transaction");
  const maxAmtLarge = maxAmountSearch.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title === "Monthly Paycheck",
  );
  assert(maxAmtLarge !== true, "maxAmount=10 excludes $5000 transaction");

  // ─── 36. Amount Filter: Range (minAmount + maxAmount) ───────
  console.log("\n─── 36. Amount Filter: Range ───");

  const rangeSearch = await request(
    "GET",
    "/search?q=a&minAmount=40&maxAmount=100",
    undefined,
    userTokens?.accessToken,
  );
  assert(rangeSearch.status === 200, "Amount range filter returns 200");
  const amountRangeTx = rangeSearch.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title === "Whole Foods Market groceries",
  );
  assert(amountRangeTx === true, "Range 40-100 finds $42.50 transaction");

  // ─── 37. Amount Filter: Exact Amount ───────────────────────
  console.log("\n─── 37. Amount Filter: Exact Amount ───");

  const exactSearch = await request(
    "GET",
    "/search?q=a&exactAmount=5000",
    undefined,
    userTokens?.accessToken,
  );
  assert(exactSearch.status === 200, "Exact amount filter returns 200");
  const exactTx = exactSearch.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title === "Monthly Paycheck",
  );
  assert(exactTx === true, "exactAmount=5000 finds $5000 transaction");
  const exactNoMatch = exactSearch.data?.data?.results?.every(
    (r: any) => r.entity !== "transactions" || r.amount === 5000,
  );
  assert(exactNoMatch !== false, "exactAmount=5000 excludes other amounts");

  // ─── 38. Amount Filter: Decimal Values ─────────────────────
  console.log("\n─── 38. Amount Filter: Decimal Values ───");

  const decimalSearch = await request(
    "GET",
    "/search?q=a&exactAmount=42.50",
    undefined,
    userTokens?.accessToken,
  );
  assert(decimalSearch.status === 200, "Decimal exact amount filter returns 200");
  const decimalTx = decimalSearch.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title === "Whole Foods Market groceries",
  );
  assert(decimalTx === true, "exactAmount=42.50 finds $42.50 transaction");

  // ─── 39. Validation: exactAmount + minAmount Conflict ───────
  console.log("\n─── 39. Validation: exactAmount + minAmount Conflict ───");

  const conflictAmt = await request(
    "GET",
    "/search?q=a&exactAmount=100&minAmount=50",
    undefined,
    userTokens?.accessToken,
  );
  assert(conflictAmt.status === 400, "exactAmount + minAmount returns 400");

  const conflictAmt2 = await request(
    "GET",
    "/search?q=a&exactAmount=100&maxAmount=200",
    undefined,
    userTokens?.accessToken,
  );
  assert(conflictAmt2.status === 400, "exactAmount + maxAmount returns 400");

  // ─── 40. Validation: minAmount > maxAmount ─────────────────
  console.log("\n─── 40. Validation: minAmount > maxAmount ───");

  const badRange = await request(
    "GET",
    "/search?q=a&minAmount=100&maxAmount=50",
    undefined,
    userTokens?.accessToken,
  );
  assert(badRange.status === 400, "minAmount > maxAmount returns 400");

  // ─── 41. Validation: Negative Amount ───────────────────────
  console.log("\n─── 41. Validation: Negative Amount ───");

  const negativeAmt = await request(
    "GET",
    "/search?q=a&minAmount=-10",
    undefined,
    userTokens?.accessToken,
  );
  assert(negativeAmt.status === 400, "Negative minAmount returns 400");

  // ─── 42. Validation: Too Many Decimal Places ────────────────
  console.log("\n─── 42. Validation: Too Many Decimal Places ───");

  const badDecimals = await request(
    "GET",
    "/search?q=a&exactAmount=1.234",
    undefined,
    userTokens?.accessToken,
  );
  assert(badDecimals.status === 400, "Three decimal places returns 400");

  // ─── 43. Amount + Category Combined ─────────────────────────
  console.log("\n─── 43. Amount + Category Combined ───");

  const amtCatCombo = await request(
    "GET",
    `/search?q=a&categoryIds=${testCategoryId}&minAmount=1&maxAmount=100`,
    undefined,
    userTokens?.accessToken,
  );
  assert(amtCatCombo.status === 200, "Amount + category filter returns 200");
  const comboFound = amtCatCombo.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title === "Whole Foods Market groceries",
  );
  assert(comboFound === true, "Amount + category finds expense in Food category in 1-100 range");

  // ─── 44. Combined: Date + Amount ──────────────────────────
  console.log("\n─── 44. Combined: Date + Amount ───");

  const dateAmtCombo = await request(
    "GET",
    `/search?q=a&datePreset=this_year&minAmount=10&maxAmount=100`,
    undefined,
    userTokens?.accessToken,
  );
  assert(dateAmtCombo.status === 200, "Date + amount filter returns 200");
  const dateAmtTx = dateAmtCombo.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title === "Whole Foods Market groceries",
  );
  assert(dateAmtTx === true, "Date + amount finds $42.50 transaction in this year");
  const dateAmtExcluded = dateAmtCombo.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title === "Monthly Paycheck",
  );
  assert(dateAmtExcluded !== true, "Date + amount excludes $5000 transaction (above max)");

  // ─── 45. Combined: Category + Date + Amount + Search ────────
  console.log("\n─── 45. Combined: Category + Date + Amount + Search ───");

  const allFilters = await request(
    "GET",
    `/search?q=groceries&categoryIds=${testCategoryId}&datePreset=this_year&minAmount=1&maxAmount=100`,
    undefined,
    userTokens?.accessToken,
  );
  assert(allFilters.status === 200, "All filters combined returns 200");
  const allMatch = allFilters.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title === "Whole Foods Market groceries",
  );
  assert(allMatch === true, "All filters finds 'groceries' in Food category, this year, $1-100");
  const allExcludedCoffee = allFilters.data?.data?.results?.some(
    (r: any) => r.entity === "transactions" && r.title === "Coffee and bagel",
  );
  assert(
    allExcludedCoffee !== true,
    "All filters excludes Coffee (description doesn't match 'groceries')",
  );

  // ─── 46. Combined: Category + Amount + Date + Sort ──────────
  console.log("\n─── 46. Combined: Category + Amount + Date + Sort ───");

  const allWithSort = await request(
    "GET",
    `/search?q=a&categoryIds=${testCategoryId},${incomeCategoryId}&datePreset=this_year&minAmount=1&sortBy=amount&sortOrder=asc`,
    undefined,
    userTokens?.accessToken,
  );
  assert(allWithSort.status === 200, "All filters + sort returns 200");
  const sortedTx = allWithSort.data?.data?.results?.filter((r: any) => r.entity === "transactions");
  if (sortedTx && sortedTx.length >= 2) {
    const amounts = sortedTx.map((r: any) => r.amount);
    assert(amounts[0] <= amounts[1], "Combined filters + sort: amounts in ascending order");
  }

  // ─── 47. Sorting: Amount Ascending ───────────────────────
  console.log("\n─── 47. Sorting: Amount Ascending ───");

  const sortAmtAsc = await request(
    "GET",
    "/search?q=a&sortBy=amount&sortOrder=asc&entities=transactions",
    undefined,
    userTokens?.accessToken,
  );
  assert(sortAmtAsc.status === 200, "Sort by amount asc returns 200");
  const txResults = sortAmtAsc.data?.data?.results?.filter((r: any) => r.entity === "transactions");
  if (txResults && txResults.length >= 2) {
    const amounts = txResults.map((r: any) => r.amount);
    assert(amounts[0] <= amounts[1], "Amount asc: first <= second");
  }

  // ─── 48. Sorting: Amount Descending ────────────────────────
  console.log("\n─── 48. Sorting: Amount Descending ───");

  const sortAmtDesc = await request(
    "GET",
    "/search?q=a&sortBy=amount&sortOrder=desc&entities=transactions",
    undefined,
    userTokens?.accessToken,
  );
  assert(sortAmtDesc.status === 200, "Sort by amount desc returns 200");
  const txResultsDesc = sortAmtDesc.data?.data?.results?.filter(
    (r: any) => r.entity === "transactions",
  );
  if (txResultsDesc && txResultsDesc.length >= 2) {
    const amounts = txResultsDesc.map((r: any) => r.amount);
    assert(amounts[0] >= amounts[1], "Amount desc: first >= second");
  }

  // ─── 49. Sorting: Title Ascending ───────────────────────────
  console.log("\n─── 49. Sorting: Title Ascending ───");

  const sortTitleAsc = await request(
    "GET",
    "/search?q=a&sortBy=title&sortOrder=asc&entities=transactions",
    undefined,
    userTokens?.accessToken,
  );
  assert(sortTitleAsc.status === 200, "Sort by title asc returns 200");
  const titleResults = sortTitleAsc.data?.data?.results?.filter(
    (r: any) => r.entity === "transactions",
  );
  if (titleResults && titleResults.length >= 2) {
    const titles = titleResults.map((r: any) => r.title.toLowerCase());
    assert(titles[0] <= titles[1], "Title asc: alphabetical order");
  }

  // ─── 50. Sorting: Title Descending ─────────────────────────
  console.log("\n─── 50. Sorting: Title Descending ───");

  const sortTitleDesc = await request(
    "GET",
    "/search?q=a&sortBy=title&sortOrder=desc&entities=transactions",
    undefined,
    userTokens?.accessToken,
  );
  assert(sortTitleDesc.status === 200, "Sort by title desc returns 200");
  const titleResultsDesc = sortTitleDesc.data?.data?.results?.filter(
    (r: any) => r.entity === "transactions",
  );
  if (titleResultsDesc && titleResultsDesc.length >= 2) {
    const titles = titleResultsDesc.map((r: any) => r.title.toLowerCase());
    assert(titles[0] >= titles[1], "Title desc: reverse alphabetical order");
  }

  // ─── 51. Sorting: By Date ──────────────────────────────────
  console.log("\n─── 51. Sorting: By Date ───");

  const sortDate = await request(
    "GET",
    "/search?q=a&sortBy=date&sortOrder=asc&entities=transactions",
    undefined,
    userTokens?.accessToken,
  );
  assert(sortDate.status === 200, "Sort by date returns 200");
  const dateResults = sortDate.data?.data?.results?.filter((r: any) => r.entity === "transactions");
  if (dateResults && dateResults.length >= 2) {
    const dates = dateResults.map((r: any) => r.date);
    assert(dates[0] <= dates[1], "Date asc: chronological order");
  }

  // ─── 52. Sorting: Invalid SortBy ───────────────────────────
  console.log("\n─── 52. Sorting: Invalid SortBy ───");

  const badSortBy = await request(
    "GET",
    "/search?q=a&sortBy=invalid",
    undefined,
    userTokens?.accessToken,
  );
  assert(badSortBy.status === 400, "Invalid sortBy returns 400");

  // ─── 53. Sorting: Invalid SortOrder ────────────────────────
  console.log("\n─── 53. Sorting: Invalid SortOrder ───");

  const badSortOrder = await request(
    "GET",
    "/search?q=a&sortOrder=invalid",
    undefined,
    userTokens?.accessToken,
  );
  assert(badSortOrder.status === 400, "Invalid sortOrder returns 400");

  // ─── 54. Ownership Scoping ─────────────────────────────────
  console.log("\n─── 54. Ownership Scoping ───");

  const register2 = await request("POST", "/auth/register", {
    email: SECOND_USER_EMAIL,
    password: TEST_PASSWORD,
    name: "Second User",
  });
  assert(register2.status === 201, "Second user registered");
  secondUserTokens = register2.data?.data?.tokens as { accessToken: string; refreshToken: string };

  // Second user search should not find first user's data
  const secondSearch = await request(
    "GET",
    "/search?q=Whole+Foods",
    undefined,
    secondUserTokens?.accessToken,
  );
  assert(secondSearch.status === 200, "Second user search returns 200");
  const noCrossUser = secondSearch.data?.data?.results?.every(
    (r: any) => !r.title.includes("Whole Foods"),
  );
  assert(noCrossUser !== false, "Second user cannot see first user's data");

  // ─── 55. Search Suggestions: Basic Query ─────────────────
  console.log("\n─── 55. Search Suggestions: Basic Query ───");

  const sug1 = await request(
    "GET",
    "/search/suggestions?q=Food",
    undefined,
    userTokens?.accessToken,
  );
  assert(sug1.status === 200, "Suggestions for 'Food' returns 200");
  assert(sug1.data?.success === true, "Suggestions has success: true");
  assert(sug1.data?.data?.query === "Food", "Suggestions includes query");
  assert(Array.isArray(sug1.data?.data?.suggestions), "Suggestions returns array");

  // Should find the Food category as a suggestion
  const hasCategory = sug1.data?.data?.suggestions?.some(
    (g: any) => g.entity === "category" && g.items?.some((i: any) => i.label === "Food"),
  );
  assert(hasCategory === true, "Suggestions finds Food category");

  // ─── 56. Search Suggestions: Transaction Titles ────────────
  console.log("\n─── 56. Search Suggestions: Transaction Titles ───");

  const sug2 = await request(
    "GET",
    "/search/suggestions?q=Whole",
    undefined,
    userTokens?.accessToken,
  );
  assert(sug2.status === 200, "Suggestions for 'Whole' returns 200");
  const hasTxTitle = sug2.data?.data?.suggestions?.some(
    (g: any) =>
      g.entity === "transaction-title" &&
      g.items?.some((i: any) => i.label === "Whole Foods Market groceries"),
  );
  assert(hasTxTitle === true, "Suggestions finds transaction title matching 'Whole'");

  // ─── 57. Search Suggestions: Payment Methods ───────────────
  console.log("\n─── 57. Search Suggestions: Payment Methods ───");

  const sug3 = await request(
    "GET",
    "/search/suggestions?q=Visa",
    undefined,
    userTokens?.accessToken,
  );
  assert(sug3.status === 200, "Suggestions for 'Visa' returns 200");
  const hasPM = sug3.data?.data?.suggestions?.some(
    (g: any) => g.entity === "payment-method" && g.items?.some((i: any) => i.label === "Test Visa"),
  );
  assert(hasPM === true, "Suggestions finds payment method matching 'Visa'");

  // ─── 58. Search Suggestions: Case Insensitive ──────────────
  console.log("\n─── 58. Search Suggestions: Case Insensitive ───");

  const sug4 = await request(
    "GET",
    "/search/suggestions?q=food",
    undefined,
    userTokens?.accessToken,
  );
  assert(sug4.status === 200, "Suggestions for 'food' returns 200");
  const hasLower = sug4.data?.data?.suggestions?.some(
    (g: any) => g.entity === "category" && g.items?.some((i: any) => i.label === "Food"),
  );
  assert(hasLower === true, "Case-insensitive suggestions find Food category");

  // ─── 59. Search Suggestions: Query Too Short ───────────────
  console.log("\n─── 59. Search Suggestions: Query Too Short ───");

  const shortQuery = await request(
    "GET",
    "/search/suggestions?q=a",
    undefined,
    userTokens?.accessToken,
  );
  assert(shortQuery.status === 400, "Single-char suggestions query returns 400");

  // ─── 60. Search Suggestions: Unauthenticated ───────────────
  console.log("\n─── 60. Search Suggestions: Unauthenticated ───");

  const noAuthSuggest = await request("GET", "/search/suggestions?q=Food");
  assert(noAuthSuggest.status === 401, "Suggestions without auth returns 401");

  // ─── 61. Performance: Search Response Time ────────────────
  console.log("\n─── 61. Performance: Search Response Time ───");

  // Create additional transactions to simulate a larger dataset
  for (let i = 0; i < 50; i++) {
    await request(
      "POST",
      "/transactions",
      {
        type: i % 2 === 0 ? "EXPENSE" : "INCOME",
        amount: Math.round(Math.random() * 500 * 100) / 100,
        description: `Performance test transaction ${i}`,
        date: today,
        categoryId: i % 3 === 0 ? testCategoryId : incomeCategoryId,
        paymentMethodId: i % 2 === 0 ? testPaymentMethodId : undefined,
      },
      userTokens?.accessToken,
    );
  }

  const startTime = Date.now();
  const perfSearch = await request(
    "GET",
    "/search?q=a&sortBy=amount&sortOrder=asc",
    undefined,
    userTokens?.accessToken,
  );
  const elapsed = Date.now() - startTime;
  assert(perfSearch.status === 200, "Performance search returns 200");
  assert(elapsed < 2000, `Search responded in ${elapsed}ms (should be < 2000ms)`);
  console.log(`    ⏱️  Response time: ${elapsed}ms`);

  // Verify all filter types still work with larger dataset
  const perfCatFilter = await request(
    "GET",
    `/search?q=a&categoryIds=${testCategoryId}&datePreset=this_year`,
    undefined,
    userTokens?.accessToken,
  );
  assert(perfCatFilter.status === 200, "Category + date filter with 50+ transactions returns 200");

  const perfSuggest = await request(
    "GET",
    "/search/suggestions?q=Performance",
    undefined,
    userTokens?.accessToken,
  );
  assert(perfSuggest.status === 200, "Suggestions with 50+ transactions returns 200");
  const hasPerfSugg = perfSuggest.data?.data?.suggestions?.some(
    (g: any) => g.entity === "transaction-title" && g.items?.length > 0,
  );
  assert(hasPerfSugg === true, "Suggestions finds transaction titles with larger dataset");

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
  server = app.listen(4011, async () => {
    console.log(`🧪 Test server running on port 4011`);
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
