import { prisma } from "../../db/prisma.js";
import type { PaymentMethodType } from "../../generated/prisma/client.js";

export interface PaymentMethodStats {
  totalTransactions: number;
  totalIncome: number;
  totalExpense: number;
  totalTransfer: number;
  netAmount: number;
  firstUsed: string | null;
  lastUsed: string | null;
}

export const paymentMethodRepository = {
  async findAllByUser(userId: string) {
    return prisma.paymentMethod.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      include: { _count: { select: { transactions: true } } },
    });
  },

  async findById(id: string) {
    return prisma.paymentMethod.findUnique({ where: { id } });
  },

  async findTransactionStats(id: string) {
    const groups = await prisma.transaction.groupBy({
      by: ["type"],
      where: { paymentMethodId: id },
      _count: { id: true },
      _sum: { amount: true },
    });

    const stats = {
      totalTransactions: 0,
      totalIncome: 0,
      totalExpense: 0,
      totalTransfer: 0,
      netAmount: 0,
      firstUsed: null as string | null,
      lastUsed: null as string | null,
    };

    for (const group of groups) {
      stats.totalTransactions += group._count.id;
      const sum = group._sum.amount ?? 0;
      if (group.type === "INCOME") stats.totalIncome += sum;
      else if (group.type === "EXPENSE") stats.totalExpense += sum;
      else if (group.type === "TRANSFER") stats.totalTransfer += sum;
    }

    stats.netAmount = stats.totalIncome - stats.totalExpense;

    // Get first and last usage dates
    const [firstTxn, lastTxn] = await Promise.all([
      prisma.transaction.findFirst({
        where: { paymentMethodId: id },
        orderBy: { date: "asc" },
        select: { date: true },
      }),
      prisma.transaction.findFirst({
        where: { paymentMethodId: id },
        orderBy: { date: "desc" },
        select: { date: true },
      }),
    ]);

    stats.firstUsed = firstTxn?.date.toISOString() ?? null;
    stats.lastUsed = lastTxn?.date.toISOString() ?? null;

    return stats;
  },

  async findByName(userId: string, name: string) {
    return prisma.paymentMethod.findFirst({
      where: { userId, name },
    });
  },

  async create(
    userId: string,
    data: {
      type: PaymentMethodType;
      name: string;
      icon?: string;
      color?: string;
      isDefault?: boolean;
      lastFour?: string;
    },
  ) {
    // If setting as default, unset others
    if (data.isDefault) {
      await prisma.paymentMethod.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return prisma.paymentMethod.create({
      data: {
        type: data.type,
        name: data.name,
        icon: data.icon ?? "CreditCard",
        color: data.color ?? "#3B82F6",
        isDefault: data.isDefault ?? false,
        lastFour: data.lastFour,
        userId,
      },
    });
  },

  async update(
    id: string,
    data: {
      type?: PaymentMethodType;
      name?: string;
      icon?: string;
      color?: string;
      isDefault?: boolean;
      lastFour?: string | null;
    },
  ) {
    return prisma.paymentMethod.update({ where: { id }, data });
  },

  async delete(id: string) {
    return prisma.paymentMethod.delete({ where: { id } });
  },

  async countTransactions(id: string) {
    return prisma.transaction.count({
      where: { paymentMethodId: id },
    });
  },

  /**
   * Bulk-create default starter payment methods for a newly registered user.
   */
  async createDefaultPaymentMethods(
    userId: string,
    defaults: readonly { name: string; type: string; icon: string; color: string }[],
  ) {
    return prisma.paymentMethod.createMany({
      data: defaults.map((pm) => ({
        name: pm.name,
        type: pm.type as any,
        icon: pm.icon,
        color: pm.color,
        userId,
      })),
    });
  },
};
