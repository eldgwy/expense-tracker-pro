import { savingsGoalRepository } from "./savings-goals.repository.js";
import { NotFoundError, ValidationError } from "../../common/errors/index.js";
import type { SavingsGoalQueryFilters } from "./savings-goals.types.js";

export const savingsGoalService = {
  async findAll(userId: string, filters: SavingsGoalQueryFilters = {}) {
    return savingsGoalRepository.findAllByUser(userId, {
      status: filters.status,
      priority: filters.priority,
      sortBy: filters.sortBy,
      sortOrder: filters.sortOrder,
    });
  },

  async findById(userId: string, id: string) {
    const goal = await savingsGoalRepository.getGoalWithDetails(userId, id);
    if (!goal) {
      throw new NotFoundError("Savings goal not found");
    }
    return goal;
  },

  async create(
    userId: string,
    data: {
      name: string;
      targetAmount: number;
      currentAmount?: number;
      deadline?: string;
      priority?: string;
      icon?: string;
      color?: string;
    },
  ) {
    if (data.currentAmount && data.currentAmount > data.targetAmount) {
      throw new ValidationError("Current amount cannot exceed target amount");
    }
    const goal = await savingsGoalRepository.create(userId, {
      ...data,
      deadline: data.deadline ? new Date(data.deadline) : undefined,
    });

    // Auto-complete if target is reached immediately
    const effectiveCurrent = data.currentAmount ?? 0;
    if (effectiveCurrent >= data.targetAmount) {
      await savingsGoalRepository.markAsCompleted(goal.id);
    }

    return savingsGoalRepository.getGoalWithDetails(userId, goal.id);
  },

  async update(
    userId: string,
    id: string,
    data: {
      name?: string;
      targetAmount?: number;
      currentAmount?: number;
      deadline?: string | null;
      priority?: string;
      icon?: string;
      color?: string;
    },
  ) {
    const existing = await savingsGoalRepository.findById(id);
    if (!existing || existing.userId !== userId) {
      throw new NotFoundError("Savings goal not found");
    }

    // Validate: currentAmount must not exceed the (new or existing) targetAmount
    const effectiveTarget = data.targetAmount ?? existing.targetAmount;
    const effectiveCurrent = data.currentAmount ?? existing.currentAmount;
    if (effectiveCurrent > effectiveTarget) {
      throw new ValidationError("Current amount cannot exceed target amount");
    }

    // Block updates on completed goals (archived state)
    if (existing.completedAt) {
      throw new ValidationError("Cannot update a completed savings goal. The goal is archived.");
    }

    // Build update payload with proper date conversion
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.targetAmount !== undefined) updateData.targetAmount = data.targetAmount;
    if (data.currentAmount !== undefined) updateData.currentAmount = data.currentAmount;
    if (data.deadline !== undefined)
      updateData.deadline = data.deadline ? new Date(data.deadline) : null;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.icon !== undefined) updateData.icon = data.icon;
    if (data.color !== undefined) updateData.color = data.color;

    await savingsGoalRepository.update(id, updateData as any);

    // Auto-complete if new currentAmount reaches target
    if (effectiveCurrent >= effectiveTarget) {
      await savingsGoalRepository.markAsCompleted(id);
    }

    // Return enriched goal with progress details
    return savingsGoalRepository.getGoalWithDetails(userId, id);
  },

  async delete(userId: string, id: string) {
    const goal = await savingsGoalRepository.findById(id);
    if (!goal || goal.userId !== userId) {
      throw new NotFoundError("Savings goal not found");
    }

    // Prevent deletion of completed goals to maintain data integrity
    if (goal.currentAmount >= goal.targetAmount) {
      throw new ValidationError("Cannot delete a completed savings goal. Archive it instead.");
    }

    return savingsGoalRepository.delete(id);
  },

  async addProgress(userId: string, id: string, data: { amount: number; allowExceed?: boolean }) {
    const goal = await savingsGoalRepository.findById(id);
    if (!goal || goal.userId !== userId) {
      throw new NotFoundError("Savings goal not found");
    }
    if (data.amount <= 0) {
      throw new ValidationError("Progress amount must be positive");
    }

    // Prevent exceeding target unless explicitly allowed
    const newAmount = goal.currentAmount + data.amount;
    if (!data.allowExceed && newAmount > goal.targetAmount) {
      throw new ValidationError(
        `This addition would exceed the target. You can add at most $${(goal.targetAmount - goal.currentAmount).toFixed(2)}. Use allowExceed to override.`,
      );
    }

    await savingsGoalRepository.addProgress(id, data.amount);

    // Auto-complete if target is now reached
    if (newAmount >= goal.targetAmount) {
      await savingsGoalRepository.markAsCompleted(id);
    }

    return savingsGoalRepository.getGoalWithDetails(userId, id);
  },

  async getStats(userId: string) {
    return savingsGoalRepository.getStats(userId);
  },

  async getInsights(userId: string) {
    return savingsGoalRepository.getInsights(userId);
  },

  async withdrawProgress(userId: string, id: string, amount: number) {
    const goal = await savingsGoalRepository.findById(id);
    if (!goal || goal.userId !== userId) {
      throw new NotFoundError("Savings goal not found");
    }
    if (amount <= 0) {
      throw new ValidationError("Withdrawal amount must be positive");
    }

    // Prevent negative balance
    if (amount > goal.currentAmount) {
      throw new ValidationError(
        `Insufficient funds. Current balance is $${goal.currentAmount.toFixed(2)}, but you tried to withdraw $${amount.toFixed(2)}.`,
      );
    }

    await savingsGoalRepository.withdrawProgress(id, amount);

    // Clear completion if goal drops below target
    const newAmount = goal.currentAmount - amount;
    if (newAmount < goal.targetAmount && goal.completedAt) {
      await savingsGoalRepository.clearCompletedAt(id);
    }

    return savingsGoalRepository.getGoalWithDetails(userId, id);
  },
};
