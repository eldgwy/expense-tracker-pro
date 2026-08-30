import bcrypt from "bcrypt";
import jwt, { type SignOptions } from "jsonwebtoken";
import crypto from "node:crypto";
import { authRepository } from "./auth.repository.js";
import { categoryRepository } from "../categories/categories.repository.js";
import { paymentMethodRepository } from "../payment-methods/payment-methods.repository.js";
import { UnauthorizedError, ConflictError, ValidationError } from "../../common/errors/index.js";
import { env } from "../../config/env.js";
import { DEFAULT_CATEGORIES, DEFAULT_PAYMENT_METHODS } from "../../common/constants/index.js";
import type { AuthResponse, AuthTokens } from "./auth.types.js";
import type { JwtPayload } from "../../common/types/index.js";

// ─── Helpers ──────────────────────────────────────────────────

function generateTokens(payload: { id: string; email: string; tokenVersion: number }): AuthTokens {
  const jwtPayload = { sub: payload.id, email: payload.email, tokenVersion: payload.tokenVersion };

  const accessToken = jwt.sign(jwtPayload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as SignOptions);

  const refreshToken = jwt.sign(jwtPayload, env.JWT_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  } as SignOptions);

  return { accessToken, refreshToken };
}

function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

function toAuthResponse(user: {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  tokenVersion: number;
}): AuthResponse {
  const tokens = generateTokens({
    id: user.id,
    email: user.email,
    tokenVersion: user.tokenVersion,
  });
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
    },
    tokens,
  };
}

// ─── Public API ───────────────────────────────────────────────

export const authService = {
  // ─── Password Hashing (Step 7.5) ─────────────────────────
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  },

  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  },

  // ─── Register (Step 7.6) ─────────────────────────────────
  async register(input: {
    email: string;
    password: string;
    name?: string | null;
  }): Promise<AuthResponse> {
    const existing = await authRepository.findByEmail(input.email);
    if (existing) {
      throw new ConflictError("Email already registered");
    }

    const passwordHash = await authService.hashPassword(input.password);
    const user = await authRepository.create({
      email: input.email,
      passwordHash,
      name: input.name ?? null,
    });

    // Create default starter categories for the new user
    await categoryRepository.createDefaultCategories(user.id, DEFAULT_CATEGORIES);

    // Create default starter payment methods for the new user
    await paymentMethodRepository.createDefaultPaymentMethods(user.id, DEFAULT_PAYMENT_METHODS);

    return toAuthResponse(user);
  },

  // ─── Login (Step 7.7) ────────────────────────────────────
  async login(email: string, password: string): Promise<AuthResponse> {
    const user = await authRepository.findByEmail(email);
    if (!user) {
      throw new UnauthorizedError("Invalid email or password");
    }

    // Reject login for deactivated accounts
    if (!user.isActive) {
      throw new UnauthorizedError(
        "This account has been deactivated. Please contact support to reactivate your account.",
      );
    }

    const isValid = await authService.comparePassword(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError("Invalid email or password");
    }

    return toAuthResponse(user);
  },

  // ─── Refresh Token (Step 7.9) ────────────────────────────
  async refreshToken(token: string): Promise<AuthTokens> {
    const decoded = verifyToken(token);
    const user = await authRepository.findById(decoded.sub);
    if (!user) {
      throw new UnauthorizedError("Invalid refresh token");
    }

    // Reject refresh for deactivated accounts
    if (!user.isActive) {
      throw new UnauthorizedError(
        "This account has been deactivated. Please contact support to reactivate your account.",
      );
    }

    // Verify token version matches — invalid if password was changed after this token was issued
    if (decoded.tokenVersion !== user.tokenVersion) {
      throw new UnauthorizedError("Refresh token has been invalidated. Please log in again.");
    }

    // Generate new token pair (rotation)
    return generateTokens({ id: user.id, email: user.email, tokenVersion: user.tokenVersion });
  },

  // ─── Logout (Step 7.10) ──────────────────────────────────
  async logout(): Promise<{ message: string }> {
    // In a stateless JWT system, logout is handled client-side
    // by discarding the token. For enhanced security, a token
    // blacklist could be implemented here in the future.
    return { message: "Logged out successfully. Discard your tokens." };
  },

  // ─── Forgot Password (Step 7.11) ─────────────────────────
  async forgotPassword(email: string): Promise<{ message: string }> {
    const user = await authRepository.findByEmail(email);

    // Always return success to prevent email enumeration
    if (!user) {
      return { message: "If an account exists, a reset link has been sent." };
    }

    // Generate a secure random token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenHash = await bcrypt.hash(resetToken, 10);
    const resetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Store the hashed token and expiry
    await authRepository.storeResetToken(user.id, resetTokenHash, resetTokenExpiresAt);

    // In production, send this token via email (SMTP). Only log reset
    // tokens outside production so they never leak into production logs.
    if (env.NODE_ENV !== "production") {
      console.log(`\n🔐 Password reset token for ${email}: ${resetToken}\n`);
    }

    return { message: "If an account exists, a reset link has been sent." };
  },

  // ─── Reset Password (Step 7.12) ──────────────────────────
  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    // Find the user by their reset token (scan all users with active tokens)
    // In production, use a dedicated PasswordResetToken table for efficiency
    const user = await authRepository.findByResetToken(token);
    if (!user || !user.resetTokenExpiresAt) {
      throw new ValidationError("Invalid or expired reset token");
    }

    // Check expiry
    if (new Date() > user.resetTokenExpiresAt) {
      throw new ValidationError("Reset token has expired");
    }

    // Hash and update the password
    const passwordHash = await authService.hashPassword(newPassword);
    await authRepository.updatePassword(user.id, passwordHash);

    // Clear the reset token and invalidate all existing refresh tokens
    await authRepository.clearResetToken(user.id);
    await authRepository.incrementTokenVersion(user.id);

    return { message: "Password has been reset successfully." };
  },

  // ─── JWT Utilities ───────────────────────────────────────
  verifyToken,
  generateTokens,

  // ─── Current User (Step 7.15) ────────────────────────────
  async getProfile(userId: string) {
    const user = await authRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedError("User not found");
    }
    return user;
  },
};
