import { jobsService } from "./jobs.service.js";
import { logger } from "../../config/logger.js";
import type { JobName, JobRunSummary } from "./jobs.types.js";

interface ScheduledJob {
  name: JobName;
  /** Milliseconds between runs. */
  intervalMs: number;
  /** Run the job immediately on startup (instead of waiting a full interval). */
  runOnStart?: boolean;
  run: () => Promise<JobRunSummary>;
}

/**
 * Default schedule (dependency-free — no cron library needed).
 * Intervals are intentionally conservative; the /jobs endpoints allow
 * manual on-demand runs too.
 */
export const DEFAULT_JOB_SCHEDULE: ScheduledJob[] = [
  {
    name: "check-budgets",
    intervalMs: 60 * 60 * 1000, // hourly
    runOnStart: true,
    run: () => jobsService.checkBudgets(),
  },
  {
    name: "process-reminders",
    intervalMs: 30 * 60 * 1000, // every 30 minutes
    runOnStart: true,
    run: () => jobsService.processReminders(),
  },
  {
    name: "detect-upcoming-bills",
    intervalMs: 6 * 60 * 60 * 1000, // every 6 hours
    runOnStart: true,
    run: () => jobsService.detectUpcomingBills(),
  },
  {
    name: "generate-monthly-summaries",
    intervalMs: 24 * 60 * 60 * 1000, // daily
    runOnStart: false,
    run: () => jobsService.generateMonthlySummaries(),
  },
  {
    name: "cleanup-notifications",
    intervalMs: 24 * 60 * 60 * 1000, // daily
    runOnStart: false,
    run: () => jobsService.cleanupNotifications(),
  },
];

let timers: NodeJS.Timeout[] = [];
let startupTimers: NodeJS.Timeout[] = [];
let started = false;
/** Guards against overlapping runs of the same job. */
const running = new Set<JobName>();

async function runJob(job: ScheduledJob, trigger: "startup" | "interval"): Promise<void> {
  if (running.has(job.name)) {
    logger.warn(`[jobs] ${job.name} still running — skipping this ${trigger} tick`);
    return;
  }

  running.add(job.name);
  const startedAt = Date.now();
  try {
    const summary = await job.run();
    logger.info(
      `[jobs] ${job.name} ${trigger} run finished in ${Date.now() - startedAt}ms — ` +
        `${summary.generated} notifications, ${summary.errors.length} errors`,
    );
  } catch (err) {
    logger.error(`[jobs] ${job.name} ${trigger} run failed:`, err);
  } finally {
    running.delete(job.name);
  }
}

/**
 * Start the background job scheduler.
 * Safe to call multiple times (idempotent).
 */
export function startJobsScheduler(): void {
  if (started) return;
  started = true;

  for (const job of DEFAULT_JOB_SCHEDULE) {
    if (job.runOnStart) {
      // Defer the first run so the server finishes booting cleanly.
      const startupTimer = setTimeout(() => {
        void runJob(job, "startup");
      }, 5_000);
      startupTimer.unref?.();
      startupTimers.push(startupTimer);
    }

    const timer = setInterval(() => {
      void runJob(job, "interval");
    }, job.intervalMs);
    // Don't keep the process alive purely for the scheduler.
    timer.unref?.();
    timers.push(timer);
  }

  logger.info(`[jobs] scheduler started with ${DEFAULT_JOB_SCHEDULE.length} jobs`);
}

/** Stop all scheduled jobs (used in tests / graceful shutdown). */
export function stopJobsScheduler(): void {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  for (const startupTimer of startupTimers) clearTimeout(startupTimer);
  startupTimers = [];
  started = false;
  running.clear();
  logger.info("[jobs] scheduler stopped");
}

/** True when the scheduler is currently running (for tests). */
export function isJobsSchedulerRunning(): boolean {
  return started;
}
