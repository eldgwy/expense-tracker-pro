import { prisma } from "../../db/prisma.js";
import { budgetService } from "../budgets/budgets.service.js";
import { reminderService } from "../reminders/reminders.service.js";
import { monthlySummaryService } from "../notifications/monthly-summary.service.js";
import { notificationRepository } from "../notifications/notifications.repository.js";
import { logger } from "../../config/logger.js";
import type { JobName, JobRunSummary } from "./jobs.types.js";

/**
 * Maximum number of users processed concurrently by a fan-out job.
 * Bounded concurrency keeps memory/connection usage predictable while still
 * parallelizing across many users (vs. a strictly sequential loop).
 */
const FANOUT_CONCURRENCY = 8;

/** Get every registered user id (used to fan out system-wide jobs). */
async function getAllUserIds(): Promise<string[]> {
  const users = await prisma.user.findMany({ select: { id: true } });
  return users.map((u) => u.id);
}

/** Previous calendar month (consistent with the monthly-summary default). */
function previousMonth(): { year: number; month: number } {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/**
 * Run a per-user task across all users, collecting per-user results and
 * isolating failures so one user's error doesn't abort the whole job.
 * Users are processed in bounded-concurrency batches for throughput.
 */
async function runForAllUsers(
  job: JobName,
  task: (userId: string) => Promise<{ generated?: number; suppressedByPreferences?: boolean }>,
): Promise<JobRunSummary> {
  const userIds = await getAllUserIds();
  const results: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  let generated = 0;
  let suppressed = 0;

  for (let i = 0; i < userIds.length; i += FANOUT_CONCURRENCY) {
    const batch = userIds.slice(i, i + FANOUT_CONCURRENCY);
    const batchOutcomes = await Promise.all(
      batch.map(async (userId) => {
        try {
          const outcome = await task(userId);
          return { userId, outcome, error: null as string | null };
        } catch (err) {
          return {
            userId,
            outcome: null,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );

    for (const { userId, outcome, error } of batchOutcomes) {
      if (error) {
        errors.push(`user:${userId} -> ${error}`);
        results.push({ userId, error });
        continue;
      }
      generated += outcome!.generated ?? 0;
      if (outcome!.suppressedByPreferences) suppressed += 1;
      results.push({
        userId,
        generated: outcome!.generated ?? 0,
        suppressedByPreferences: outcome!.suppressedByPreferences ?? false,
      });
    }
  }

  return { job, users: userIds.length, generated, suppressed, errors, results };
}

export const jobsService = {
  /**
   * Scan all budgets for warning/exceeded/expired events and generate alerts.
   */
  async checkBudgets(): Promise<JobRunSummary> {
    logger.info("[jobs] checkBudgets started");
    const summary = await runForAllUsers("check-budgets", (userId) =>
      budgetService.generateAlerts(userId),
    );
    logger.info(`[jobs] checkBudgets done: ${summary.generated} notifications`);
    return summary;
  },

  /**
   * Trigger all due recurring reminders for every user.
   */
  async processReminders(): Promise<JobRunSummary> {
    logger.info("[jobs] processReminders started");
    const summary = await runForAllUsers("process-reminders", (userId) =>
      reminderService.triggerDue(userId),
    );
    logger.info(`[jobs] processReminders done: ${summary.generated} notifications`);
    return summary;
  },

  /**
   * Detect upcoming/overdue bills (recurring-expense reminders) within the
   * configured window and notify users.
   */
  async detectUpcomingBills(windowDays = 7): Promise<JobRunSummary> {
    logger.info(`[jobs] detectUpcomingBills started (window=${windowDays}d)`);
    const summary = await runForAllUsers("detect-upcoming-bills", (userId) =>
      reminderService.detectUpcomingBills(userId, { windowDays }),
    );
    logger.info(`[jobs] detectUpcomingBills done: ${summary.generated} notifications`);
    return summary;
  },

  /**
   * Generate a month's summary notification for every user.
   * Defaults individually to the previous calendar month when not provided.
   */
  async generateMonthlySummaries(year?: number, month?: number): Promise<JobRunSummary> {
    logger.info("[jobs] generateMonthlySummaries started");
    const { year: prevYear, month: prevMonth } = previousMonth();
    const y = year ?? prevYear;
    const m = month ?? prevMonth;
    const summary = await runForAllUsers("generate-monthly-summaries", (userId) =>
      monthlySummaryService.generate(userId, y, m),
    );
    logger.info(`[jobs] generateMonthlySummaries done: ${summary.generated} notifications`);
    return summary;
  },

  /**
   * Delete expired notifications (default: read notifications older than
   * `retentionDays`, 30 by default) to keep the notifications table lean.
   */
  async cleanupNotifications(retentionDays = 30): Promise<JobRunSummary> {
    logger.info(`[jobs] cleanupNotifications started (retention=${retentionDays}d)`);
    const result = await notificationRepository.cleanupExpired({
      olderThanDays: retentionDays,
    });
    const summary: JobRunSummary = {
      job: "cleanup-notifications",
      users: 0,
      generated: result.count,
      suppressed: 0,
      errors: [],
      results: [
        { deleted: result.count, olderThanDays: result.olderThanDays, cutoff: result.cutoff },
      ],
    };
    logger.info(`[jobs] cleanupNotifications done: ${result.count} notifications removed`);
    return summary;
  },

  /**
   * Run a single job by name (name validated upstream).
   * Optional per-job options: windowDays (bills), year/month (summaries),
   * retentionDays (cleanup).
   */
  async run(
    name: JobName,
    options: { windowDays?: number; year?: number; month?: number; retentionDays?: number } = {},
  ): Promise<JobRunSummary> {
    switch (name) {
      case "check-budgets":
        return this.checkBudgets();
      case "process-reminders":
        return this.processReminders();
      case "detect-upcoming-bills":
        return this.detectUpcomingBills(options.windowDays);
      case "generate-monthly-summaries":
        return this.generateMonthlySummaries(options.year, options.month);
      case "cleanup-notifications":
        return this.cleanupNotifications(options.retentionDays);
    }
  },

  /** Run every registered job sequentially and return the combined results. */
  async runAll() {
    const results: Record<JobName, JobRunSummary> = {
      "check-budgets": await this.checkBudgets(),
      "process-reminders": await this.processReminders(),
      "detect-upcoming-bills": await this.detectUpcomingBills(),
      "generate-monthly-summaries": await this.generateMonthlySummaries(),
      "cleanup-notifications": await this.cleanupNotifications(),
    };
    const totalGenerated = Object.values(results).reduce((sum, r) => sum + r.generated, 0);
    const totalErrors = Object.values(results).reduce((sum, r) => sum + r.errors.length, 0);
    return { results, totalGenerated, totalErrors };
  },
};
