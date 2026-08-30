import { prisma } from "../../db/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";

export const transactionRepository = {
  async findAllByUser(
    userId: string,
    options: {
      skip?: number;
      take?: number;
      type?: string;
      categoryId?: string;
      paymentMethodId?: string;
      minAmount?: number;
      maxAmount?: number;
      startDate?: Date;
      endDate?: Date;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      search?: string;
    } = {},
  ) {
    const where: Prisma.TransactionWhereInput = { userId };

    if (options.type) where.type = options.type as Prisma.EnumTransactionTypeFilter["equals"];
    if (options.categoryId) where.categoryId = options.categoryId;
    if (options.paymentMethodId) where.paymentMethodId = options.paymentMethodId;
    if (options.minAmount !== undefined || options.maxAmount !== undefined) {
      where.amount = {};
      if (options.minAmount !== undefined) where.amount.gte = options.minAmount;
      if (options.maxAmount !== undefined) where.amount.lte = options.maxAmount;
    }
    if (options.startDate || options.endDate) {
      where.date = {};
      if (options.startDate) where.date.gte = options.startDate;
      if (options.endDate) where.date.lte = options.endDate;
    }
    if (options.search) {
      where.OR = [
        { description: { contains: options.search, mode: "insensitive" } },
        { notes: { contains: options.search, mode: "insensitive" } },
      ];
    }

    const orderKey = (options.sortBy ?? "date") as keyof Prisma.TransactionOrderByWithRelationInput;
    const orderBy: Prisma.TransactionOrderByWithRelationInput = {
      [orderKey]: options.sortOrder ?? "desc",
    };

    const [data, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy,
        skip: options.skip ?? 0,
        take: options.take ?? 20,
        include: { category: true, paymentMethod: true },
      }),
      prisma.transaction.count({ where }),
    ]);

    return { data, total };
  },

  async findById(id: string) {
    return prisma.transaction.findUnique({
      where: { id },
      include: { category: true, paymentMethod: true },
    });
  },

  async create(userId: string, data: Record<string, unknown>) {
    return prisma.transaction.create({
      data: {
        ...data,
        user: { connect: { id: userId } },
      } as unknown as Prisma.TransactionCreateInput,
      include: { category: true, paymentMethod: true },
    });
  },

  async update(id: string, data: Record<string, unknown>) {
    return prisma.transaction.update({
      where: { id },
      data: data as Prisma.TransactionUpdateInput,
      include: { category: true, paymentMethod: true },
    });
  },

  async delete(id: string) {
    return prisma.transaction.delete({ where: { id } });
  },

  async findManyByIds(ids: string[]) {
    return prisma.transaction.findMany({
      where: { id: { in: ids } },
      select: { id: true, userId: true, receiptUrl: true },
    });
  },

  async deleteMany(ids: string[], userId: string) {
    return prisma.transaction.deleteMany({
      where: { id: { in: ids }, userId },
    });
  },

  async updateMany(ids: string[], userId: string, data: Record<string, unknown>) {
    return prisma.transaction.updateMany({
      where: { id: { in: ids }, userId },
      data: data as Prisma.TransactionUpdateManyMutationInput,
    });
  },

  async getSummary(
    userId: string,
    options: {
      startDate?: Date;
      endDate?: Date;
      type?: string;
      categoryId?: string;
      paymentMethodId?: string;
      minAmount?: number;
      maxAmount?: number;
      search?: string;
    } = {},
  ) {
    const where: Prisma.TransactionWhereInput = { userId };

    if (options.startDate || options.endDate) {
      where.date = {};
      if (options.startDate) where.date.gte = options.startDate;
      if (options.endDate) where.date.lte = options.endDate;
    }
    if (options.type) where.type = options.type as Prisma.EnumTransactionTypeFilter["equals"];
    if (options.categoryId) where.categoryId = options.categoryId;
    if (options.paymentMethodId) where.paymentMethodId = options.paymentMethodId;
    if (options.minAmount !== undefined || options.maxAmount !== undefined) {
      where.amount = {};
      if (options.minAmount !== undefined) where.amount.gte = options.minAmount;
      if (options.maxAmount !== undefined) where.amount.lte = options.maxAmount;
    }
    if (options.search) {
      where.OR = [
        { description: { contains: options.search, mode: "insensitive" } },
        { notes: { contains: options.search, mode: "insensitive" } },
      ];
    }

    const transactions = await prisma.transaction.findMany({ where });

    const summary = {
      totalIncome: 0,
      totalExpense: 0,
      totalTransfer: 0,
      netAmount: 0,
      count: transactions.length,
    };

    for (const tx of transactions) {
      if (tx.type === "INCOME") summary.totalIncome += tx.amount;
      else if (tx.type === "EXPENSE") summary.totalExpense += tx.amount;
      else if (tx.type === "TRANSFER") summary.totalTransfer += tx.amount;
    }

    summary.netAmount = summary.totalIncome - summary.totalExpense;
    return summary;
  },
};
