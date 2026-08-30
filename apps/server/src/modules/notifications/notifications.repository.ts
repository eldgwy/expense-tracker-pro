import { prisma } from "../../db/prisma.js";
import type { NotificationPreferences, NotificationPreferencesInput } from "./notifications.types.js";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "./notifications.types.js";

export const notificationRepository = {
  /**
   * Get the user's notification preferences.
   * Returns defaults if the stored JSON is malformed or empty.
   */
  async findPreferences(userId: string): Promise<NotificationPreferences> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { notificationPreferences: true },
    });

    if (!user) {
      return { ...DEFAULT_NOTIFICATION_PREFERENCES };
    }

    // Merge stored preferences with defaults to fill in any missing fields
    const stored = user.notificationPreferences as Record<string, unknown>;
    return {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...stored,
      channels: {
        ...DEFAULT_NOTIFICATION_PREFERENCES.channels,
        ...((stored?.channels as Record<string, unknown>) ?? {}),
      },
    } as NotificationPreferences;
  },

  /**
   * Update the user's notification preferences (partial update — merges with existing).
   * Returns the updated preferences.
   */
  async updatePreferences(
    userId: string,
    input: NotificationPreferencesInput,
  ): Promise<NotificationPreferences> {
    // Get current preferences first
    const current = await this.findPreferences(userId);

    // Deep merge the channels object if provided
    const merged: NotificationPreferences = {
      ...current,
      ...input,
      channels: {
        ...current.channels,
        ...(input.channels ?? {}),
      },
    };

    await prisma.user.update({
      where: { id: userId },
      data: { notificationPreferences: merged as any },
    });

    return merged;
  },

  async findAllByUser(
    userId: string,
    options: {
      skip?: number;
      take?: number;
      read?: boolean;
      type?: string;
    } = {},
  ) {
    const where: Record<string, unknown> = { userId };
    if (options.read !== undefined) where.read = options.read;
    if (options.type) where.type = options.type;

    const [data, total] = await Promise.all([
      prisma.notification.findMany({
        where: where as any,
        orderBy: { createdAt: "desc" },
        skip: options.skip ?? 0,
        take: options.take ?? 20,
      }),
      prisma.notification.count({ where: where as any }),
    ]);

    return { data, total };
  },

  async findUnreadByUser(userId: string) {
    return prisma.notification.findMany({
      where: { userId, read: false },
      orderBy: { createdAt: "desc" },
    });
  },

  async findById(id: string) {
    return prisma.notification.findUnique({ where: { id } });
  },

  async create(
    userId: string,
    data: {
      type: string;
      title: string;
      message: string;
      dedupKey?: string | null;
    },
  ) {
    return prisma.notification.create({
      data: {
        type: data.type as any,
        title: data.title,
        message: data.message,
        userId,
        dedupKey: data.dedupKey ?? null,
      },
    });
  },

  /**
   * Batch-insert many notifications for a user in a single query.
   * Rows whose (userId, dedupKey) already exist are skipped (skipDuplicates),
   * so callers can generate alerts concurrently without duplicate notifications.
   */
  async createMany(
    userId: string,
    items: Array<{
      type: string;
      title: string;
      message: string;
      dedupKey?: string | null;
    }>,
  ) {
    if (items.length === 0) return { count: 0 };
    return prisma.notification.createMany({
      data: items.map((item) => ({
        type: item.type as any,
        title: item.title,
        message: item.message,
        userId,
        dedupKey: item.dedupKey ?? null,
      })),
      skipDuplicates: true,
    });
  },

  /**
   * Delete expired notifications (default: read notifications older than 30 days).
   * Used by the background cleanup job to keep the notifications table lean.
   */
  async cleanupExpired(
    options: {
      userId?: string;
      olderThanDays?: number;
      readOnly?: boolean;
    } = {},
  ) {
    const olderThanDays = options.olderThanDays ?? 30;
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

    const where: Record<string, unknown> = { createdAt: { lt: cutoff } };
    if (options.userId) where.userId = options.userId;
    if (options.readOnly !== false) where.read = true;

    const result = await prisma.notification.deleteMany({ where: where as any });
    return { count: result.count, cutoff, olderThanDays };
  },

  async markAsRead(id: string) {
    return prisma.notification.update({
      where: { id },
      data: { read: true },
    });
  },

  async markAllAsRead(userId: string) {
    return prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  },

  async delete(id: string) {
    return prisma.notification.delete({ where: { id } });
  },

  async countUnread(userId: string) {
    return prisma.notification.count({
      where: { userId, read: false },
    });
  },

  /**
   * Find recent notifications for a user matching given types within a time window.
   * Used for deduplication of auto-generated alerts. Selects both `type` and
   * `title` so callers can dedup per-notification (e.g. per-bill titles).
   */
  async findRecentByTypes(userId: string, types: string[], since: Date) {
    return prisma.notification.findMany({
      where: {
        userId,
        type: { in: types as any },
        createdAt: { gte: since },
      },
      select: { type: true, title: true },
    });
  },
};
