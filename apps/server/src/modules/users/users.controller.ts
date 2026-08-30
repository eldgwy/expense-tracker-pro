import type { Response, NextFunction } from "express";
import { userService } from "./users.service.js";
import { sendSuccess, sendNoContent, sendMessage } from "../../common/responses/index.js";
import type { AuthenticatedRequest } from "../../common/types/index.js";
import { getAvatarUrl } from "../../common/utils/upload.js";

/**
 * Strip sensitive/internal fields from the user object before sending to client.
 */
function sanitizeUser(user: Record<string, unknown>) {
  const { passwordHash, resetTokenHash, resetTokenExpiresAt, ...safe } = user;
  return safe;
}

export const userController = {
  /**
   * GET /api/v1/users/me
   * Returns the authenticated user's profile (sensitive fields excluded).
   */
  async getProfile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const user = await userService.getProfile(req.user.id);
      sendSuccess(res, { user: sanitizeUser(user as Record<string, unknown>) });
    } catch (err) {
      next(err);
    }
  },

  /**
   * PATCH /api/v1/users/me
   * Updates the authenticated user's profile fields.
   */
  async updateProfile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const user = await userService.updateProfile(req.user.id, req.body);
      sendSuccess(res, { user: sanitizeUser(user as Record<string, unknown>) });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/users/me/avatar
   * Uploads a new avatar image for the authenticated user.
   */
  async uploadAvatar(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        return sendMessage(res, "No file uploaded", 400);
      }

      const avatarUrl = getAvatarUrl(req.file.filename);
      const user = await userService.uploadAvatar(req.user.id, avatarUrl);

      sendSuccess(res, { user: sanitizeUser(user as Record<string, unknown>), avatarUrl });
    } catch (err) {
      next(err);
    }
  },

  /**
   * DELETE /api/v1/users/me/avatar
   * Removes the authenticated user's avatar.
   */
  async removeAvatar(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const user = await userService.removeAvatar(req.user.id);
      sendSuccess(res, { user: sanitizeUser(user as Record<string, unknown>) });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/users/me/password
   * Updates the authenticated user's password (requires current password verification).
   */
  async updatePassword(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { currentPassword, newPassword } = req.body;
      await userService.updatePassword(req.user.id, currentPassword, newPassword);
      sendMessage(res, "Password updated successfully");
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/users/me/deactivate
   * Soft-deactivates the authenticated user's account. Data is preserved but login is blocked.
   * Requires password confirmation.
   */
  async deactivateAccount(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { password } = req.body;
      await userService.deactivateAccount(req.user.id, password);
      sendMessage(res, "Account deactivated successfully. You can reactivate by logging in again.");
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/users/me/reactivate
   * Reactivates a deactivated account (allows login again).
   */
  async reactivateAccount(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const user = await userService.reactivateAccount(req.user.id);
      sendSuccess(res, { user: sanitizeUser(user as Record<string, unknown>) });
    } catch (err) {
      next(err);
    }
  },

  /**
   * DELETE /api/v1/users/me
   * Permanently deletes the authenticated user's account and all associated data.
   * Requires password confirmation.
   */
  async deleteAccount(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { password } = req.body;
      await userService.deleteAccount(req.user.id, password);
      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  },
};
