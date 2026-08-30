import { notificationRepository } from "./notifications.repository.js";
import { NotFoundError } from "../../common/errors/index.js";
import { paginate } from "../../common/utils/index.js";
import type { NotificationPreferences, NotificationPreferencesInput } from "./notifications.types.js";

export const notificationService = {
  /**
   * Get the authenticated user's notification preferences.
   */
  async getPreferences(userId: string): Promise<NotificationPreferences> {
    return notificationRepository.findPreferences(userId);
  },

  /**
   * Update the authenticated user's notification preferences (partial update).
   */
  async updatePreferences(
    userId: string,
    input: NotificationPreferencesInput,
  ): Promise<NotificationPreferences> {
    return notificationRepository.updatePreferences(userId, input);
  },

  async findAll(
    userId: string,
    filters: {
      page?: number;
      limit?: number;
      read?: boolean;
      type?: string;
    } = {},
  ) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const { skip, take } = paginate(page, limit);

    const { data, total } = await notificationRepository.findAllByUser(userId, {
      skip,
      take,
      read: filters.read,
      type: filters.type,
    });

    return { data, total, page, limit };
  },

  async findUnread(userId: string) {
    return notificationRepository.findUnreadByUser(userId);
  },

  async findById(userId: string, id: string) {
    const notification = await notificationRepository.findById(id);
    if (!notification || notification.userId !== userId) {
      throw new NotFoundError("Notification not found");
    }
    return notification;
  },

  async markAsRead(userId: string, id: string) {
    const notification = await notificationRepository.findById(id);
    if (!notification || notification.userId !== userId) {
      throw new NotFoundError("Notification not found");
    }
    return notificationRepository.markAsRead(id);
  },

  async markAllAsRead(userId: string) {
    return notificationRepository.markAllAsRead(userId);
  },

  async delete(userId: string, id: string) {
    const notification = await notificationRepository.findById(id);
    if (!notification || notification.userId !== userId) {
      throw new NotFoundError("Notification not found");
    }
    return notificationRepository.delete(id);
  },

  async getUnreadCount(userId: string) {
    return notificationRepository.countUnread(userId);
  },

  /**
   * Delete expired notifications for a user.
   * By default removes READ notifications older than `olderThanDays` (30).
   */
  async cleanupExpired(
    userId: string,
    options: { olderThanDays?: number; readOnly?: boolean } = {},
  ) {
    return notificationRepository.cleanupExpired({
      userId,
      olderThanDays: options.olderThanDays,
      readOnly: options.readOnly,
    });
  },
};
