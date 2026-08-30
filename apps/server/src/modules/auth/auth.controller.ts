import type { Request, Response, NextFunction } from "express";
import { authService } from "./auth.service.js";
import { sendSuccess, sendCreated, sendMessage } from "../../common/responses/index.js";
import type { AuthenticatedRequest } from "../../common/types/index.js";
import { env } from "../../config/env.js";

// Helper to exclude sensitive fields only (password hash, reset tokens)
// notificationPreferences is a user preference and should be included.
function sanitizeUser(user: Record<string, unknown>) {
  const { passwordHash, resetTokenHash, resetTokenExpiresAt, ...safe } = user;
  return safe;
}

export const authController = {
  // ─── Register ────────────────────────────────────────────
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password, name } = req.body;
      const result = await authService.register({ email, password, name });
      sendCreated(res, result);
    } catch (err) {
      next(err);
    }
  },

  // ─── Login ───────────────────────────────────────────────
  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body;
      const result = await authService.login(email, password);

      // Set refresh token as httpOnly cookie for enhanced security
      const isProduction = env.NODE_ENV === "production";
      res.cookie("refreshToken", result.tokens.refreshToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "strict" : "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        path: "/api/v1/auth",
      });

      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  },

  // ─── Refresh Token ───────────────────────────────────────
  async refreshToken(req: Request, res: Response, next: NextFunction) {
    try {
      // Try cookie first, then body
      const token = req.cookies?.refreshToken ?? req.body?.refreshToken;
      if (!token) {
        return sendMessage(res, "Refresh token is required", 400);
      }
      const tokens = await authService.refreshToken(token);
      sendSuccess(res, { tokens });
    } catch (err) {
      next(err);
    }
  },

  // ─── Logout ──────────────────────────────────────────────
  async logout(_req: Request, res: Response, next: NextFunction) {
    try {
      // Clear the refresh token cookie
      res.clearCookie("refreshToken", { path: "/api/v1/auth" });
      const result = await authService.logout();
      sendMessage(res, result.message);
    } catch (err) {
      next(err);
    }
  },

  // ─── Forgot Password ─────────────────────────────────────
  async forgotPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const { email } = req.body;
      const result = await authService.forgotPassword(email);
      sendMessage(res, result.message);
    } catch (err) {
      next(err);
    }
  },

  // ─── Reset Password ──────────────────────────────────────
  async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const { token, password } = req.body;
      const result = await authService.resetPassword(token, password);
      sendMessage(res, result.message);
    } catch (err) {
      next(err);
    }
  },

  // ─── Get Current User (Step 7.15) ────────────────────────
  async getProfile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const user = await authService.getProfile(req.user.id);
      sendSuccess(res, { user: sanitizeUser(user) });
    } catch (err) {
      next(err);
    }
  },
};
