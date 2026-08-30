import bcrypt from "bcrypt";
import { prisma } from "../../db/prisma.js";

export const authRepository = {
  async findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  },

  async findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  },

  async create(data: { email: string; passwordHash: string; name?: string | null }) {
    return prisma.user.create({ data });
  },

  async updatePassword(id: string, passwordHash: string) {
    return prisma.user.update({
      where: { id },
      data: { passwordHash },
    });
  },

  async verifyEmail(id: string) {
    return prisma.user.update({
      where: { id },
      data: { emailVerified: true },
    });
  },

  // ─── Password Reset ──────────────────────────────────────
  async storeResetToken(id: string, tokenHash: string, expiresAt: Date) {
    return prisma.user.update({
      where: { id },
      data: {
        resetTokenHash: tokenHash,
        resetTokenExpiresAt: expiresAt,
      },
    });
  },

  async findByResetToken(token: string) {
    // Find all users with non-null resetTokenHash and check against bcrypt
    // In production, use a dedicated PasswordResetToken table for efficiency
    const users = await prisma.user.findMany({
      where: {
        resetTokenHash: { not: null },
        resetTokenExpiresAt: { gte: new Date() },
      },
    });

    // Find user by matching the raw token against the stored hash
    for (const user of users) {
      if (!user.resetTokenHash) continue;
      const isValid = await bcrypt.compare(token, user.resetTokenHash);
      if (isValid) return user;
    }
    return null;
  },

  async clearResetToken(id: string) {
    return prisma.user.update({
      where: { id },
      data: {
        resetTokenHash: null,
        resetTokenExpiresAt: null,
      },
    });
  },

  async incrementTokenVersion(id: string) {
    return prisma.user.update({
      where: { id },
      data: { tokenVersion: { increment: 1 } },
    });
  },
};
