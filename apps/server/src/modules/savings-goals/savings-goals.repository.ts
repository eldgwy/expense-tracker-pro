import { prisma } from "../../db/prisma.js";
import type { GoalPriority, SavingsGoal } from "../../generated/prisma/client.js";

let schemaEnsured = false;
async function ensureSavingsGoalSchema(): Promise<void> {
  if (schemaEnsured) return;
  try {
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GoalPriority') THEN
          CREATE TYPE "GoalPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
        END IF;
      END $$;
      ALTER TABLE "savings_goals" ADD COLUMN IF NOT EXISTS "priority" "GoalPriority" NOT NULL DEFAULT 'MEDIUM';
      ALTER TABLE "savings_goals" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
    `);
    schemaEnsured = true;
  } catch {
    // Graceful continuation if user lacks DDL permissions or migrations are running
  }
}

export const savingsGoalRepository = {
  async findAllByUser(
    userId: string,
    options: {
      status?: "active" | "completed";
      priority?: string;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
    } = {},
  ) {
    await ensureSavingsGoalSchema();

    let goals: SavingsGoal[];
    try {
      goals = await prisma.savingsGoal.findMany({
        where: {
          userId,
          ...(options.priority ? { priority: options.priority as GoalPriority } : {}),
        },
        orderBy: { createdAt: "desc" },
      });
    } catch {
      // Resilient fallback in case column addition is pending on remote DB
      const raw = await prisma.$queryRaw<Array<{
        id: string;
        name: string;
        targetAmount: number;
        currentAmount: number;
        deadline: Date | null;
        priority?: string;
        icon: string;
        color: string;
        userId: string;
        completedAt?: Date | null;
        createdAt: Date;
        updatedAt: Date;
      }>>`SELECT id, name, "targetAmount", "currentAmount", deadline, icon, color, "userId", "createdAt", "updatedAt" FROM "savings_goals" WHERE "userId" = ${userId}::uuid ORDER BY "createdAt" DESC`;

      goals = raw.map((r) => ({
        ...r,
        priority: (r.priority as GoalPriority) ?? ("MEDIUM" as GoalPriority),
        completedAt: r.completedAt ?? null,
      }));
    }

    // Compute status, progress, remaining, and daysRemaining
    let result = goals.map((goal) => {
      const target = goal.targetAmount ?? 0;
      const current = goal.currentAmount ?? 0;
      const progress = target > 0 ? Math.round((current / target) * 100) : 0;
      const remaining = Math.max(0, target - current);
      let daysRemaining: number | null = null;
      if (goal.deadline) {
        const now = new Date();
        const timeDiff = new Date(goal.deadline).getTime() - now.getTime();
        daysRemaining = timeDiff > 0 ? Math.ceil(timeDiff / (1000 * 60 * 60 * 24)) : 0;
      }
      return {
        ...goal,
        progress,
        remaining,
        daysRemaining,
        isCompleted:
          (goal.completedAt !== null && goal.completedAt !== undefined) ||
          current >= target,
      };
    });

    if (options.status) {
      result = result.filter((g) =>
        options.status === "completed" ? g.isCompleted : !g.isCompleted,
      );
    }

    // Sort
    const orderDir = options.sortOrder ?? "desc";
    const sortBy = options.sortBy ?? "createdAt";

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "deadline": {
          const aDate = a.deadline ? new Date(a.deadline).getTime() : 0;
          const bDate = b.deadline ? new Date(b.deadline).getTime() : 0;
          cmp = aDate - bDate;
          break;
        }
        case "targetAmount":
          cmp = a.targetAmount - b.targetAmount;
          break;
        case "currentAmount":
          cmp = a.currentAmount - b.currentAmount;
          break;
        case "priority": {
          const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
          cmp =
            (priorityOrder[a.priority as keyof typeof priorityOrder] ?? 3) -
            (priorityOrder[b.priority as keyof typeof priorityOrder] ?? 3);
          break;
        }
        case "createdAt":
        default:
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      return orderDir === "asc" ? cmp : -cmp;
    });

    return result;
  },

  async findById(id: string) {
    await ensureSavingsGoalSchema();
    try {
      return await prisma.savingsGoal.findUnique({ where: { id } });
    } catch {
      const raw = await prisma.$queryRaw<Array<any>>`SELECT * FROM "savings_goals" WHERE id = ${id}::uuid LIMIT 1`;
      if (!raw.length) return null;
      const r = raw[0];
      return {
        ...r,
        priority: r.priority ?? "MEDIUM",
        completedAt: r.completedAt ?? null,
      } as SavingsGoal;
    }
  },

  /**
   * Fetch a single goal enriched with computed fields:
   * progress, remaining, daysRemaining, isCompleted.
   */
  async getGoalWithDetails(userId: string, id: string) {
    const goal = await this.findById(id);
    if (!goal || goal.userId !== userId) return null;

    const progress =
      goal.targetAmount > 0 ? Math.round((goal.currentAmount / goal.targetAmount) * 100) : 0;
    const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
    let daysRemaining: number | null = null;

    if (goal.deadline) {
      const now = new Date();
      const timeDiff = new Date(goal.deadline).getTime() - now.getTime();
      daysRemaining = timeDiff > 0 ? Math.ceil(timeDiff / (1000 * 60 * 60 * 24)) : 0;
    }

    return {
      ...goal,
      progress,
      remaining,
      daysRemaining,
      isCompleted: goal.completedAt !== null || goal.currentAmount >= goal.targetAmount,
    };
  },

  async markAsCompleted(id: string) {
    await ensureSavingsGoalSchema();
    try {
      return await prisma.savingsGoal.update({
        where: { id },
        data: { completedAt: new Date() },
      });
    } catch {
      return prisma.$executeRawUnsafe(
        `UPDATE "savings_goals" SET "completedAt" = NOW() WHERE id = '${id}'`,
      );
    }
  },

  async clearCompletedAt(id: string) {
    await ensureSavingsGoalSchema();
    try {
      return await prisma.savingsGoal.update({
        where: { id },
        data: { completedAt: null },
      });
    } catch {
      return prisma.$executeRawUnsafe(
        `UPDATE "savings_goals" SET "completedAt" = NULL WHERE id = '${id}'`,
      );
    }
  },

  async create(
    userId: string,
    data: {
      name: string;
      targetAmount: number;
      currentAmount?: number;
      deadline?: Date;
      priority?: string;
      icon?: string;
      color?: string;
    },
  ) {
    await ensureSavingsGoalSchema();
    return prisma.savingsGoal.create({
      data: { ...data, userId } as any,
    });
  },

  async update(
    id: string,
    data: {
      name?: string;
      targetAmount?: number;
      currentAmount?: number;
      deadline?: Date | null;
      priority?: string;
      icon?: string;
      color?: string;
    },
  ) {
    await ensureSavingsGoalSchema();
    return prisma.savingsGoal.update({ where: { id }, data } as any);
  },

  async delete(id: string) {
    return prisma.savingsGoal.delete({ where: { id } });
  },

  async addProgress(id: string, amount: number) {
    return prisma.savingsGoal.update({
      where: { id },
      data: { currentAmount: { increment: amount } },
    });
  },

  async withdrawProgress(id: string, amount: number) {
    return prisma.savingsGoal.update({
      where: { id },
      data: { currentAmount: { decrement: amount } },
    });
  },

  async getInsights(userId: string) {
    await ensureSavingsGoalSchema();
    let goals: SavingsGoal[];
    try {
      goals = await prisma.savingsGoal.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });
    } catch {
      const raw = await prisma.$queryRaw<Array<any>>`SELECT * FROM "savings_goals" WHERE "userId" = ${userId}::uuid ORDER BY "createdAt" DESC`;
      goals = raw.map((r) => ({
        ...r,
        priority: r.priority ?? "MEDIUM",
        completedAt: r.completedAt ?? null,
      }));
    }

    const now = new Date();

    // ── 1. Upcoming goal deadlines (within next 30 days) ──
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const upcomingDeadlines = goals
      .filter((g) => {
        if (!g.deadline || g.currentAmount >= g.targetAmount) return false;
        const d = new Date(g.deadline);
        return d >= now && d <= thirtyDaysFromNow;
      })
      .map((g) => {
        const d = new Date(g.deadline!);
        return {
          id: g.id,
          name: g.name,
          deadline: g.deadline,
          targetAmount: g.targetAmount,
          currentAmount: g.currentAmount,
          progress: Math.round((g.currentAmount / g.targetAmount) * 100),
          remaining: Math.max(0, g.targetAmount - g.currentAmount),
          daysRemaining: Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
        };
      })
      .sort((a, b) => a.daysRemaining - b.daysRemaining);

    // ── 2. Goals at risk of missing target date ──
    const goalsAtRisk = goals
      .filter((g) => {
        if (!g.deadline || g.currentAmount >= g.targetAmount) return false;
        const created = new Date(g.createdAt);
        const deadline = new Date(g.deadline);
        const daysElapsed = Math.ceil(
          (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (daysElapsed <= 0) return false;
        const savingsRatePerDay = g.currentAmount / daysElapsed;
        const daysUntilDeadline = Math.ceil(
          (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (daysUntilDeadline <= 0) return true;
        const projectedAtDeadline = g.currentAmount + savingsRatePerDay * daysUntilDeadline;
        return projectedAtDeadline < g.targetAmount;
      })
      .map((g) => {
        const created = new Date(g.createdAt);
        const deadline = new Date(g.deadline!);
        const daysElapsed = Math.ceil(
          (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24),
        );
        const savingsRatePerDay = daysElapsed > 0 ? g.currentAmount / daysElapsed : 0;
        const daysUntilDeadline = Math.ceil(
          (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        const projectedAtDeadline =
          g.currentAmount + savingsRatePerDay * Math.max(0, daysUntilDeadline);
        const shortfall = Math.max(0, g.targetAmount - projectedAtDeadline);
        const requiredDaily =
          daysUntilDeadline > 0
            ? Math.max(0, g.targetAmount - g.currentAmount) / daysUntilDeadline
            : Infinity;

        return {
          id: g.id,
          name: g.name,
          deadline: g.deadline,
          targetAmount: g.targetAmount,
          currentAmount: g.currentAmount,
          progress: Math.round((g.currentAmount / g.targetAmount) * 100),
          remaining: Math.max(0, g.targetAmount - g.currentAmount),
          daysRemaining: Math.max(0, daysUntilDeadline),
          projectedAtDeadline: Math.round(projectedAtDeadline * 100) / 100,
          shortfall: Math.round(shortfall * 100) / 100,
          requiredDaily: requiredDaily === Infinity ? null : Math.round(requiredDaily * 100) / 100,
        };
      })
      .sort((a, b) => b.shortfall - a.shortfall);

    // ── 3. Largest savings goal ──
    let largestGoal: {
      id: string;
      name: string;
      targetAmount: number;
      currentAmount: number;
      progress: number;
    } | null = null;

    if (goals.length > 0) {
      const largest = goals.reduce((prev, curr) =>
        curr.targetAmount > prev.targetAmount ? curr : prev,
      );
      largestGoal = {
        id: largest.id,
        name: largest.name,
        targetAmount: largest.targetAmount,
        currentAmount: largest.currentAmount,
        progress: Math.round((largest.currentAmount / largest.targetAmount) * 100),
      };
    }

    // ── 4. Fastest completed goal ──
    let fastestCompleted: {
      id: string;
      name: string;
      targetAmount: number;
      daysToComplete: number;
      completedAt: Date;
    } | null = null;

    const completed = goals.filter((g) => g.completedAt !== null && g.completedAt !== undefined);
    if (completed.length > 0) {
      const fastest = completed.reduce((prev, curr) => {
        const prevDuration = new Date(prev.completedAt!).getTime() - new Date(prev.createdAt).getTime();
        const currDuration = new Date(curr.completedAt!).getTime() - new Date(curr.createdAt).getTime();
        return currDuration < prevDuration ? curr : prev;
      });
      const completedDate = new Date(fastest.completedAt!);
      const createdDate = new Date(fastest.createdAt);
      const daysToComplete = Math.ceil(
        (completedDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      fastestCompleted = {
        id: fastest.id,
        name: fastest.name,
        targetAmount: fastest.targetAmount,
        daysToComplete,
        completedAt: completedDate,
      };
    }

    // ── 5. Average monthly savings needed ──
    const activeWithDeadlines = goals.filter((g) => {
      if (!g.deadline || g.currentAmount >= g.targetAmount) return false;
      const daysUntilDeadline = Math.ceil(
        (new Date(g.deadline).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      return daysUntilDeadline > 0;
    });

    let averageMonthlySavingsNeeded: number | null = null;
    if (activeWithDeadlines.length > 0) {
      const totalMonthlyNeeded = activeWithDeadlines.reduce((sum, g) => {
        const remaining = g.targetAmount - g.currentAmount;
        const daysUntilDeadline = Math.ceil(
          (new Date(g.deadline!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        const monthsRemaining = Math.max(1, daysUntilDeadline / 30);
        return sum + remaining / monthsRemaining;
      }, 0);
      averageMonthlySavingsNeeded =
        Math.round((totalMonthlyNeeded / activeWithDeadlines.length) * 100) / 100;
    }

    const monthlySavingsPerGoal = activeWithDeadlines.map((g) => {
      const remaining = g.targetAmount - g.currentAmount;
      const daysUntilDeadline = Math.ceil(
        (new Date(g.deadline!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      const monthsRemaining = Math.max(1, daysUntilDeadline / 30);
      return {
        id: g.id,
        name: g.name,
        remaining,
        daysRemaining: daysUntilDeadline,
        monthlyNeeded: Math.round((remaining / monthsRemaining) * 100) / 100,
      };
    });

    return {
      upcomingDeadlines,
      goalsAtRisk,
      largestGoal,
      fastestCompleted,
      averageMonthlySavingsNeeded,
      monthlySavingsPerGoal,
    };
  },

  async getStats(userId: string) {
    await ensureSavingsGoalSchema();
    let goals: SavingsGoal[];
    try {
      goals = await prisma.savingsGoal.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });
    } catch {
      const raw = await prisma.$queryRaw<Array<any>>`SELECT * FROM "savings_goals" WHERE "userId" = ${userId}::uuid ORDER BY "createdAt" DESC`;
      goals = raw.map((r) => ({
        ...r,
        priority: r.priority ?? "MEDIUM",
        completedAt: r.completedAt ?? null,
      }));
    }

    const totalGoals = goals.length;
    const completedGoals = goals.filter((g) => g.currentAmount >= g.targetAmount).length;
    const activeGoals = totalGoals - completedGoals;
    const totalTarget = goals.reduce((sum, g) => sum + g.targetAmount, 0);
    const totalSaved = goals.reduce((sum, g) => sum + g.currentAmount, 0);
    const overallPercentage = totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0;

    const activeGoalList = goals.filter((g) => g.currentAmount < g.targetAmount);
    let closestGoal: {
      id: string;
      name: string;
      targetAmount: number;
      currentAmount: number;
      progress: number;
      remaining: number;
      deadline: Date | null;
    } | null = null;

    if (activeGoalList.length > 0) {
      const best = activeGoalList.reduce((prev, curr) => {
        const prevProgress = prev.currentAmount / prev.targetAmount;
        const currProgress = curr.currentAmount / curr.targetAmount;
        return currProgress > prevProgress ? curr : prev;
      });

      closestGoal = {
        id: best.id,
        name: best.name,
        targetAmount: best.targetAmount,
        currentAmount: best.currentAmount,
        progress: Math.round((best.currentAmount / best.targetAmount) * 100),
        remaining: Math.max(0, best.targetAmount - best.currentAmount),
        deadline: best.deadline,
      };
    }

    return {
      totalGoals,
      activeGoals,
      completedGoals,
      totalTarget,
      totalSaved,
      overallPercentage,
      closestGoal,
    };
  },
};
