import { prisma } from "../../db/prisma.js";

export interface CategoryWithStats {
  id: string;
  name: string;
  icon: string;
  color: string;
  isSystem: boolean;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  transactionCount: number;
  totalSpent: number;
}

export const categoryRepository = {
  async findAllByUser(userId: string, query?: string): Promise<CategoryWithStats[]> {
    // Build where clause: filter by user and optionally by name (case-insensitive partial match)
    const where: { userId: string; name?: { contains: string; mode: "insensitive" } } = {
      userId,
    };

    if (query && query.trim().length > 0) {
      where.name = { contains: query.trim(), mode: "insensitive" };
    }

    // Fetch categories with transaction count
    const categories = await prisma.category.findMany({
      where,
      orderBy: { name: "asc" },
      include: {
        _count: { select: { transactions: true } },
      },
    });

    // Fetch total spent per category (sum of all transaction amounts)
    const aggregation = await prisma.transaction.groupBy({
      by: ["categoryId"],
      where: { userId },
      _sum: { amount: true },
    });

    // Build a lookup map for total spent
    const spentMap = new Map<string, number>();
    for (const row of aggregation) {
      spentMap.set(row.categoryId, row._sum.amount ?? 0);
    }

    // Merge stats into category objects
    return categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      icon: cat.icon,
      color: cat.color,
      isSystem: cat.isSystem,
      userId: cat.userId,
      createdAt: cat.createdAt,
      updatedAt: cat.updatedAt,
      transactionCount: cat._count.transactions,
      totalSpent: spentMap.get(cat.id) ?? 0,
    }));
  },

  async findById(id: string): Promise<CategoryWithStats | null> {
    const category = await prisma.category.findUnique({
      where: { id },
      include: {
        _count: { select: { transactions: true } },
      },
    });

    if (!category) return null;

    const aggregation = await prisma.transaction.aggregate({
      where: { categoryId: id },
      _sum: { amount: true },
    });

    return {
      id: category.id,
      name: category.name,
      icon: category.icon,
      color: category.color,
      isSystem: category.isSystem,
      userId: category.userId,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
      transactionCount: category._count.transactions,
      totalSpent: aggregation._sum.amount ?? 0,
    };
  },

  async findByName(userId: string, name: string) {
    return prisma.category.findFirst({
      where: { userId, name },
    });
  },

  async create(userId: string, data: { name: string; icon?: string; color?: string }) {
    return prisma.category.create({
      data: {
        name: data.name,
        icon: data.icon ?? "Tag",
        color: data.color ?? "#6366F1",
        isSystem: false,
        userId,
      },
    });
  },

  async update(id: string, data: { name?: string; icon?: string; color?: string }) {
    return prisma.category.update({ where: { id }, data });
  },

  async deleteBudgetsByCategory(categoryId: string) {
    return prisma.budget.deleteMany({ where: { categoryId } });
  },

  async delete(id: string) {
    return prisma.category.delete({ where: { id } });
  },

  /**
   * Bulk-create default starter categories for a newly registered user.
   * Each category is marked as system-owned to prevent accidental deletion.
   */
  async createDefaultCategories(
    userId: string,
    defaults: readonly { name: string; icon: string; color: string }[],
  ) {
    return prisma.category.createMany({
      data: defaults.map((cat) => ({
        name: cat.name,
        icon: cat.icon,
        color: cat.color,
        isSystem: true,
        userId,
      })),
    });
  },
};
