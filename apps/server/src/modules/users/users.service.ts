import bcrypt from "bcrypt";
import { userRepository } from "./users.repository.js";
import { NotFoundError, UnauthorizedError, ConflictError } from "../../common/errors/index.js";
import { Prisma } from "../../generated/prisma/client.js";
import { deleteAvatarFile } from "../../common/utils/upload.js";

export const userService = {
  async getProfile(userId: string) {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }
    return user;
  },

  async updateProfile(userId: string, data: Prisma.UserUpdateInput) {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    try {
      return await userRepository.update(userId, data);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const target = (err.meta?.target as string[]) ?? [];
        if (target.includes("username")) {
          throw new ConflictError("Username already taken");
        }
        if (target.includes("email")) {
          throw new ConflictError("Email already in use");
        }
      }
      throw err;
    }
  },

  async uploadAvatar(userId: string, avatarUrl: string) {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    // Delete old avatar file from disk if it exists
    if (user.avatarUrl) {
      const oldFilename = user.avatarUrl.split("/").pop();
      if (oldFilename) {
        await deleteAvatarFile(oldFilename);
      }
    }

    return userRepository.update(userId, { avatarUrl });
  },

  async removeAvatar(userId: string) {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    // Delete the avatar file from disk
    if (user.avatarUrl) {
      const filename = user.avatarUrl.split("/").pop();
      if (filename) {
        await deleteAvatarFile(filename);
      }
    }

    return userRepository.update(userId, { avatarUrl: null });
  },

  async updatePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError("Current password is incorrect");
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Increment tokenVersion to invalidate all existing refresh tokens —
    // any refresh token issued before this password change will have a
    // stale tokenVersion and be rejected.
    return userRepository.update(userId, {
      passwordHash,
      tokenVersion: { increment: 1 },
    });
  },

  /**
   * Soft-deactivates the account. Data is preserved but login is blocked.
   */
  async deactivateAccount(userId: string, password: string) {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError("Password is incorrect");
    }

    return userRepository.update(userId, {
      isActive: false,
      deactivatedAt: new Date(),
    });
  },

  /**
   * Reactivates a deactivated account.
   */
  async reactivateAccount(userId: string) {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    return userRepository.update(userId, {
      isActive: true,
      deactivatedAt: null,
    });
  },

  /**
   * Permanently deletes the account and all associated data.
   * Requires password confirmation.
   */
  async deleteAccount(userId: string, password: string) {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError("Password is incorrect");
    }

    return userRepository.delete(userId);
  },
};
