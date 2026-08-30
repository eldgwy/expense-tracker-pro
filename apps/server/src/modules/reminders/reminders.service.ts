import { reminderRepository } from "./reminders.repository.js";
import { notificationRepository } from "../notifications/notifications.repository.js";
import { NotFoundError, ValidationError } from "../../common/errors/index.js";
import { prisma } from "../../db/prisma.js";
import type {
  CreateReminderInput,
  UpdateReminderInput,
  ReminderQueryFilters,
} from "./reminders.types.js";
import type { ReminderFrequency } from "../../generated/prisma/client.js";

/** Convert a YYYY-MM-DD string to a UTC-midnight Date. */
function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Compute the next trigger date for a reminder based on its frequency and interval.
 * Advances from the given `from` date (inclusive of configured day-of-week/month).
 */
export function computeNextTriggerDate(
  from: Date,
  frequency: ReminderFrequency,
  interval: number,
  dayOfWeek?: number,
  dayOfMonth?: number,
): Date {
  const next = new Date(from);
  const step = Math.max(1, interval || 1);

  switch (frequency) {
    case "DAILY":
      next.setUTCDate(next.getUTCDate() + step);
      break;
    case "WEEKLY": {
      next.setUTCDate(next.getUTCDate() + step * 7);
      if (dayOfWeek !== undefined && dayOfWeek !== null) {
        // Align to the requested day of week (0=Sunday..6=Saturday)
        const daysAhead = (dayOfWeek - next.getUTCDay() + 7) % 7;
        next.setUTCDate(next.getUTCDate() + daysAhead);
      }
      break;
    }
    case "MONTHLY": {
      const originalDay = next.getUTCDate();
      const targetMonth = next.getUTCMonth() + step;
      const targetYear = next.getUTCFullYear() + Math.floor(targetMonth / 12);
      const month = ((targetMonth % 12) + 12) % 12;
      // Clamp to the last day of the target month to avoid JS date rollover
      // (e.g. Jan 31 + 1 month must land on Feb 28, not Mar 3).
      const lastDay = new Date(Date.UTC(targetYear, month + 1, 0)).getUTCDate();
      const targetDay = dayOfMonth !== undefined && dayOfMonth !== null ? dayOfMonth : originalDay;
      next.setUTCFullYear(targetYear, month, Math.min(targetDay, lastDay));
      break;
    }
    case "YEARLY": {
      const originalDay = next.getUTCDate();
      const targetYear = next.getUTCFullYear() + step;
      const lastDay = new Date(Date.UTC(targetYear, next.getUTCMonth() + 1, 0)).getUTCDate();
      const targetDay = dayOfMonth !== undefined && dayOfMonth !== null ? dayOfMonth : originalDay;
      next.setUTCFullYear(targetYear, next.getUTCMonth(), Math.min(targetDay, lastDay));
      break;
    }
  }

  return next;
}

/** Build a human-readable notification message for a triggered reminder. */
function buildReminderMessage(reminder: {
  type: string;
  title: string;
  amount?: number | null;
  message?: string | null;
  category?: { name: string } | null;
  savingsGoal?: { name: string } | null;
}): string {
  if (reminder.message) return reminder.message;

  const amountText = reminder.amount != null ? ` $${Number(reminder.amount).toFixed(2)}` : "";
  const context = reminder.category?.name ?? reminder.savingsGoal?.name ?? null;
  const contextText = context ? ` (${context})` : "";

  switch (reminder.type) {
    case "RECURRING_EXPENSE":
      return `Recurring expense due: ${reminder.title}${amountText}${contextText}.`;
    case "RECURRING_INCOME":
      return `Recurring income expected: ${reminder.title}${amountText}${contextText}.`;
    case "SAVINGS_CONTRIBUTION":
      return `Savings contribution due: ${reminder.title}${amountText}${contextText}.`;
    default:
      return `Reminder: ${reminder.title}.`;
  }
}

export const reminderService = {
  async findAll(userId: string, filters: ReminderQueryFilters = {}) {
    return reminderRepository.findAllByUser(userId, {
      type: filters.type as any,
      frequency: filters.frequency as any,
      enabled: filters.enabled,
      sortBy: filters.sortBy,
      sortOrder: filters.sortOrder,
    });
  },

  async findById(userId: string, id: string) {
    const reminder = await reminderRepository.findById(id);
    if (!reminder || reminder.userId !== userId) {
      throw new NotFoundError("Reminder not found");
    }
    return reminder;
  },

  async create(userId: string, data: CreateReminderInput) {
    // Validate linked entities belong to the user
    if (data.categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: data.categoryId, userId },
        select: { id: true },
      });
      if (!category) throw new ValidationError("Category not found");
    }
    if (data.savingsGoalId) {
      const goal = await prisma.savingsGoal.findFirst({
        where: { id: data.savingsGoalId, userId },
        select: { id: true },
      });
      if (!goal) throw new ValidationError("Savings goal not found");
    }

    const frequency = data.frequency ?? "MONTHLY";
    const interval = data.interval ?? 1;
    const startDate = parseDate(data.startDate);
    const nextTriggerDate = computeNextTriggerDate(
      startDate,
      frequency,
      interval,
      data.dayOfWeek,
      data.dayOfMonth,
    );

    return reminderRepository.create(userId, {
      type: data.type as any,
      title: data.title,
      message: data.message,
      amount: data.amount,
      frequency: frequency as any,
      interval,
      dayOfWeek: data.dayOfWeek,
      dayOfMonth: data.dayOfMonth,
      startDate,
      nextTriggerDate,
      enabled: data.enabled ?? true,
      categoryId: data.categoryId,
      savingsGoalId: data.savingsGoalId,
    });
  },

  async update(userId: string, id: string, data: UpdateReminderInput) {
    const existing = await reminderRepository.findById(id);
    if (!existing || existing.userId !== userId) {
      throw new NotFoundError("Reminder not found");
    }

    if (data.categoryId !== undefined) {
      if (data.categoryId === null) {
        // allow clearing
      } else {
        const category = await prisma.category.findFirst({
          where: { id: data.categoryId, userId },
          select: { id: true },
        });
        if (!category) throw new ValidationError("Category not found");
      }
    }
    if (data.savingsGoalId !== undefined) {
      if (data.savingsGoalId === null) {
        // allow clearing
      } else {
        const goal = await prisma.savingsGoal.findFirst({
          where: { id: data.savingsGoalId, userId },
          select: { id: true },
        });
        if (!goal) throw new ValidationError("Savings goal not found");
      }
    }

    // Build update payload with proper conversions
    const updateData: Record<string, unknown> = {};
    if (data.type !== undefined) updateData.type = data.type;
    if (data.title !== undefined) updateData.title = data.title;
    if (data.message !== undefined) updateData.message = data.message;
    if (data.amount !== undefined) updateData.amount = data.amount;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;
    if (data.dayOfWeek !== undefined) updateData.dayOfWeek = data.dayOfWeek;
    if (data.dayOfMonth !== undefined) updateData.dayOfMonth = data.dayOfMonth;
    if (data.categoryId !== undefined) updateData.categoryId = data.categoryId;
    if (data.savingsGoalId !== undefined) updateData.savingsGoalId = data.savingsGoalId;

    // If a scheduling field changed, recompute the next trigger date
    const scheduleChanged =
      data.frequency !== undefined ||
      data.interval !== undefined ||
      data.dayOfWeek !== undefined ||
      data.dayOfMonth !== undefined ||
      data.startDate !== undefined;

    if (scheduleChanged) {
      const frequency = (data.frequency ?? existing.frequency) as ReminderFrequency;
      const interval = data.interval ?? existing.interval;
      const baseDate = data.startDate ? parseDate(data.startDate) : existing.startDate;
      const dayOfWeek = data.dayOfWeek !== undefined ? data.dayOfWeek : existing.dayOfWeek;
      const dayOfMonth = data.dayOfMonth !== undefined ? data.dayOfMonth : existing.dayOfMonth;
      updateData.frequency = frequency;
      updateData.interval = interval;
      updateData.startDate = baseDate;
      // Only reschedule if the reminder hasn't fired past the new start
      const from = data.startDate ? baseDate : existing.nextTriggerDate;
      updateData.nextTriggerDate = computeNextTriggerDate(
        from,
        frequency,
        interval,
        dayOfWeek ?? undefined,
        dayOfMonth ?? undefined,
      );
    }

    return reminderRepository.update(id, updateData);
  },

  async delete(userId: string, id: string) {
    const reminder = await reminderRepository.findById(id);
    if (!reminder || reminder.userId !== userId) {
      throw new NotFoundError("Reminder not found");
    }
    return reminderRepository.delete(id);
  },

  /**
   * Detect upcoming/overdue bills for a user (recurring-expense reminders).
   * Creates BILL_DUE_SOON / BILL_OVERDUE notifications within the given window.
   * Respects notification preferences and de-duplicates within a 24h window.
   * Notifications are BATCHED into a single createMany call and carry a stable
   * dedupKey (per bill + day), so concurrent runs can't double-notify.
   */
  async detectUpcomingBills(userId: string, options: { windowDays?: number } = {}) {
    const windowDays = options.windowDays ?? 7;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setUTCDate(horizon.getUTCDate() + windowDays);

    const prefs = await notificationRepository.findPreferences(userId);
    const notificationsDisabled = prefs.enabled === false || prefs.channels?.inApp === false;

    const bills = await reminderRepository.findUpcomingBills(userId, horizon);

    // Dedup: skip bills already notified within the last 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await notificationRepository.findRecentByTypes(
      userId,
      ["BILL_DUE_SOON", "BILL_OVERDUE"],
      since,
    );
    const recentTitles = new Set(recent.map((n) => n.title));

    const detected: Array<Record<string, unknown>> = [];
    const toCreate: Array<{
      type: string;
      title: string;
      message: string;
      dedupKey: string;
    }> = [];
    let suppressedByPreferences = false;

    for (const bill of bills) {
      const isOverdue = bill.nextTriggerDate < today;
      const daysUntil = isOverdue
        ? -Math.max(
            1,
            Math.ceil((today.getTime() - bill.nextTriggerDate.getTime()) / (1000 * 60 * 60 * 24)),
          )
        : Math.max(
            0,
            Math.ceil((bill.nextTriggerDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
          );

      const title = isOverdue ? `Overdue Bill: ${bill.title}` : `Bill Due Soon: ${bill.title}`;

      if (notificationsDisabled) {
        suppressedByPreferences = true;
        detected.push({
          id: bill.id,
          title: bill.title,
          daysUntil,
          overdue: isOverdue,
          suppressed: true,
        });
        continue;
      }

      if (recentTitles.has(title)) {
        detected.push({
          id: bill.id,
          title: bill.title,
          daysUntil,
          overdue: isOverdue,
          deduplicated: true,
        });
        continue;
      }

      const amountText = bill.amount != null ? ` $${Number(bill.amount).toFixed(2)}` : "";
      const context = bill.category?.name ? ` (${bill.category.name})` : "";
      const message = isOverdue
        ? `Your bill "${bill.title}"${amountText}${context} was due ${Math.abs(daysUntil)} day(s) ago.`
        : `Your bill "${bill.title}"${amountText}${context} is due in ${daysUntil} day(s).`;

      toCreate.push({
        type: isOverdue ? "BILL_OVERDUE" : "BILL_DUE_SOON",
        title,
        message,
        // One notification per bill per day (prevents duplicate alerts).
        dedupKey: `bill:${bill.id}:${today.toISOString().slice(0, 10)}`,
      });

      detected.push({ id: bill.id, title: bill.title, daysUntil, overdue: isOverdue });
      recentTitles.add(title);
    }

    // Single batched insert; duplicates are skipped at the DB level.
    let generated = 0;
    if (toCreate.length > 0) {
      const result = await notificationRepository.createMany(userId, toCreate);
      generated = result.count;
    }

    return { generated, detected, suppressedByPreferences, windowDays };
  },

  /**
   * Trigger all due reminders for a user:
   * creates a REMINDER notification for each and advances the next trigger date.
   * Respects notification preferences (global enabled toggle + in-app channel).
   * Runs inside a transaction, guards against concurrent double-triggers, and
   * BATCHES the notification inserts into a single createManyAndReturn call.
   */
  async triggerDue(userId: string) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const prefs = await notificationRepository.findPreferences(userId);
    const notificationsDisabled = prefs.enabled === false || prefs.channels?.inApp === false;

    const due = await reminderRepository.findDueByUser(userId, today);

    const triggered: Array<Record<string, unknown>> = [];
    let suppressedByPreferences = false;

    await prisma.$transaction(async (tx) => {
      // First pass: advance schedules atomically (guards against double-fires).
      const toNotify: Array<{ reminder: (typeof due)[number]; message: string }> = [];
      for (const reminder of due) {
        const next = computeNextTriggerDate(
          reminder.nextTriggerDate,
          reminder.frequency,
          reminder.interval,
          reminder.dayOfWeek ?? undefined,
          reminder.dayOfMonth ?? undefined,
        );

        // Atomic guard: only advance if this reminder is still due, so
        // concurrent trigger calls cannot double-fire the same reminder.
        const advanced = await tx.reminder.updateMany({
          where: { id: reminder.id, nextTriggerDate: reminder.nextTriggerDate },
          data: { nextTriggerDate: next, lastTriggeredAt: new Date() },
        });
        if (advanced.count === 0) continue; // already handled by a concurrent request

        if (notificationsDisabled) {
          // Still advance the schedule so we don't re-trigger on the next run
          suppressedByPreferences = true;
          triggered.push({ id: reminder.id, title: reminder.title, suppressed: true });
          continue;
        }

        toNotify.push({ reminder, message: buildReminderMessage(reminder) });
      }

      // Second pass: batch-insert all notifications in one query.
      if (toNotify.length > 0) {
        const notifications = await tx.notification.createManyAndReturn({
          data: toNotify.map(({ reminder, message }) => ({
            type: "REMINDER" as any,
            title: reminder.title,
            message,
            userId,
            // One notification per reminder per trigger date.
            dedupKey: `reminder:${reminder.id}:${today.toISOString().slice(0, 10)}`,
          })),
        });

        notifications.forEach((notification, index) => {
          triggered.push({
            id: toNotify[index].reminder.id,
            title: notification.title,
            notificationId: notification.id,
          });
        });
      }
    });

    return { generated: triggered.length, triggered, suppressedByPreferences };
  },
};
