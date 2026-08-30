import { prisma } from "../../db/prisma.js";

export const reportRepository = {
  async findTransactionsInRange(userId: string, startDate: Date, endDate: Date) {
    return prisma.transaction.findMany({
      where: {
        userId,
        date: { gte: startDate, lte: endDate },
      },
      include: { category: true },
      orderBy: { date: "asc" },
    });
  },

  async findTransactionsByYear(userId: string, year: number) {
    const startDate = new Date(`${year}-01-01`);
    const endDate = new Date(`${year + 1}-01-01`);

    return prisma.transaction.findMany({
      where: {
        userId,
        date: { gte: startDate, lt: endDate },
      },
      orderBy: { date: "asc" },
    });
  },

  async findTransactionsByDate(userId: string, date: Date) {
    const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const endOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

    return prisma.transaction.findMany({
      where: {
        userId,
        date: { gte: startOfDay, lte: endOfDay },
      },
      include: { category: true },
      orderBy: { date: "desc" },
    });
  },

  async findTransactionsInMonth(userId: string, startOfMonth: Date, endOfMonth: Date) {
    return prisma.transaction.findMany({
      where: {
        userId,
        date: { gte: startOfMonth, lte: endOfMonth },
      },
      include: { category: true },
      orderBy: { date: "asc" },
    });
  },

  async findBudgetsForUser(userId: string) {
    return prisma.budget.findMany({
      where: { userId },
      include: { category: true },
    });
  },

  async findPaymentMethodsForUser(userId: string) {
    return prisma.paymentMethod.findMany({
      where: { userId },
    });
  },

  async findTransactionsInYearWithDetails(userId: string, year: number) {
    const startDate = new Date(`${year}-01-01`);
    const endDate = new Date(`${year + 1}-01-01`);

    return prisma.transaction.findMany({
      where: {
        userId,
        date: { gte: startDate, lt: endDate },
      },
      include: { category: true },
      orderBy: { date: "asc" },
    });
  },

  async getSummary(userId: string, startDate?: Date, endDate?: Date) {
    const where: Record<string, unknown> = { userId };

    if (startDate || endDate) {
      const dateFilter: Record<string, Date> = {};
      if (startDate) dateFilter.gte = startDate;
      if (endDate) dateFilter.lte = endDate;
      where.date = dateFilter;
    }

    const aggregation = await prisma.transaction.groupBy({
      where: where as any,
      by: ["type"],
      _sum: { amount: true },
      _avg: { amount: true },
      _count: true,
    });

    return aggregation;
  },

  async getBreakdown(userId: string, startDate?: Date, endDate?: Date) {
    const buildWhere = () => {
      const w: Record<string, unknown> = { userId };
      if (startDate || endDate) {
        const dateFilter: Record<string, Date> = {};
        if (startDate) dateFilter.gte = startDate;
        if (endDate) dateFilter.lte = endDate;
        w.date = dateFilter;
      }
      return w;
    };

    const where = buildWhere();

    const [
      categoryGroup,
      paymentMethodGroup,
      incomeExpenseGroup,
      largestTx,
      smallestTx,
      paymentMethods,
      userCategories,
    ] = await Promise.all([
      prisma.transaction.groupBy({
        where: where as any,
        by: ["categoryId"],
        _sum: { amount: true },
        _count: true,
      }),
      prisma.transaction.groupBy({
        where: { ...where, paymentMethodId: { not: null } } as any,
        by: ["paymentMethodId", "type"],
        _sum: { amount: true },
        _count: true,
      }),
      prisma.transaction.groupBy({
        where: where as any,
        by: ["type"],
        _sum: { amount: true },
        _count: true,
      }),
      prisma.transaction.findFirst({
        where: where as any,
        orderBy: { amount: "desc" },
        include: { category: true },
      }),
      prisma.transaction.findFirst({
        where: where as any,
        orderBy: { amount: "asc" },
        include: { category: true },
      }),
      prisma.paymentMethod.findMany({ where: { userId } }),
      prisma.category.findMany({
        where: { userId },
        select: { id: true, name: true, color: true, icon: true },
      }),
    ]);

    return {
      categoryGroup,
      paymentMethodGroup,
      incomeExpenseGroup,
      largestTx,
      smallestTx,
      paymentMethods,
      userCategories,
    };
  },

  /** Build the base where clause used by both findCustomTransactions and countCustomTransactions. */
  buildCustomFilter(
    userId: string,
    filters: {
      startDate?: Date;
      endDate?: Date;
      categoryId?: string;
      paymentMethodId?: string;
      type?: string;
      minAmount?: number;
      maxAmount?: number;
    },
  ): Record<string, unknown> {
    const where: Record<string, unknown> = { userId };

    if (filters.startDate || filters.endDate) {
      const dateFilter: Record<string, Date> = {};
      if (filters.startDate) dateFilter.gte = filters.startDate;
      if (filters.endDate) dateFilter.lte = filters.endDate;
      where.date = dateFilter;
    }

    if (filters.categoryId) {
      where.categoryId = filters.categoryId;
    }

    if (filters.paymentMethodId) {
      where.paymentMethodId = filters.paymentMethodId;
    }

    if (filters.type) {
      where.type = filters.type;
    }

    if (filters.minAmount !== undefined || filters.maxAmount !== undefined) {
      const amountFilter: Record<string, number> = {};
      if (filters.minAmount !== undefined) amountFilter.gte = filters.minAmount;
      if (filters.maxAmount !== undefined) amountFilter.lte = filters.maxAmount;
      where.amount = amountFilter;
    }

    return where;
  },

  async findCustomTransactions(
    userId: string,
    filters: {
      startDate?: Date;
      endDate?: Date;
      categoryId?: string;
      paymentMethodId?: string;
      type?: string;
      minAmount?: number;
      maxAmount?: number;
    },
    pagination?: { skip: number; take: number },
    sort?: { sortBy?: string; sortOrder?: "asc" | "desc" },
  ) {
    const where = this.buildCustomFilter(userId, filters);

    // Apply global sort via DB (needed for correct pagination)
    const orderBy: Record<string, "asc" | "desc"> = sort?.sortBy
      ? { [sort.sortBy]: sort.sortOrder ?? "desc" }
      : { date: "desc" };

    return prisma.transaction.findMany({
      where: where as any,
      include: { category: true, paymentMethod: true },
      orderBy,
      ...(pagination ? { skip: pagination.skip, take: pagination.take } : {}),
    });
  },

  async countCustomTransactions(
    userId: string,
    filters: {
      startDate?: Date;
      endDate?: Date;
      categoryId?: string;
      paymentMethodId?: string;
      type?: string;
      minAmount?: number;
      maxAmount?: number;
    },
  ): Promise<number> {
    const where = this.buildCustomFilter(userId, filters);

    return prisma.transaction.count({
      where: where as any,
    });
  },
};
