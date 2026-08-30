/**
 * User Module — Full API Integration Tests
 *
 * Tests: view profile, update profile, change password, update preferences,
 *        deactivate account (login rejection), delete account (with password).
 *
 * Run: npx tsx src/modules/users/users.test.ts
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
process.env.PORT = "4002";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-for-integration-tests";
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

const BASE = "http://localhost:4002/api/v1";
const TEST_EMAIL = `user-test-${Date.now()}@example.com`;
const TEST_PASSWORD = "Test@123456";
const TEST_NEW_PASSWORD = "NewPass@789";

interface ApiResult {
  success: boolean;
  data?: Record<string, unknown>;
  message?: string;
  error?: string;
  statusCode?: number;
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
  console.log("\n🧪 User Module — API Integration Tests\n");
  console.log(`Test user: ${TEST_EMAIL}\n`);

  // ─── 0. Health Check ───────────────────────────────────────
  console.log("─── 0. Health Check ───");
  const health = await request("GET", "/health");
  assert(health.status === 200, "Health endpoint returns 200");
  assert(health.json.success === true, "Health response success=true");

  // ─── 1. Register ───────────────────────────────────────────
  console.log("\n─── 1. Register User ───");
  const register = await request("POST", "/auth/register", {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    name: "Test User",
  });
  assert(register.status === 201, "Register returns 201");
  assert(register.json.success === true, "Register success=true");
  assert(register.json.data?.user != null, "Register returns user");
  assert(register.json.data?.tokens != null, "Register returns tokens");

  userTokens = register.json.data?.tokens as { accessToken: string; refreshToken: string };

  // ─── 2. View Profile ───────────────────────────────────────
  console.log("\n─── 2. View Profile (GET /users/me) ───");
  const profile = await request("GET", "/users/me", undefined, userTokens?.accessToken);
  assert(profile.status === 200, "Profile returns 200");
  assert(profile.json.data?.user != null, "Profile returns user object");
  const profileUser = profile.json.data?.user as Record<string, unknown> | undefined;
  assert(profileUser?.email === TEST_EMAIL, "Profile has correct email");
  assert(profileUser?.passwordHash == null, "Profile hides passwordHash");
  assert(profileUser?.resetTokenHash == null, "Profile hides resetTokenHash");

  // ─── 3. Update Profile ─────────────────────────────────────
  console.log("\n─── 3. Update Profile (PATCH /users/me) ───");
  const updated = await request(
    "PATCH",
    "/users/me",
    {
      firstName: "Updated",
      lastName: "User",
      username: `testuser-${Date.now()}`,
      bio: "Integration test user",
    },
    userTokens?.accessToken,
  );
  assert(updated.status === 200, "Update profile returns 200");
  const updatedUser = updated.json.data?.user as Record<string, unknown> | undefined;
  assert(updatedUser?.firstName === "Updated", "Profile firstName updated");
  assert(updatedUser?.lastName === "User", "Profile lastName updated");
  assert(updatedUser?.bio === "Integration test user", "Profile bio updated");

  // ─── 4. Update Preferences ─────────────────────────────────
  console.log("\n─── 4. Update Preferences (PATCH /users/me) ───");
  const prefs = await request(
    "PATCH",
    "/users/me",
    {
      theme: "light",
      timeZone: "America/New_York",
      currency: "EUR",
      language: "en-GB",
      dateFormat: "DD/MM/YYYY",
      notificationPreferences: {
        budgetAlerts: false,
        emailWarnings: true,
        weeklyDigest: true,
      },
    },
    userTokens?.accessToken,
  );
  assert(prefs.status === 200, "Update preferences returns 200");
  const prefsUser = prefs.json.data?.user as Record<string, unknown> | undefined;
  assert(prefsUser?.theme === "light", "Theme updated to light");
  assert(prefsUser?.timeZone === "America/New_York", "TimeZone updated");
  assert(prefsUser?.currency === "EUR", "Currency updated to EUR");
  assert(prefsUser?.language === "en-GB", "Language updated");

  // ─── 3b. Upload Avatar ────────────────────────────────────
  console.log("\n─── 3b. Upload Avatar (POST /users/me/avatar) ───");

  // Create a tiny 1x1 red PNG pixel for the test
  function createTestPng(): Buffer {
    // Minimal valid PNG (1x1 red pixel)
    const png = Buffer.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a, // PNG signature
      0x00,
      0x00,
      0x00,
      0x0d,
      0x49,
      0x48,
      0x44,
      0x52, // IHDR chunk
      0x00,
      0x00,
      0x00,
      0x01,
      0x00,
      0x00,
      0x00,
      0x01, // 1x1 pixel
      0x08,
      0x02,
      0x00,
      0x00,
      0x00,
      0x90,
      0x77,
      0x53, // 8-bit RGBA
      0xde,
      0x00,
      0x00,
      0x00,
      0x0c,
      0x49,
      0x44,
      0x41, // IDAT chunk
      0x54,
      0x08,
      0xd7,
      0x63,
      0xf8,
      0xcf,
      0xc0,
      0x00,
      0x00,
      0x00,
      0x03,
      0x00,
      0x01,
      0x36,
      0x28,
      0x19, // end IDAT
      0x00,
      0x00,
      0x00,
      0x00,
      0x49,
      0x45,
      0x4e,
      0x44, // IEND chunk
      0xae,
      0x42,
      0x60,
      0x82,
    ]);
    return png;
  }

  const avatarBlob = new Blob([createTestPng()], { type: "image/png" });
  const formData = new FormData();
  formData.append("avatar", avatarBlob, "test-avatar.png");

  const avatarUploadRes = await fetch(`${BASE}/users/me/avatar`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userTokens?.accessToken ?? ""}`,
    },
    body: formData,
  });
  assert(avatarUploadRes.status === 200, "Upload avatar returns 200");
  let avatarJson: ApiResult = { success: false };
  try {
    avatarJson = (await avatarUploadRes.json()) as ApiResult;
  } catch {
    /* ignore */
  }
  assert(avatarJson.success === true, "Upload success=true");
  const avatarUser = avatarJson.data?.user as Record<string, unknown> | undefined;
  const uploadedUrl = avatarUser?.avatarUrl as string | undefined;
  assert(uploadedUrl != null && String(uploadedUrl).length > 0, "Upload returns avatarUrl");

  // ─── 3c. Remove Avatar ────────────────────────────────────
  console.log("\n─── 3c. Remove Avatar (DELETE /users/me/avatar) ───");
  const removeAvatarRes = await request(
    "DELETE",
    "/users/me/avatar",
    undefined,
    userTokens?.accessToken,
  );
  assert(removeAvatarRes.status === 200, "Remove avatar returns 200");
  const removedUser = removeAvatarRes.json.data?.user as Record<string, unknown> | undefined;
  assert(
    removedUser?.avatarUrl == null || removedUser?.avatarUrl === "",
    "Avatar removed (user.avatarUrl is null)",
  );

  // ─── 5. Change Password ────────────────────────────────────
  console.log("\n─── 5. Change Password (POST /users/me/password) ───");
  const changePw = await request(
    "POST",
    "/users/me/password",
    { currentPassword: TEST_PASSWORD, newPassword: TEST_NEW_PASSWORD },
    userTokens?.accessToken,
  );
  assert(changePw.status === 200, "Change password returns 200");
  assert(
    changePw.json.message === "Password updated successfully",
    "Password changed successfully",
  );

  // Login with new password to verify
  const loginNew = await request("POST", "/auth/login", {
    email: TEST_EMAIL,
    password: TEST_NEW_PASSWORD,
  });
  assert(loginNew.status === 200, "Login with new password succeeds");
  userTokens = loginNew.json.data?.tokens as { accessToken: string; refreshToken: string };

  // Verify old password fails
  const loginOld = await request("POST", "/auth/login", {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  assert(loginOld.status === 401, "Old password login rejected (401)");
  assert(loginOld.json.error != null, "Old password returns error");

  // ─── 6. Deactivate Account ─────────────────────────────────
  console.log("\n─── 6. Deactivate Account (POST /users/me/deactivate) ───");

  // Wrong password should be rejected
  const deactivateBadPw = await request(
    "POST",
    "/users/me/deactivate",
    { password: "wrong-password" },
    userTokens?.accessToken,
  );
  assert(deactivateBadPw.status === 401, "Deactivate with wrong password rejected (401)");

  // Correct password deactivates
  const deactivate = await request(
    "POST",
    "/users/me/deactivate",
    { password: TEST_NEW_PASSWORD },
    userTokens?.accessToken,
  );
  assert(deactivate.status === 200, "Deactivate returns 200");
  assert(
    String(deactivate.json.message ?? "").includes("deactivated"),
    "Deactivation confirmation message",
  );

  // ─── 7. Deactivated User Cannot Login ──────────────────────
  console.log("\n─── 7. Deactivated Login Rejection ───");
  const loginDeactivated = await request("POST", "/auth/login", {
    email: TEST_EMAIL,
    password: TEST_NEW_PASSWORD,
  });
  assert(loginDeactivated.status === 401, "Deactivated user login rejected (401)");
  assert(
    String(loginDeactivated.json.message ?? "").includes("deactivated"),
    "Login error mentions deactivation",
  );

  // ─── 8. Reactivate Account ─────────────────────────────────
  console.log("\n─── 8. Reactivate Account (POST /users/me/reactivate) ───");

  // Use the access token that was issued before deactivation (still valid within expiry window)
  const reactivate = await request(
    "POST",
    "/users/me/reactivate",
    undefined,
    userTokens?.accessToken,
  );
  assert(reactivate.status === 200, "Reactivate returns 200");
  const reactivatedUser = reactivate.json.data?.user as Record<string, unknown> | undefined;
  assert(reactivatedUser?.isActive !== false, "User is now active");

  // Verify login works again
  const loginAfterReactivate = await request("POST", "/auth/login", {
    email: TEST_EMAIL,
    password: TEST_NEW_PASSWORD,
  });
  assert(loginAfterReactivate.status === 200, "Login works after reactivation");
  userTokens = loginAfterReactivate.json.data?.tokens as {
    accessToken: string;
    refreshToken: string;
  };

  // ─── 9. Delete Account (with password confirmation) ────────
  console.log("\n─── 9. Delete Account (DELETE /users/me with password) ───");

  // Wrong password should be rejected
  const deleteBadPw = await request(
    "DELETE",
    "/users/me",
    { password: "wrong-password" },
    userTokens?.accessToken,
  );
  assert(deleteBadPw.status === 401, "Delete with wrong password rejected (401)");

  // Correct password deletes
  const del = await request(
    "DELETE",
    "/users/me",
    { password: TEST_NEW_PASSWORD },
    userTokens?.accessToken,
  );
  assert(del.status === 204, "Delete returns 204 No Content");

  // Verify account is gone
  const loginDeleted = await request("POST", "/auth/login", {
    email: TEST_EMAIL,
    password: TEST_NEW_PASSWORD,
  });
  assert(loginDeleted.status === 401, "Deleted user login rejected (401)");

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
  server = app.listen(4002, async () => {
    console.log(`🧪 Test server running on port 4002`);
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
