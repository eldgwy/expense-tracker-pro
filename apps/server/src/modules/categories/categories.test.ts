/**
 * Categories Module — Full API Integration Tests
 *
 * Tests: create category, list categories, get by ID, update category,
 *        delete category (custom vs system), search, icon whitelist,
 *        color palette validation, ownership scoping, system protections.
 *
 * Run: npx tsx src/modules/categories/categories.test.ts
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
process.env.PORT = "4003";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-for-categories-integration-tests";
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

const BASE = "http://localhost:4003/api/v1";
const TEST_EMAIL = `cat-test-${Date.now()}@example.com`;
const TEST_PASSWORD = "Test@123456";
const SECOND_USER_EMAIL = `cat-test-2-${Date.now()}@example.com`;

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
  console.log("\n🧪 Categories Module — API Integration Tests\n");
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
    name: "Category Tester",
  });
  assert(register.status === 201, "Register returns 201");
  assert(register.json.data?.user != null, "Register returns user");
  assert(register.json.data?.tokens != null, "Register returns tokens");

  userTokens = register.json.data?.tokens as { accessToken: string; refreshToken: string };

  // ─── 2. Verify Default Categories Created ──────────────────
  console.log("\n─── 2. Default Categories (Auto-Created on Register) ───");
  const defaults = await request("GET", "/categories", undefined, userTokens?.accessToken);
  assert(defaults.status === 200, "List categories returns 200");
  assert(defaults.json.success === true, "List categories success=true");

  const defaultCats = defaults.json.data?.categories as Array<Record<string, unknown>> | undefined;
  assert(defaultCats != null, "Categories array exists");
  assert(
    defaultCats!.length >= 9,
    `At least 9 default categories created (got ${defaultCats!.length})`,
  );

  // Verify specific default categories are present
  const foodCat = defaultCats!.find((c) => c.name === "Food");
  assert(foodCat != null, 'Default "Food" category exists');
  assert(foodCat!.icon === "UtensilsCrossed", "Food category has UtensilsCrossed icon");
  assert(foodCat!.color === "#F59E0B", "Food category has color #F59E0B");
  assert(foodCat!.isSystem === true, "Default category is marked as system");

  const salaryCat = defaultCats!.find((c) => c.name === "Salary");
  assert(salaryCat != null, 'Default "Salary" category exists');
  assert(salaryCat!.icon === "Briefcase", "Salary category has Briefcase icon");
  assert(salaryCat!.color === "#22C55E", "Salary category has color #22C55E");

  const transportCat = defaultCats!.find((c) => c.name === "Transportation");
  assert(transportCat != null, 'Default "Transportation" category exists');

  // ─── 3. Create Custom Category ─────────────────────────────
  console.log("\n─── 3. Create Custom Category (POST /categories) ───");
  const created = await request(
    "POST",
    "/categories",
    { name: "Freelance Projects", icon: "Briefcase", color: "#6366F1" },
    userTokens?.accessToken,
  );
  assert(created.status === 201, "Create returns 201");
  assert(created.json.success === true, "Create success=true");
  const createdCat = created.json.data?.category as Record<string, unknown> | undefined;
  assert(createdCat != null, "Created category returned");
  assert(createdCat!.name === "Freelance Projects", "Category name matches");
  assert(createdCat!.icon === "Briefcase", "Category icon matches");
  assert(createdCat!.color === "#6366F1", "Category color matches");
  assert(createdCat!.isSystem === false, "Custom category isSystem=false");
  const createdId = createdCat!.id as string;
  assert(createdId != null, "Category has an ID");

  // ─── 4. Get Category By ID ─────────────────────────────────
  console.log("\n─── 4. Get Category By ID (GET /categories/:id) ───");
  const byId = await request("GET", `/categories/${createdId}`, undefined, userTokens?.accessToken);
  assert(byId.status === 200, "Get by ID returns 200");
  assert(byId.json.success === true, "Get by ID success=true");
  const fetchedCat = byId.json.data?.category as Record<string, unknown> | undefined;
  assert(fetchedCat != null, "Category returned");
  assert(fetchedCat!.id === createdId, "Category ID matches");
  assert(fetchedCat!.name === "Freelance Projects", "Category name matches");
  assert(fetchedCat!.transactionCount === 0, "New category has 0 transactions");
  assert(fetchedCat!.totalSpent === 0, "New category has 0 total spent");

  // ─── 5. Update Category ────────────────────────────────────
  console.log("\n─── 5. Update Category (PATCH /categories/:id) ───");

  // Update name and icon
  const updated = await request(
    "PATCH",
    `/categories/${createdId}`,
    { name: "Client Work", icon: "Cloud", color: "#3B82F6" },
    userTokens?.accessToken,
  );
  assert(updated.status === 200, "Update returns 200");
  assert(updated.json.success === true, "Update success=true");
  const updatedCat = updated.json.data?.category as Record<string, unknown> | undefined;
  assert(updatedCat != null, "Updated category returned");
  assert(updatedCat!.name === "Client Work", "Name updated");
  assert(updatedCat!.icon === "Cloud", "Icon updated");
  assert(updatedCat!.color === "#3B82F6", "Color updated");

  // Partial update — only name
  const partialUpdate = await request(
    "PATCH",
    `/categories/${createdId}`,
    { name: "Freelance Client Work" },
    userTokens?.accessToken,
  );
  assert(partialUpdate.status === 200, "Partial update returns 200");
  const partialCat = partialUpdate.json.data?.category as Record<string, unknown> | undefined;
  assert(partialCat!.name === "Freelance Client Work", "Partial name update");
  assert(partialCat!.icon === "Cloud", "Icon unchanged after partial update");
  assert(partialCat!.color === "#3B82F6", "Color unchanged after partial update");

  // ─── 6. Search Categories ──────────────────────────────────
  console.log("\n─── 6. Search Categories (GET /categories?q=...) ───");

  // Search by exact name fragment
  const searchFreelance = await request(
    "GET",
    "/categories?q=Freelance",
    undefined,
    userTokens?.accessToken,
  );
  assert(searchFreelance.status === 200, "Search returns 200");
  const freelanceResults = searchFreelance.json.data?.categories as
    Array<Record<string, unknown>> | undefined;
  assert(freelanceResults != null, "Search returns categories");
  assert(freelanceResults!.length >= 1, "Search found at least 1 category");
  const foundFreelance = freelanceResults!.find((c) => c.name === "Freelance Client Work");
  assert(foundFreelance != null, "Search found 'Freelance Client Work'");

  // Search by common word
  const searchFood = await request("GET", "/categories?q=ood", undefined, userTokens?.accessToken);
  assert(searchFood.status === 200, "Search 'ood' returns 200");
  const foodResults = searchFood.json.data?.categories as
    Array<Record<string, unknown>> | undefined;
  const foundFood = foodResults!.find((c) => c.name === "Food");
  assert(foundFood != null, "Search 'ood' found 'Food' category");

  // Search with no matches
  const searchNone = await request(
    "GET",
    "/categories?q=zzzznotfound",
    undefined,
    userTokens?.accessToken,
  );
  assert(searchNone.status === 200, "Search with no matches returns 200");
  const emptyResults = searchNone.json.data?.categories as
    Array<Record<string, unknown>> | undefined;
  assert(emptyResults!.length === 0, "Search with no matches returns empty array");

  // ─── 7. Icon Validation ────────────────────────────────────
  console.log("\n─── 7. Icon Validation (Whitelist Enforcement) ───");

  // Invalid icon should be rejected
  const invalidIcon = await request(
    "POST",
    "/categories",
    { name: "Bad Icon Cat", icon: "NonExistentIcon", color: "#6366F1" },
    userTokens?.accessToken,
  );
  assert(invalidIcon.status === 400, "Invalid icon returns 400");
  const iconError = invalidIcon.json;
  assert(iconError.success === false, "Invalid icon response success=false");
  assert(iconError.error != null, "Invalid icon returns error");

  // Valid icon should succeed (edge: last icon in list)
  const validIcon = await request(
    "POST",
    "/categories",
    { name: "Miscellaneous", icon: "MoreHorizontal", color: "#94A3B8" },
    userTokens?.accessToken,
  );
  assert(validIcon.status === 201, "Valid icon 'MoreHorizontal' returns 201");
  assert(validIcon.json.success === true, "Valid icon success=true");

  // ─── 8. Color Validation ───────────────────────────────────
  console.log("\n─── 8. Color Validation (Palette Enforcement) ───");

  // Invalid color format (not a hex color)
  const badColor = await request(
    "POST",
    "/categories",
    { name: "Bad Color Cat", icon: "Tag", color: "not-a-color" },
    userTokens?.accessToken,
  );
  assert(badColor.status === 400, "Invalid color format returns 400");
  assert(badColor.json.success === false, "Invalid color response success=false");

  // Valid hex but NOT in palette
  const nonPaletteColor = await request(
    "POST",
    "/categories",
    { name: "Non-Palette Cat", icon: "Tag", color: "#000000" },
    userTokens?.accessToken,
  );
  assert(nonPaletteColor.status === 400, "Non-palette color returns 400");
  assert(nonPaletteColor.json.success === false, "Non-palette color rejected");
  const colorDetails = nonPaletteColor.json.details;
  assert(colorDetails != null, "Validation error returns details");
  assert(colorDetails!.color != null, "Details has 'color' field");
  const colorMsg = colorDetails!.color.join(" ").toLowerCase();
  assert(
    colorMsg.includes("palette") || colorMsg.includes("suggested"),
    "Color validation mentions palette",
  );

  // Valid palette color should pass
  const validColor = await request(
    "POST",
    "/categories",
    { name: "Palette Color Cat", icon: "Heart", color: "#EC4899" },
    userTokens?.accessToken,
  );
  assert(validColor.status === 201, "Valid palette color returns 201");
  assert(validColor.json.success === true, "Valid palette color success=true");

  // ─── 9. Ownership Validation ───────────────────────────────
  console.log("\n─── 9. Ownership Scoping ───");

  // Register a second user
  const register2 = await request("POST", "/auth/register", {
    email: SECOND_USER_EMAIL,
    password: TEST_PASSWORD,
    name: "Second User",
  });
  assert(register2.status === 201, "Second user registered");
  secondUserTokens = register2.json.data?.tokens as { accessToken: string; refreshToken: string };

  // Second user's list should NOT include primary user's custom categories
  const secondUserCats = await request(
    "GET",
    "/categories",
    undefined,
    secondUserTokens?.accessToken,
  );
  assert(secondUserCats.status === 200, "Second user list returns 200");
  const secondCats = secondUserCats.json.data?.categories as
    Array<Record<string, unknown>> | undefined;
  const hasFreelance = secondCats!.some((c) => c.name === "Freelance Client Work");
  assert(!hasFreelance, "Second user cannot see primary user's custom categories");

  // Second user should NOT see primary user's non-default categories
  const hasMisc = secondCats!.some((c) => c.name === "Miscellaneous");
  assert(!hasMisc, "Second user cannot see primary user's 'Miscellaneous' category");

  // Second user CAN see their own default categories
  const secondFood = secondCats!.find((c) => c.name === "Food");
  assert(secondFood != null, "Second user has their own 'Food' default category");

  // Second user cannot get primary user's category by ID
  const forbiddenGet = await request(
    "GET",
    `/categories/${createdId}`,
    undefined,
    secondUserTokens?.accessToken,
  );
  assert(forbiddenGet.status === 404, "Second user cannot get primary's category (404)");

  // Second user cannot update primary user's category
  const forbiddenUpdate = await request(
    "PATCH",
    `/categories/${createdId}`,
    { name: "Hacked" },
    secondUserTokens?.accessToken,
  );
  assert(forbiddenUpdate.status === 404, "Second user cannot update primary's category (404)");

  // Second user cannot delete primary user's category
  const forbiddenDelete = await request(
    "DELETE",
    `/categories/${createdId}`,
    undefined,
    secondUserTokens?.accessToken,
  );
  assert(forbiddenDelete.status === 404, "Second user cannot delete primary's category (404)");

  // ─── 10. System Category Protections ───────────────────────
  console.log("\n─── 10. System Category Protections ───");

  // Get a system category ID
  const allCats = await request("GET", "/categories", undefined, userTokens?.accessToken);
  const cats = allCats.json.data?.categories as Array<Record<string, unknown>> | undefined;
  const systemCatId = cats!.find((c) => c.isSystem === true)?.id as string;

  // Cannot delete system category
  const deleteSystem = await request(
    "DELETE",
    `/categories/${systemCatId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(deleteSystem.status === 400, "Cannot delete system category (400)");
  assert(deleteSystem.json.success === false, "Delete system category fails");

  // Cannot rename system category
  const renameSystem = await request(
    "PATCH",
    `/categories/${systemCatId}`,
    { name: "Renamed System Cat" },
    userTokens?.accessToken,
  );
  assert(renameSystem.status === 400, "Cannot rename system category (400)");
  assert(renameSystem.json.success === false, "Rename system category fails");

  // Can update icon and color of system category (non-name fields)
  const updateSystemIcon = await request(
    "PATCH",
    `/categories/${systemCatId}`,
    { icon: "Heart", color: "#F43F5E" },
    userTokens?.accessToken,
  );
  assert(updateSystemIcon.status === 200, "Can update system category icon/color (200)");
  const sysUpdated = updateSystemIcon.json.data?.category as Record<string, unknown> | undefined;
  assert(sysUpdated != null, "System category update returns category");
  assert(sysUpdated!.name != null, "System category name unchanged");
  assert(sysUpdated!.isSystem === true, "Category remains system");

  // ─── 11. Delete Custom Category ────────────────────────────
  console.log("\n─── 11. Delete Custom Category (DELETE /categories/:id) ───");
  const toDelete = await request(
    "POST",
    "/categories",
    { name: "To Be Deleted", icon: "Tag", color: "#EF4444" },
    userTokens?.accessToken,
  );
  const deleteId = (toDelete.json.data?.category as Record<string, unknown>)?.id as string;
  assert(toDelete.status === 201, "Category created for deletion test");

  const deleted = await request(
    "DELETE",
    `/categories/${deleteId}`,
    undefined,
    userTokens?.accessToken,
  );
  assert(deleted.status === 204, "Delete returns 204 No Content");

  // Verify it's gone
  const gone = await request("GET", `/categories/${deleteId}`, undefined, userTokens?.accessToken);
  assert(gone.status === 404, "Deleted category returns 404");

  // ─── 12. Duplicate Name Prevention ─────────────────────────
  console.log("\n─── 12. Duplicate Name Prevention ───");
  const duplicate = await request(
    "POST",
    "/categories",
    { name: "Food", icon: "Tag", color: "#F59E0B" },
    userTokens?.accessToken,
  );
  assert(duplicate.status === 409, "Duplicate category name returns 409");

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
  server = app.listen(4003, async () => {
    console.log(`🧪 Test server running on port 4003`);
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
