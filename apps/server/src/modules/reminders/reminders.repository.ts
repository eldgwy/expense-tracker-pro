import { prisma } from "../../db/prisma.js";
import type { ReminderType, ReminderFrequency } from "../../generated/prisma/client.js";

export interface ReminderFilters {
  type?: ReminderType;
  frequency?: ReminderFrequency;
  enabled?: boolean;
  sortBy?: "createdAt" | "startDate" | "nextTriggerDate" | "title";
  sortOrder?: "asc" | "desc";
}

export const reminderRepository = {
  async findAllByUser(userId: string, filters: ReminderFilters = {}) {
    const where: Record<string, unknown> = { userId };
    if (filters.type) where.type = filters.type;
    if (filters.frequency) where.frequency = filters.frequency;
    if (filters.enabled !== undefined) where.enabled = filters.enabled;

    const orderBy =
      filters.sortBy === "title"
        ? { title: (filters.sortOrder ?? "desc") as "asc" | "desc" }
        : { [filters.sortBy ?? "createdAt"]: (filters.sortOrder ?? "desc") as "asc" | "desc" };

    return prisma.reminder.findMany({
      where: where as any,
      orderBy,
      include: {
        category: { select: { id: true, name: true, icon: true, color: true } },
        savingsGoal: { select: { id: true, name: true, targetAmount: true, currentAmount: true } },
      },
    });
  },

  async findById(id: string) {
    return prisma.reminder.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true, icon: true, color: true } },
        savingsGoal: { select: { id: true, name: true, targetAmount: true, currentAmount: true } },
      },
    });
  },

  async findDueByUser(userId: string, date: Date) {
    return prisma.reminder.findMany({
      where: { userId, enabled: true, nextTriggerDate: { lte: date } },
      include: {
        category: { select: { id: true, name: true, icon: true, color: true } },
        savingsGoal: { select: { id: true, name: true, targetAmount: true, currentAmount: true } },
      },
    });
  },

  /**
   * Find recurring-expense reminders (bills) that are overdue or due soon:
   * any enabled bill whose next trigger is on or before `end` (the horizon).
   */
  async findUpcomingBills(userId: string, end: Date) {
    return prisma.reminder.findMany({
      where: {
        userId,
        enabled: true,
        type: "RECURRING_EXPENSE",
        nextTriggerDate: { lte: end },
      },
      include: {
        category: { select: { id: true, name: true, icon: true, color: true } },
        savingsGoal: { select: { id: true, name: true, targetAmount: true, currentAmount: true } },
      },
      orderBy: { nextTriggerDate: "asc" },
    });
  },

  async create(
    userId: string,
    data: {
      type: ReminderType;
      title: string;
      message?: string;
      amount?: number;
      frequency?: ReminderFrequency;
      interval?: number;
      dayOfWeek?: number;
      dayOfMonth?: number;
      startDate: Date;
      nextTriggerDate: Date;
      enabled?: boolean;
      categoryId?: string;
      savingsGoalId?: string;
    },
  ) {
    return prisma.reminder.create({
      data: { ...data, userId } as any,
      include: {
        category: { select: { id: true, name: true, icon: true, color: true } },
        savingsGoal: { select: { id: true, name: true, targetAmount: true, currentAmount: true } },
      },
    });
  },

  async update(id: string, data: Record<string, unknown>) {
    return prisma.reminder.update({
      where: { id },
      data: data as any,
      include: {
        category: { select: { id: true, name: true, icon: true, color: true } },
        savingsGoal: { select: { id: true, name: true, targetAmount: true, currentAmount: true } },
      },
    });
  },

  async delete(id: string) {
    return prisma.reminder.delete({ where: { id } });
  },
};
