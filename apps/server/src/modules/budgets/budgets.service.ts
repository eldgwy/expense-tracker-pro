import {
  budgetRepository,
  computePeriodEnd,
  computeSpending,
  computeDaysRemaining,
} from "./budgets.repository.js";
import { categoryRepository } from "../categories/categories.repository.js";
import { notificationRepository } from "../notifications/notifications.repository.js";
import { NotFoundError, ConflictError, ValidationError } from "../../common/errors/index.js";
import type { BudgetQueryFilters } from "./budgets.types.js";

// ─── Constants ────────────────────────────────────────────────

/** Number of days before expiry to trigger an upcoming-expiration alert. */
const EXPIRATION_WARNING_DAYS = 3;

/** Hours within which duplicate notifications of the same type are suppressed. */
const DEDUP_WINDOW_HOURS = 24;

export const budgetService = {
  async findAll(userId: string, filters: BudgetQueryFilters = {}) {
    return budgetRepository.findAllByUser(userId, {
      period: filters.period,
      status: filters.status,
      startDate: filters.startDate ? new Date(filters.startDate) : undefined,
      endDate: filters.endDate ? new Date(filters.endDate) : undefined,
      sortBy: filters.sortBy,
      sortOrder: filters.sortOrder,
    });
  },

  async findById(userId: string, id: string) {
    const budgetWithDetails = await budgetRepository.getBudgetWithProgress(userId, id);
    if (!budgetWithDetails) {
      throw new NotFoundError("Budget not found");
    }
    return budgetWithDetails;
  },

  async getProgress(userId: string, id: string) {
    const budgetWithProgress = await budgetRepository.getBudgetWithProgress(userId, id);
    if (!budgetWithProgress) {
      throw new NotFoundError("Budget not found");
    }
    return budgetWithProgress;
  },

  async getProgressSummary(userId: string) {
    return budgetRepository.getProgressSummary(userId);
  },

  async getAlerts(userId: string) {
    return budgetRepository.getAlerts(userId);
  },

  /**
   * Scan all user budgets and generate persistent notification records
   * for budget almost-exhausted, exceeded, expired, and upcoming-expiration events.
   * Duplicate notifications within DEDUP_WINDOW_HOURS are suppressed.
   */
  async getInsights(userId: string) {
    return budgetRepository.getInsights(userId);
  },

  /**
   * Generate persistent notification records for budget events (warning threshold,
   * over-budget, expiring soon, period ended).
   *
   * Respects the user's notification preferences:
   * - `enabled` — global toggle (skips everything when disabled)
   * - `budgetAlerts` — gates BUDGET_WARNING notifications
   * - `budgetCriticalAlerts` — gates BUDGET_CRITICAL notifications
   * - `channels.inApp` — gates in-app notification creation
   *
   * Notifications are BATCHED into a single createMany call (instead of N
   * sequential inserts) and carry a stable dedupKey per budget+event, so the
   * unique (userId, dedupKey) constraint prevents duplicates even when this
   * runs concurrently (e.g. via the background jobs scheduler).
   */
  async generateAlerts(userId: string) {
    const budgets = await budgetRepository.findAllByUser(userId);
    if (budgets.length === 0) {
      return { generated: 0, alerts: [] };
    }

    // Respect the user's notification preferences
    const prefs = await notificationRepository.findPreferences(userId);
    const notificationsDisabled = prefs.enabled === false || prefs.channels?.inApp === false;

    // When notifications are globally disabled, report the scan result without creating any
    if (notificationsDisabled) {
      return { generated: 0, alerts: [], suppressedByPreferences: true };
    }

    const now = new Date();
    const generated: Array<{ type: string; budgetId: string; categoryName: string }> = [];
    const toCreate: Array<{
      type: string;
      title: string;
      message: string;
      dedupKey: string;
    }> = [];

    // In-memory gate: only one alert per type per 24h window (mirrors the
    // historical dedup semantics). The DB unique (userId, dedupKey) constraint
    // adds a second layer so concurrent runs can't double-insert either.
    const recentNotifications = await notificationRepository.findRecentByTypes(
      userId,
      ["BUDGET_WARNING", "BUDGET_CRITICAL"],
      new Date(now.getTime() - DEDUP_WINDOW_HOURS * 60 * 60 * 1000),
    );
    const recentAlertTypes = new Set(recentNotifications.map((n) => n.type));

    for (const budget of budgets) {
      const category = budget.category;
      const categoryName = category?.name ?? "Unknown";
      const end = computePeriodEnd(budget.startDate, budget.period);
      const spent = await computeSpending(userId, budget.categoryId, budget.startDate, end);
      const progress =
        budget.targetAmount > 0 ? Math.round((spent / budget.targetAmount) * 100) : 0;
      const daysRemaining = computeDaysRemaining(budget.startDate, end);
      const isExpired = now > end;
      const isActive = now >= budget.startDate && now <= end;

      // 1. Budget almost exhausted (warning threshold reached, < 100%)
      if (
        isActive &&
        progress >= budget.alertThreshold &&
        progress < 100 &&
        prefs.budgetAlerts !== false
      ) {
        if (!recentAlertTypes.has("BUDGET_WARNING")) {
          toCreate.push({
            type: "BUDGET_WARNING",
            title: `Budget Almost Exhausted: ${categoryName}`,
            message: `You've used ${progress}% of your $${budget.targetAmount} budget for ${categoryName}. $${Math.max(0, budget.targetAmount - spent)} remaining (${daysRemaining} days left).`,
            dedupKey: `budget:${budget.id}:almost-exhausted`,
          });
          generated.push({ type: "BUDGET_WARNING", budgetId: budget.id, categoryName });
          recentAlertTypes.add("BUDGET_WARNING");
        }
      }

      // 2. Budget exceeded (spent > targetAmount)
      if (spent > budget.targetAmount && prefs.budgetCriticalAlerts !== false) {
        const overBy = spent - budget.targetAmount;
        if (!recentAlertTypes.has("BUDGET_CRITICAL")) {
          toCreate.push({
            type: "BUDGET_CRITICAL",
            title: `Budget Exceeded: ${categoryName}`,
            message: `You've exceeded your $${budget.targetAmount} budget for ${categoryName} by $${overBy.toFixed(2)} (${progress}% of limit used).`,
            dedupKey: `budget:${budget.id}:exceeded`,
          });
          generated.push({ type: "BUDGET_CRITICAL", budgetId: budget.id, categoryName });
          recentAlertTypes.add("BUDGET_CRITICAL");
        }
      }

      // 3. Budget expired (period ended)
      if (isExpired && !isActive && prefs.budgetAlerts !== false) {
        if (!recentAlertTypes.has("BUDGET_WARNING")) {
          const totalSpent = spent;
          toCreate.push({
            type: "BUDGET_WARNING",
            title: `Budget Period Ended: ${categoryName}`,
            message: `The budget period for ${categoryName} has ended. You spent $${totalSpent.toFixed(2)} of your $${budget.targetAmount} limit (${progress}%).`,
            dedupKey: `budget:${budget.id}:period-ended`,
          });
          generated.push({ type: "BUDGET_WARNING", budgetId: budget.id, categoryName });
          recentAlertTypes.add("BUDGET_WARNING");
        }
      }

      // 4. Upcoming budget expiration (3 days or fewer remaining)
      if (
        isActive &&
        daysRemaining > 0 &&
        daysRemaining <= EXPIRATION_WARNING_DAYS &&
        prefs.budgetAlerts !== false
      ) {
        if (!recentAlertTypes.has("BUDGET_WARNING")) {
          toCreate.push({
            type: "BUDGET_WARNING",
            title: `Budget Expiring Soon: ${categoryName}`,
            message: `Your ${categoryName} budget ends in ${daysRemaining} day${daysRemaining > 1 ? "s" : ""}. You've used ${progress}% of your $${budget.targetAmount} limit.`,
            dedupKey: `budget:${budget.id}:expiring-soon`,
          });
          generated.push({ type: "BUDGET_WARNING", budgetId: budget.id, categoryName });
          recentAlertTypes.add("BUDGET_WARNING");
        }
      }
    }

    // Single batched insert; duplicates are skipped at the DB level.
    if (toCreate.length > 0) {
      await notificationRepository.createMany(userId, toCreate);
    }

    return { generated: generated.length, alerts: generated };
  },

  async create(
    userId: string,
    data: {
      targetAmount: number;
      alertThreshold?: number;
      period?: string;
      startDate: string;
      categoryId: string;
    },
  ) {
    const startDate = new Date(data.startDate);

    // Validate category exists and belongs to the user
    const category = await categoryRepository.findById(data.categoryId);
    if (!category) {
      throw new ValidationError("Category not found");
    }
    if (category.userId !== userId) {
      throw new ValidationError("Category does not belong to this user");
    }

    // Check for duplicates — one budget per category per period per user
    const existing = await budgetRepository.findByCategoryAndPeriod(
      userId,
      data.categoryId,
      startDate,
    );
    if (existing) {
      throw new ConflictError("A budget already exists for this category and period");
    }

    return budgetRepository.create(userId, {
      ...data,
      startDate,
    });
  },

  async update(
    userId: string,
    id: string,
    data: {
      targetAmount?: number;
      alertThreshold?: number;
      period?: string;
      startDate?: string;
      categoryId?: string;
    },
  ) {
    // Fetch existing budget and verify ownership
    const existing = await budgetRepository.findById(id);
    if (!existing || existing.userId !== userId) {
      throw new NotFoundError("Budget not found");
    }

    // If categoryId is being updated, validate ownership
    if (data.categoryId) {
      const category = await categoryRepository.findById(data.categoryId);
      if (!category) {
        throw new ValidationError("Category not found");
      }
      if (category.userId !== userId) {
        throw new ValidationError("Category does not belong to this user");
      }
    }

    // If categoryId or startDate changed, check for duplicate budgets
    const effectiveCategoryId = data.categoryId ?? existing.categoryId;
    const effectiveStartDate = data.startDate ? new Date(data.startDate) : existing.startDate;

    if (
      data.categoryId ||
      (data.startDate && new Date(data.startDate).getTime() !== existing.startDate.getTime())
    ) {
      const duplicate = await budgetRepository.findByCategoryAndPeriod(
        userId,
        effectiveCategoryId,
        effectiveStartDate,
      );
      if (duplicate && duplicate.id !== id) {
        throw new ConflictError("A budget already exists for this category and period");
      }
    }

    // Prepare update payload
    const updateData: Record<string, unknown> = {};
    if (data.targetAmount !== undefined) updateData.targetAmount = data.targetAmount;
    if (data.alertThreshold !== undefined) updateData.alertThreshold = data.alertThreshold;
    if (data.period !== undefined) updateData.period = data.period;
    if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate);
    if (data.categoryId !== undefined) updateData.categoryId = data.categoryId;

    await budgetRepository.update(id, updateData);

    // Return enriched budget with progress
    return budgetRepository.getBudgetWithProgress(userId, id);
  },

  async delete(userId: string, id: string) {
    const budget = await budgetRepository.findById(id);
    if (!budget || budget.userId !== userId) {
      throw new NotFoundError("Budget not found");
    }
    return budgetRepository.delete(id);
  },
};
