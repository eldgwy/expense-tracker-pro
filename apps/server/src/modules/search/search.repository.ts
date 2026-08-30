import { prisma } from "../../db/prisma.js";
import type { SearchEntity, SearchResultItem } from "./search.types.js";

/**
 * Search across all 5 entity types for a given user.
 *
 * Each entity search uses `contains` + `insensitive` mode for partial matching.
 * Results are limited per entity to `perEntityLimit` and merged into a flat list
 * sorted by relevance (exact matches first, then partial).
 */
interface CategoryFilters {
  categoryIds?: string[];
  categoryType?: string;
}

interface DateFilters {
  startDate?: Date;
  endDate?: Date;
}

interface AmountFilters {
  minAmount?: number;
  maxAmount?: number;
  exactAmount?: number;
}

type SortOrder = "asc" | "desc";

interface SortOptions {
  sortBy: string;
  sortOrder: SortOrder;
}

/**
 * Build a Prisma orderBy object for a given sort field and direction using
 * an entity-specific mapping. Falls back to a reasonable default on unknown fields.
 */
function buildOrderBy(
  sortBy: string | undefined,
  sortOrder: SortOrder,
  fieldMap: Record<string, string | string[]>,
  defaultField: string,
): Record<string, any> {
  if (!sortBy || !fieldMap[sortBy]) {
    return { [defaultField]: sortOrder };
  }

  const mapped = fieldMap[sortBy];
  if (Array.isArray(mapped)) {
    // Nested relation path: e.g. ["category", "name"] → { category: { name: order } }
    const result: Record<string, any> = {};
    let current = result;
    for (let i = 0; i < mapped.length - 1; i++) {
      current[mapped[i]] = {};
      current = current[mapped[i]];
    }
    current[mapped[mapped.length - 1]] = sortOrder;
    return result;
  }

  return { [mapped]: sortOrder };
}

export const searchRepository = {
  async searchAll(
    userId: string,
    query: string,
    entities?: SearchEntity[],
    perEntityLimit: number = 10,
    categoryFilters?: CategoryFilters,
    dateFilters?: DateFilters,
    amountFilters?: AmountFilters,
    sortOptions?: SortOptions,
  ): Promise<SearchResultItem[]> {
    const results: SearchResultItem[] = [];

    const entitiesToSearch = entities ?? [
      "transactions",
      "categories",
      "payment-methods",
      "budgets",
      "savings-goals",
    ];

    const trimmedQuery = query.trim();
    if (!trimmedQuery) return [];

    const keywords = trimmedQuery.split(/\s+/).filter(Boolean);

    // ─── All entity searches run in PARALLEL ────────────────
    const searchPromises: Promise<SearchResultItem[]>[] = [];

    if (entitiesToSearch.includes("transactions")) {
      searchPromises.push(
        searchTransactions(
          userId,
          perEntityLimit,
          keywords,
          categoryFilters,
          dateFilters,
          amountFilters,
          sortOptions,
        ),
      );
    }
    if (entitiesToSearch.includes("categories")) {
      searchPromises.push(
        searchCategories(userId, perEntityLimit, keywords, categoryFilters, sortOptions),
      );
    }
    if (entitiesToSearch.includes("payment-methods")) {
      searchPromises.push(searchPaymentMethods(userId, perEntityLimit, keywords, sortOptions));
    }
    if (entitiesToSearch.includes("budgets")) {
      searchPromises.push(
        searchBudgets(
          userId,
          perEntityLimit,
          keywords,
          categoryFilters,
          dateFilters,
          amountFilters,
          sortOptions,
        ),
      );
    }
    if (entitiesToSearch.includes("savings-goals")) {
      searchPromises.push(
        searchSavingsGoals(userId, perEntityLimit, keywords, dateFilters, sortOptions),
      );
    }

    const allResults = await Promise.all(searchPromises);
    for (const entityResults of allResults) {
      results.push(...entityResults);
    }

    return results;
  },
};

// ─── Individual Entity Search Functions ───────────────────────

/** Build AND conditions for multiple keywords: all keywords must match at least one field. */
function buildMultiKeywordFilter(fields: string[], keywords: string[]): Record<string, unknown> {
  if (keywords.length === 1) {
    // Single keyword: OR across all fields
    return {
      OR: fields.map((field) => ({
        [field]: { contains: keywords[0], mode: "insensitive" },
      })),
    };
  }

  // Multiple keywords: AND of ORs — all keywords must match at least one field
  return {
    AND: keywords.map((word) => ({
      OR: fields.map((field) => ({
        [field]: { contains: word, mode: "insensitive" },
      })),
    })),
  };
}

/** Build a filter for a nested relation field (e.g. category.name) */
function buildNestedKeywordFilter(
  relation: string,
  field: string,
  keywords: string[],
): Record<string, unknown> {
  if (keywords.length === 1) {
    return {
      [relation]: { [field]: { contains: keywords[0], mode: "insensitive" } },
    };
  }

  return {
    [relation]: {
      AND: keywords.map((word) => ({
        [field]: { contains: word, mode: "insensitive" },
      })),
    },
  };
}

const TX_SORT_MAP: Record<string, string | string[]> = {
  date: "date",
  amount: "amount",
  title: "description",
  category: ["category", "name"],
  created_at: "createdAt",
  updated_at: "updatedAt",
};

const CAT_SORT_MAP: Record<string, string | string[]> = {
  title: "name",
  category: "name",
  created_at: "createdAt",
  updated_at: "updatedAt",
};

const PM_SORT_MAP: Record<string, string | string[]> = {
  title: "name",
  created_at: "createdAt",
};

const BUDGET_SORT_MAP: Record<string, string | string[]> = {
  date: "startDate",
  amount: "targetAmount",
  title: ["category", "name"],
  category: ["category", "name"],
  created_at: "createdAt",
};

const GOAL_SORT_MAP: Record<string, string | string[]> = {
  date: "deadline",
  amount: "targetAmount",
  title: "name",
  created_at: "createdAt",
  updated_at: "updatedAt",
};

async function searchTransactions(
  userId: string,
  limit: number,
  keywords: string[],
  categoryFilters?: CategoryFilters,
  dateFilters?: DateFilters,
  amountFilters?: AmountFilters,
  sortOptions?: SortOptions,
): Promise<SearchResultItem[]> {
  const where: Record<string, unknown> = { userId };
  Object.assign(where, buildMultiKeywordFilter(["description", "notes"], keywords));

  // Apply category ID filter
  if (categoryFilters?.categoryIds && categoryFilters.categoryIds.length > 0) {
    where.categoryId = { in: categoryFilters.categoryIds };
  }

  // Apply category type filter (income vs expense)
  if (categoryFilters?.categoryType) {
    where.type = categoryFilters.categoryType;
  }

  // Apply date range filter
  if (dateFilters?.startDate || dateFilters?.endDate) {
    where.date = {};
    if (dateFilters.startDate) {
      (where.date as Record<string, unknown>).gte = dateFilters.startDate;
    }
    if (dateFilters.endDate) {
      (where.date as Record<string, unknown>).lte = dateFilters.endDate;
    }
  }

  // Apply amount filter
  if (amountFilters?.exactAmount != null) {
    where.amount = amountFilters.exactAmount;
  } else if (amountFilters?.minAmount != null || amountFilters?.maxAmount != null) {
    where.amount = {};
    if (amountFilters.minAmount != null) {
      (where.amount as Record<string, unknown>).gte = amountFilters.minAmount;
    }
    if (amountFilters.maxAmount != null) {
      (where.amount as Record<string, unknown>).lte = amountFilters.maxAmount;
    }
  }

  const order = sortOptions?.sortOrder ?? "desc";
  const orderBy = buildOrderBy(sortOptions?.sortBy, order, TX_SORT_MAP, "date");

  const transactions = await prisma.transaction.findMany({
    where: where as any,
    take: limit,
    orderBy,
    select: {
      id: true,
      description: true,
      type: true,
      amount: true,
      date: true,
      notes: true,
      category: { select: { name: true } },
    },
  });

  return transactions.map((tx) => ({
    entity: "transactions" as const,
    id: tx.id,
    title: tx.description,
    subtitle: tx.category?.name ?? "",
    type: tx.type,
    amount: tx.amount,
    date: tx.date.toISOString().slice(0, 10),
    matchField: tx.description.toLowerCase().includes(keywords[0].toLowerCase())
      ? "description"
      : "notes",
    matchPreview: truncateMatch(tx.description, keywords.join(" ")),
  }));
}

async function searchCategories(
  userId: string,
  limit: number,
  keywords: string[],
  categoryFilters?: CategoryFilters,
  sortOptions?: SortOptions,
): Promise<SearchResultItem[]> {
  const where: Record<string, unknown> = { userId };
  Object.assign(where, buildMultiKeywordFilter(["name"], keywords));

  // Apply specific category IDs filter
  if (categoryFilters?.categoryIds && categoryFilters.categoryIds.length > 0) {
    where.id = { in: categoryFilters.categoryIds };
  }

  // For categoryType filter (income/expense), we need to find categories
  // that have at least one transaction of the given type
  if (categoryFilters?.categoryType) {
    const catIdsWithType = await prisma.transaction.groupBy({
      by: ["categoryId"],
      where: {
        userId,
        type: categoryFilters.categoryType as "INCOME" | "EXPENSE",
      },
      _count: { id: true },
    });
    const validIds = catIdsWithType.map((c) => c.categoryId);

    // Intersect with existing where.id if already filtered by categoryIds
    if (where.id) {
      const existingIds = where.id as { in: string[] };
      where.id = {
        in: existingIds.in.filter((id) => validIds.includes(id)),
      };
    } else {
      where.id = { in: validIds };
    }

    // If no matching categories, return empty early
    const idFilter = where.id as { in: string[] };
    if (idFilter.in.length === 0) return [];
  }

  const order = sortOptions?.sortOrder ?? "asc";
  const orderBy = buildOrderBy(sortOptions?.sortBy, order, CAT_SORT_MAP, "name");

  const categories = await prisma.category.findMany({
    where: where as any,
    take: limit,
    orderBy,
    select: {
      id: true,
      name: true,
      icon: true,
      color: true,
      isSystem: true,
    },
  });

  return categories.map((cat) => ({
    entity: "categories" as const,
    id: cat.id,
    title: cat.name,
    subtitle: cat.isSystem ? "System" : "Custom",
    type: "CATEGORY",
    matchField: "name",
    matchPreview: truncateMatch(cat.name, keywords.join(" ")),
  }));
}

async function searchPaymentMethods(
  userId: string,
  limit: number,
  keywords: string[],
  sortOptions?: SortOptions,
): Promise<SearchResultItem[]> {
  const where: Record<string, unknown> = { userId };
  Object.assign(where, buildMultiKeywordFilter(["name"], keywords));

  const order = sortOptions?.sortOrder ?? "asc";
  const orderBy = buildOrderBy(sortOptions?.sortBy, order, PM_SORT_MAP, "name");

  const methods = await prisma.paymentMethod.findMany({
    where: where as any,
    take: limit,
    orderBy,
    select: {
      id: true,
      name: true,
      type: true,
    },
  });

  return methods.map((pm) => ({
    entity: "payment-methods" as const,
    id: pm.id,
    title: pm.name,
    subtitle: pm.type ?? "",
    type: pm.type,
    matchField: "name",
    matchPreview: truncateMatch(pm.name, keywords.join(" ")),
  }));
}

async function searchBudgets(
  userId: string,
  limit: number,
  keywords: string[],
  categoryFilters?: CategoryFilters,
  dateFilters?: DateFilters,
  amountFilters?: AmountFilters,
  sortOptions?: SortOptions,
): Promise<SearchResultItem[]> {
  const where: Record<string, unknown> = { userId };

  // When explicit category IDs are provided, skip the keyword filter on the
  // linked category name — the category filter already narrows precisely, and
  // requiring both would wrongly exclude a budget whose category name doesn't
  // happen to contain the keyword (e.g. the "Food" budget for q="a").
  if (!categoryFilters?.categoryIds || categoryFilters.categoryIds.length === 0) {
    Object.assign(where, buildNestedKeywordFilter("category", "name", keywords));
  }

  // Apply category ID filter on the linked category
  if (categoryFilters?.categoryIds && categoryFilters.categoryIds.length > 0) {
    where.categoryId = { in: categoryFilters.categoryIds };
  }

  // Apply date range filter. NOTE: the Budget model has no `endDate` column
  // (only `startDate` + `period`), so match budgets whose period start falls
  // within the requested range. (Writing an invalid `endDate` filter here made
  // every date-filtered search return a 500 via PrismaClientValidationError.)
  if (dateFilters?.startDate || dateFilters?.endDate) {
    const startDateFilter: Record<string, unknown> = {};
    if (dateFilters.startDate) {
      startDateFilter.gte = dateFilters.startDate;
    }
    if (dateFilters.endDate) {
      startDateFilter.lte = dateFilters.endDate;
    }
    where.startDate = startDateFilter;
  }

  // Apply amount filter (budgets use targetAmount)
  if (amountFilters?.exactAmount != null) {
    where.targetAmount = amountFilters.exactAmount;
  } else if (amountFilters?.minAmount != null || amountFilters?.maxAmount != null) {
    where.targetAmount = {};
    if (amountFilters.minAmount != null) {
      (where.targetAmount as Record<string, unknown>).gte = amountFilters.minAmount;
    }
    if (amountFilters.maxAmount != null) {
      (where.targetAmount as Record<string, unknown>).lte = amountFilters.maxAmount;
    }
  }

  const order = sortOptions?.sortOrder ?? "desc";
  const orderBy = buildOrderBy(sortOptions?.sortBy, order, BUDGET_SORT_MAP, "startDate");

  const budgets = await prisma.budget.findMany({
    where: where as any,
    take: limit,
    orderBy,
    select: {
      id: true,
      targetAmount: true,
      period: true,
      startDate: true,
      category: { select: { name: true } },
    },
  });

  return budgets.map((budget) => ({
    entity: "budgets" as const,
    id: budget.id,
    title: budget.category.name,
    subtitle: `${budget.period} — $${budget.targetAmount.toFixed(2)}`,
    type: budget.period,
    amount: budget.targetAmount,
    date: budget.startDate.toISOString().slice(0, 10),
    matchField: "category.name",
    matchPreview: truncateMatch(budget.category.name, keywords.join(" ")),
  }));
}

async function searchSavingsGoals(
  userId: string,
  limit: number,
  keywords: string[],
  dateFilters?: DateFilters,
  sortOptions?: SortOptions,
): Promise<SearchResultItem[]> {
  const where: Record<string, unknown> = { userId };
  Object.assign(where, buildMultiKeywordFilter(["name"], keywords));

  // Apply date range filter (savings goals have deadline)
  if (dateFilters?.startDate || dateFilters?.endDate) {
    if (dateFilters.startDate) {
      where.deadline = { gte: dateFilters.startDate };
    }
    if (dateFilters.endDate) {
      where.deadline = { ...((where.deadline as object) || {}), lte: dateFilters.endDate };
    }
  }

  const order = sortOptions?.sortOrder ?? "desc";
  const orderBy = buildOrderBy(sortOptions?.sortBy, order, GOAL_SORT_MAP, "createdAt");

  const goals = await prisma.savingsGoal.findMany({
    where: where as any,
    take: limit,
    orderBy,
    select: {
      id: true,
      name: true,
      targetAmount: true,
      currentAmount: true,
      deadline: true,
      priority: true,
      completedAt: true,
    },
  });

  return goals.map((goal) => {
    const progress =
      goal.targetAmount > 0 ? Math.round((goal.currentAmount / goal.targetAmount) * 100) : 0;
    return {
      entity: "savings-goals" as const,
      id: goal.id,
      title: goal.name,
      subtitle: `$${goal.currentAmount.toFixed(2)} / $${goal.targetAmount.toFixed(2)} (${progress}%)`,
      type: goal.priority ?? "MEDIUM",
      amount: goal.targetAmount,
      date: goal.deadline?.toISOString().slice(0, 10),
      status: goal.completedAt ? "Completed" : "In Progress",
      matchField: "name",
      matchPreview: truncateMatch(goal.name, keywords.join(" ")),
    };
  });
}

// ─── Suggestions Repository ───────────────────────────────────

const suggestionsRepository = {
  /**
   * Find matching category names for autocomplete suggestions.
   * Returns at most `limit` results, ordered by name.
   */
  async findCategorySuggestions(
    userId: string,
    searchTerm: string,
    limit: number,
  ): Promise<Array<{ id: string; name: string; icon: string; color: string }>> {
    const categories = await prisma.category.findMany({
      where: {
        userId,
        name: { contains: searchTerm, mode: "insensitive" },
      },
      take: limit,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        icon: true,
        color: true,
      },
    });
    return categories;
  },

  /**
   * Find matching payment method names for autocomplete suggestions.
   * Returns at most `limit` results, ordered by name.
   */
  async findPaymentMethodSuggestions(
    userId: string,
    searchTerm: string,
    limit: number,
  ): Promise<Array<{ id: string; name: string; icon: string; color: string }>> {
    const methods = await prisma.paymentMethod.findMany({
      where: {
        userId,
        name: { contains: searchTerm, mode: "insensitive" },
      },
      take: limit,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        icon: true,
        color: true,
      },
    });
    return methods;
  },

  /**
   * Find distinct matching transaction descriptions for autocomplete suggestions.
   * Uses Prisma `distinct` to get unique descriptions in a single query.
   * Returns at most `limit` results, ordered by most recent transaction date descending.
   */
  async findTransactionTitleSuggestions(
    userId: string,
    searchTerm: string,
    limit: number,
  ): Promise<Array<{ id: string; description: string }>> {
    const txs = await prisma.transaction.findMany({
      where: {
        userId,
        description: { contains: searchTerm, mode: "insensitive" },
      },
      distinct: ["description"],
      take: limit,
      orderBy: { date: "desc" },
      select: { id: true, description: true },
    });

    return txs;
  },
};

export { suggestionsRepository };

// ─── Helper ───────────────────────────────────────────────────

/**
 * Truncate text around the search term match, showing context.
 * E.g. "I bought some groceries at the store" → "…bought some groceries at…"
 */
function truncateMatch(text: string, searchTerm: string, contextChars: number = 40): string {
  const lowerText = text.toLowerCase();
  const lowerTerm = searchTerm.toLowerCase();
  const idx = lowerText.indexOf(lowerTerm);

  if (idx === -1) return text.length > 60 ? text.slice(0, 57) + "..." : text;

  const start = Math.max(0, idx - contextChars);
  const end = Math.min(text.length, idx + searchTerm.length + contextChars);

  let preview = text.slice(start, end);
  if (start > 0) preview = "..." + preview;
  if (end < text.length) preview = preview + "...";

  return preview;
}
