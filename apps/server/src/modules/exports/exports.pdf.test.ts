/**
 * Exports PDF Module — API Integration Tests
 *
 * Tests: PDF export of transactions and reports.
 *
 * Run: npx tsx src/modules/exports/exports.pdf.test.ts
 *
 * Prerequisites: PostgreSQL running, migrations applied
 */

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, "../../../../.env") });

process.env.PORT = "4010";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-for-exports-pdf-integration-tests";
process.env.JWT_EXPIRES_IN = "1h";
process.env.JWT_REFRESH_EXPIRES_IN = "7d";

import { createApp } from "../../app.js";
import type { Application } from "express";
import type { Server } from "node:http";

// ─── Test Runner ──────────────────────────────────────────────

let passed = 0;
let failed = 0;
let userTokens: { accessToken: string; refreshToken: string } | null = null;
let testCategoryId: string | null = null;
let incomeCategoryId: string | null = null;
let testPaymentMethodId: string | null = null;
let server: Server;
let app: Application;

const BASE = "http://localhost:4010/api/v1";
const TEST_EMAIL = `pdf-test-${Date.now()}@example.com`;
const TEST_PASSWORD = "Test@123456";

async function request(
  method: string,
  path: string,
  reqBody?: unknown,
  token?: string | null,
): Promise<{ status: number; text: string; contentType: string; buffer?: Buffer }> {
  const headers: Record<string, string> = {};
  if (reqBody !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: reqBody ? JSON.stringify(reqBody) : undefined,
  });

  const status = response.status;
  const contentType = response.headers.get("content-type") ?? "";
  const arrayBuffer = await response.arrayBuffer();
  const text = new TextDecoder().decode(arrayBuffer);
  const buffer = Buffer.from(arrayBuffer);

  return { status, text, contentType, buffer };
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

// ─── PDF Validation Helpers ───────────────────────────────────

/**
 * Check if the buffer starts with a PDF signature (%PDF-).
 */
function isPdfSignature(buffer: Buffer): boolean {
  if (buffer.length < 5) return false;
  const header = buffer.slice(0, 5).toString("ascii");
  return header === "%PDF-";
}

/**
 * Extract all text from a pdfkit-generated PDF buffer by decoding
 * hex-encoded text strings (inside <> delimiters).
 * pdfkit stores text as hex-encoded PDF strings, often split with
 * kerning adjustments (e.g., <54> 120 <72> for "Tr" with kerning).
 */
function extractPdfText(buffer: Buffer): string {
  const bufStr = buffer.toString("latin1");
  const results: string[] = [];

  // Find all hex strings inside <> delimiters (e.g., <34322e3530>)
  const hexRegex = /<([0-9a-fA-F]+)>/g;
  let match: RegExpExecArray | null;

  while ((match = hexRegex.exec(bufStr)) !== null) {
    try {
      const hex = match[1].toLowerCase();
      const decoded = Buffer.from(hex, "hex").toString("utf8");
      if (decoded) {
        results.push(decoded);
      }
    } catch {
      // Skip invalid hex
    }
  }

  return results.join("");
}

/**
 * Search for text within a pdfkit-generated PDF buffer.
 * Handles both plain text (metadata in PDF info dict) and
 * hex-encoded text in content streams.
 */
function pdfContains(buffer: Buffer, text: string): boolean {
  const bufStr = buffer.toString("latin1");

  // Check plain text (PDF info dict metadata is not hex-encoded)
  if (bufStr.toLowerCase().includes(text.toLowerCase())) {
    return true;
  }

  // Extract and decode all hex-encoded text from content streams
  const extractedText = extractPdfText(buffer);
  return extractedText.toLowerCase().includes(text.toLowerCase());
}

// ─── Tests ────────────────────────────────────────────────────

async function runTests() {
  console.log("\n🧪 Exports PDF Module — API Integration Tests\n");
  console.log(`Test user: ${TEST_EMAIL}\n`);

  // ─── 0. Health Check ───────────────────────────────────────
  console.log("─── 0. Health Check ───");
  const health = await request("GET", "/health");
  assert(health.status === 200, "Health endpoint returns 200");

  // ─── 1. Register User & Set Up Test Data ───────────────────
  console.log("\\n─── 1. Register & Create Test Data ───");
  const register = await request("POST", "/auth/register", {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    name: "PDF Export Tester",
  });
  assert(register.status === 201, "Register returns 201");
  const registerJson = JSON.parse(register.text);
  userTokens = registerJson.data?.tokens as { accessToken: string; refreshToken: string };
  assert(userTokens != null, "Register returns tokens");

  // Get default categories
  const defaultCats = await request("GET", "/categories", undefined, userTokens?.accessToken);
  assert(defaultCats.status === 200, "Default categories fetched");
  const catsJson = JSON.parse(defaultCats.text);
  const cats = catsJson.data?.categories as Array<Record<string, unknown>> | undefined;

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
  const pmJson = JSON.parse(pm.text);
  testPaymentMethodId =
    ((pmJson.data?.paymentMethod as Record<string, unknown>)?.id as string) ?? null;
  assert(testPaymentMethodId != null, "Payment method has ID");

  // Create transactions
  const today = new Date().toISOString().slice(0, 10);

  const tx1 = await request(
    "POST",
    "/transactions",
    {
      type: "EXPENSE",
      amount: 42.5,
      description: "Whole Foods Market",
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

  // ─── 2. Export Transactions as PDF ─────────────────────────
  console.log("\n─── 2. Export Transactions (GET /exports/transactions?format=pdf) ───");

  const pdfTx = await request(
    "GET",
    "/exports/transactions?format=pdf",
    undefined,
    userTokens?.accessToken,
  );
  assert(pdfTx.status === 200, "Export transactions PDF returns 200");
  assert(pdfTx.contentType.includes("application/pdf"), "Content-Type is application/pdf");
  assert(pdfTx.buffer != null && pdfTx.buffer.length > 0, "PDF buffer is not empty");
  assert(isPdfSignature(pdfTx.buffer!), "PDF starts with %PDF- signature");
  assert(pdfContains(pdfTx.buffer!, "42.50"), "PDF contains expense amount 42.50");
  assert(pdfContains(pdfTx.buffer!, "5,000.00"), "PDF contains income amount 5,000.00");
  assert(pdfContains(pdfTx.buffer!, "Whole Foods Market"), "PDF contains transaction description");
  assert(pdfContains(pdfTx.buffer!, "Monthly Paycheck"), "PDF contains income description");
  assert(pdfContains(pdfTx.buffer!, "Transaction Export"), "PDF has report title");
  assert(pdfContains(pdfTx.buffer!, "Expense Tracker Pro"), "PDF has app name");
  assert(pdfContains(pdfTx.buffer!, TEST_EMAIL), "PDF contains user email");

  // ─── 3. Export Transactions as CSV (default format) ────────
  console.log("\n─── 3. Export Transactions as CSV (default format) ───");

  const csvTx = await request("GET", "/exports/transactions", undefined, userTokens?.accessToken);
  assert(csvTx.status === 200, "Export transactions CSV returns 200");
  assert(csvTx.contentType.includes("text/csv"), "Default format is CSV");

  // ─── 4. Export Report - Daily (PDF) ────────────────────────
  console.log("\n─── 4. Export Daily Report (GET /exports/reports?type=daily&format=pdf) ───");

  const dailyPdf = await request(
    "GET",
    `/exports/reports?type=daily&format=pdf&date=${today}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(dailyPdf.status === 200, "Export daily report PDF returns 200");
  assert(dailyPdf.contentType.includes("application/pdf"), "Daily report PDF content type");
  assert(isPdfSignature(dailyPdf.buffer!), "Daily report PDF has valid signature");
  assert(pdfContains(dailyPdf.buffer!, "Daily Financial Report"), "Daily PDF has report title");
  assert(pdfContains(dailyPdf.buffer!, "Expense Tracker Pro"), "Daily PDF has app name");
  assert(pdfContains(dailyPdf.buffer!, "42.50"), "Daily PDF contains expense");
  assert(pdfContains(dailyPdf.buffer!, "5,000.00"), "Daily PDF contains income");
  assert(pdfContains(dailyPdf.buffer!, "Whole Foods Market"), "Daily PDF contains transaction");
  assert(pdfContains(dailyPdf.buffer!, "Financial Summary"), "Daily PDF has summary section");
  assert(pdfContains(dailyPdf.buffer!, "Spending by Category"), "Daily PDF has category section");

  // ─── 5. Export Report - Weekly (PDF) ───────────────────────
  console.log("\n─── 5. Export Weekly Report (GET /exports/reports?type=weekly&format=pdf) ───");

  const weeklyPdf = await request(
    "GET",
    `/exports/reports?type=weekly&format=pdf&date=${today}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(weeklyPdf.status === 200, "Export weekly report PDF returns 200");
  assert(isPdfSignature(weeklyPdf.buffer!), "Weekly report PDF has valid signature");
  assert(pdfContains(weeklyPdf.buffer!, "Weekly Financial Report"), "Weekly PDF has report title");
  assert(
    pdfContains(weeklyPdf.buffer!, "Daily Breakdown"),
    "Weekly PDF has daily breakdown section",
  );
  assert(pdfContains(weeklyPdf.buffer!, "Financial Summary"), "Weekly PDF has summary");

  // ─── 6. Export Report - Monthly (PDF) ──────────────────────
  console.log("\n─── 6. Export Monthly Report (GET /exports/reports?type=monthly&format=pdf) ───");

  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = String(now.getMonth() + 1).padStart(2, "0");

  const monthlyPdf = await request(
    "GET",
    `/exports/reports?type=monthly&format=pdf&year=${thisYear}&month=${thisMonth}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(monthlyPdf.status === 200, "Export monthly report PDF returns 200");
  assert(isPdfSignature(monthlyPdf.buffer!), "Monthly report PDF has valid signature");
  assert(
    pdfContains(monthlyPdf.buffer!, "Monthly Financial Report"),
    "Monthly PDF has report title",
  );
  assert(pdfContains(monthlyPdf.buffer!, "Financial Summary"), "Monthly PDF has summary");
  assert(pdfContains(monthlyPdf.buffer!, "Category Breakdown"), "Monthly PDF has category section");
  assert(
    pdfContains(monthlyPdf.buffer!, "Payment Method Summary"),
    "Monthly PDF has payment method section",
  );

  // ─── 7. Export Report - Yearly (PDF) ───────────────────────
  console.log("\n─── 7. Export Yearly Report (GET /exports/reports?type=yearly&format=pdf) ───");

  const yearlyPdf = await request(
    "GET",
    `/exports/reports?type=yearly&format=pdf&year=${thisYear}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(yearlyPdf.status === 200, "Export yearly report PDF returns 200");
  assert(isPdfSignature(yearlyPdf.buffer!), "Yearly report PDF has valid signature");
  assert(pdfContains(yearlyPdf.buffer!, "Yearly Financial Report"), "Yearly PDF has report title");
  assert(pdfContains(yearlyPdf.buffer!, "Monthly Comparison"), "Yearly PDF has monthly comparison");
  assert(pdfContains(yearlyPdf.buffer!, "Category Breakdown"), "Yearly PDF has category section");

  // ─── 8. Export Report - Summary (PDF) ──────────────────────
  console.log("\n─── 8. Export Summary Report (GET /exports/reports?type=summary&format=pdf) ───");

  const summaryPdf = await request(
    "GET",
    "/exports/reports?type=summary&format=pdf",
    undefined,
    userTokens?.accessToken,
  );
  assert(summaryPdf.status === 200, "Export summary PDF returns 200");
  assert(isPdfSignature(summaryPdf.buffer!), "Summary PDF has valid signature");
  assert(pdfContains(summaryPdf.buffer!, "Financial Report Summary"), "Summary PDF has title");
  assert(pdfContains(summaryPdf.buffer!, "5,000.00"), "Summary PDF contains income");
  assert(pdfContains(summaryPdf.buffer!, "Detailed Summary"), "Summary PDF has detailed section");

  // ─── 9. Export Report - Breakdown (PDF) ────────────────────
  console.log(
    "\n─── 9. Export Breakdown Report (GET /exports/reports?type=breakdown&format=pdf) ───",
  );

  const breakdownPdf = await request(
    "GET",
    "/exports/reports?type=breakdown&format=pdf",
    undefined,
    userTokens?.accessToken,
  );
  assert(breakdownPdf.status === 200, "Export breakdown PDF returns 200");
  assert(isPdfSignature(breakdownPdf.buffer!), "Breakdown PDF has valid signature");
  assert(
    pdfContains(breakdownPdf.buffer!, "Financial Report Breakdown"),
    "Breakdown PDF has title",
  );
  assert(
    pdfContains(breakdownPdf.buffer!, "Income vs Expense"),
    "Breakdown PDF has income/expense section",
  );
  assert(
    pdfContains(breakdownPdf.buffer!, "Category Breakdown"),
    "Breakdown PDF has category section",
  );
  assert(
    pdfContains(breakdownPdf.buffer!, "Payment Method Summary"),
    "Breakdown PDF has payment method section",
  );
  assert(
    pdfContains(breakdownPdf.buffer!, "Largest Transaction"),
    "Breakdown PDF has largest transaction",
  );
  assert(
    pdfContains(breakdownPdf.buffer!, "Smallest Transaction"),
    "Breakdown PDF has smallest transaction",
  );
  assert(
    pdfContains(breakdownPdf.buffer!, "Whole Foods Market"),
    "Breakdown PDF contains transaction",
  );

  // ─── 10. Reports as CSV still works ────────────────────────
  console.log("\n─── 10. CSV export still works ───");

  const csvDaily = await request(
    "GET",
    `/exports/reports?type=daily&date=${today}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(csvDaily.status === 200, "CSV daily report still works");
  assert(csvDaily.contentType.includes("text/csv"), "CSV daily has text/csv content type");

  const csvSummary = await request(
    "GET",
    `/exports/reports?type=summary`,
    undefined,
    userTokens?.accessToken,
  );
  assert(csvSummary.status === 200, "CSV summary still works");
  assert(csvSummary.contentType.includes("text/csv"), "CSV summary has text/csv content type");

  // ─── 11. Ownership Scoping ─────────────────────────────────
  console.log("\n─── 11. Ownership Verification ───");

  const register2 = await request("POST", "/auth/register", {
    email: `pdf-test-2-${Date.now()}@example.com`,
    password: TEST_PASSWORD,
    name: "Second PDF User",
  });
  assert(register2.status === 201, "Second user registered");
  const register2Json = JSON.parse(register2.text);
  const secondTokens = register2Json.data?.tokens as { accessToken: string; refreshToken: string };

  // Second user's PDF export has no transactions
  const secondPdfTx = await request(
    "GET",
    "/exports/transactions?format=pdf",
    undefined,
    secondTokens?.accessToken,
  );
  assert(secondPdfTx.status === 200, "Second user PDF export returns 200");
  assert(isPdfSignature(secondPdfTx.buffer!), "Second user PDF has valid signature");
  // Should still have headers and app name but no transaction data
  assert(pdfContains(secondPdfTx.buffer!, "Transaction Export"), "Second user PDF has title");
  assert(
    !pdfContains(secondPdfTx.buffer!, "42.50"),
    "Second user PDF does not contain primary user data",
  );

  // Second user's summary PDF has zero amounts
  const secondSummary = await request(
    "GET",
    "/exports/reports?type=summary&format=pdf",
    undefined,
    secondTokens?.accessToken,
  );
  assert(secondSummary.status === 200, "Second user summary PDF returns 200");
  assert(pdfContains(secondSummary.buffer!, "$0.00"), "Second user summary has $0.00");
  assert(
    !pdfContains(secondSummary.buffer!, "5,000.00"),
    "Second user summary does not have primary income",
  );

  // ─── 12. Validation ────────────────────────────────────────
  console.log("\n─── 12. Validation ───");

  // Invalid format
  const badFormat = await request(
    "GET",
    "/exports/transactions?format=excel",
    undefined,
    userTokens?.accessToken,
  );
  assert(badFormat.status === 400, "Invalid format returns 400");

  const badFormatReport = await request(
    "GET",
    "/exports/reports?type=summary&format=excel",
    undefined,
    userTokens?.accessToken,
  );
  assert(badFormatReport.status === 400, "Invalid format on report returns 400");

  // Invalid date
  const badDate = await request(
    "GET",
    "/exports/transactions?format=pdf&startDate=not-a-date",
    undefined,
    userTokens?.accessToken,
  );
  assert(badDate.status === 400, "Invalid date with PDF format returns 400");

  // ─── 13. Unauthenticated Access ────────────────────────────
  console.log("\n─── 13. Unauthenticated Access ───");

  const noAuthTx = await request("GET", "/exports/transactions?format=pdf");
  assert(noAuthTx.status === 401, "Export transactions PDF without auth returns 401");

  const noAuthReport = await request("GET", "/exports/reports?type=summary&format=pdf");
  assert(noAuthReport.status === 401, "Export report PDF without auth returns 401");

  // ─── 14. CSV Export Endpoints Still Work ───────────────────
  console.log("\n─── 14. CSV export endpoints still work without auth ───");

  // These should fail with 401 regardless of format
  const noAuthCsvTx = await request("GET", "/exports/transactions?format=csv");
  assert(noAuthCsvTx.status === 401, "CSV export without auth returns 401");

  const noAuthCsvReport = await request("GET", "/exports/reports?type=summary&format=csv");
  assert(noAuthCsvReport.status === 401, "CSV report without auth returns 401");

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
  server = app.listen(4010, async () => {
    console.log(`🧪 Test server running on port 4010`);
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
