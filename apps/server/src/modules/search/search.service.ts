import { searchRepository, suggestionsRepository } from "./search.repository.js";
import type {
  GlobalSearchQuery,
  GlobalSearchResult,
  DatePreset,
  SortByField,
  SortOrder,
  SuggestionsResult,
  SuggestionGroup,
} from "./search.types.js";

/**
 * Compute a Date range from a DatePreset.
 */
function computeDateRange(preset: DatePreset): { start: Date; end: Date } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed
  const day = now.getDate();

  // Start of today (midnight)
  const startOfDay = (offset: number) => new Date(year, month, day + offset, 0, 0, 0, 0);
  const endOfDay = (offset: number) => new Date(year, month, day + offset, 23, 59, 59, 999);

  switch (preset) {
    case "today":
      return { start: startOfDay(0), end: endOfDay(0) };

    case "yesterday":
      return { start: startOfDay(-1), end: endOfDay(-1) };

    case "this_week": {
      const dayOfWeek = now.getDay(); // 0=Sun
      const sunday = dayOfWeek === 0 ? 0 : -dayOfWeek;
      const saturday = sunday + 6;
      return {
        start: startOfDay(sunday),
        end: endOfDay(saturday),
      };
    }

    case "last_week": {
      const dayOfWeek = now.getDay();
      const lastSunday = -(dayOfWeek + 7);
      const lastSaturday = lastSunday + 6;
      return {
        start: startOfDay(lastSunday),
        end: endOfDay(lastSaturday),
      };
    }

    case "this_month":
      return {
        start: new Date(year, month, 1, 0, 0, 0, 0),
        end: new Date(year, month + 1, 0, 23, 59, 59, 999),
      };

    case "last_month":
      return {
        start: new Date(year, month - 1, 1, 0, 0, 0, 0),
        end: new Date(year, month, 0, 23, 59, 59, 999),
      };

    case "this_year":
      return {
        start: new Date(year, 0, 1, 0, 0, 0, 0),
        end: new Date(year, 11, 31, 23, 59, 59, 999),
      };
  }
}

export const searchService = {
  /**
   * Perform a global search across all (or selected) entities.
   *
   * Searches are case-insensitive with partial matching across key text fields:
   * - Transactions: description, notes
   * - Categories: name
   * - Payment methods: name
   * - Budgets: category name (linked relation)
   * - Savings goals: name
   *
   * Results are grouped by entity with per-entity counts.
   */
  async globalSearch(userId: string, query: GlobalSearchQuery): Promise<GlobalSearchResult> {
    const {
      q,
      entities,
      limit,
      categoryIds,
      categoryType,
      datePreset,
      startDate,
      endDate,
      minAmount,
      maxAmount,
      exactAmount,
      sortBy,
      sortOrder,
    } = query;
    const perEntityLimit = limit ?? 10;

    // Compute date filters from preset or custom range
    let dateFilters: { startDate?: Date; endDate?: Date } | undefined;
    if (datePreset) {
      const range = computeDateRange(datePreset);
      dateFilters = { startDate: range.start, endDate: range.end };
    } else if (startDate || endDate) {
      dateFilters = {
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate + "T23:59:59.999Z") : undefined,
      };
    }

    // Build amount filters
    const amountFilters =
      minAmount != null || maxAmount != null || exactAmount != null
        ? { minAmount, maxAmount, exactAmount }
        : undefined;

    // Build sort options
    const sortOptions: { sortBy: SortByField; sortOrder: SortOrder } = {
      sortBy: sortBy ?? "date",
      sortOrder: sortOrder ?? "desc",
    };

    const results = await searchRepository.searchAll(
      userId,
      q,
      entities,
      perEntityLimit,
      { categoryIds, categoryType },
      dateFilters,
      amountFilters,
      sortOptions,
    );

    // Compute counts by entity
    const countsByEntity: Record<string, number> = {};
    for (const item of results) {
      countsByEntity[item.entity] = (countsByEntity[item.entity] ?? 0) + 1;
    }

    return {
      query: q,
      totalCount: results.length,
      results,
      countsByEntity,
    };
  },

  // ─── Search Suggestions ─────────────────────────────────────

  /**
   * Get autocomplete suggestions while the user is typing.
   *
   * Returns grouped suggestions from:
   * - Recent searches (from in-memory store)
   * - Matching categories (name contains query)
   * - Matching payment methods (name contains query)
   * - Matching transaction titles (description contains query)
   */
  async getSuggestions(userId: string, q: string, limit: number = 5): Promise<SuggestionsResult> {
    const groups: SuggestionGroup[] = [];

    // 1. Recent searches
    const recentItems = recentSearchStore.getRecent(userId, limit);
    if (recentItems.length > 0) {
      groups.push({
        entity: "recent-search",
        label: "Recent Searches",
        items: recentItems.map((term) => ({
          entity: "recent-search" as const,
          id: `recent-${term}`,
          label: term,
          icon: "Clock",
        })),
      });
    }

    // 2. Matching categories
    const categoryResults = await suggestionsRepository.findCategorySuggestions(userId, q, limit);
    if (categoryResults.length > 0) {
      groups.push({
        entity: "category",
        label: "Categories",
        items: categoryResults.map((cat) => ({
          entity: "category" as const,
          id: cat.id,
          label: cat.name,
          subtitle: "Category",
          icon: cat.icon,
          color: cat.color,
        })),
      });
    }

    // 3. Matching payment methods
    const pmResults = await suggestionsRepository.findPaymentMethodSuggestions(userId, q, limit);
    if (pmResults.length > 0) {
      groups.push({
        entity: "payment-method",
        label: "Payment Methods",
        items: pmResults.map((pm) => ({
          entity: "payment-method" as const,
          id: pm.id,
          label: pm.name,
          subtitle: "Payment Method",
          icon: pm.icon,
          color: pm.color,
        })),
      });
    }

    // 4. Matching transaction titles
    const txResults = await suggestionsRepository.findTransactionTitleSuggestions(userId, q, limit);
    if (txResults.length > 0) {
      groups.push({
        entity: "transaction-title",
        label: "Transactions",
        items: txResults.map((tx) => ({
          entity: "transaction-title" as const,
          id: tx.id,
          label: tx.description,
          subtitle: "Transaction",
          icon: "ArrowRightLeft",
        })),
      });
    }

    return {
      query: q,
      suggestions: groups,
    };
  },

  /**
   * Record a search query for recent search suggestions.
   */
  recordSearch(userId: string, query: string): void {
    recentSearchStore.add(userId, query);
  },
};

// ─── In-Memory Recent Search Store ────────────────────────────

interface RecentSearchStore {
  [userId: string]: string[];
}

const MAX_RECENT_SEARCHES = 10;

/**
 * Simple in-memory store tracking each user's recent search queries.
 * Persists for the lifetime of the server process.
 */
const recentSearchStore = {
  _store: {} as RecentSearchStore,

  /** Add a search term to the user's recent list (deduped, most recent first). */
  add(userId: string, query: string): void {
    if (!query.trim()) return;
    const normalized = query.trim().toLowerCase();

    if (!this._store[userId]) {
      this._store[userId] = [];
    }

    // Remove if already exists (to move it to front)
    this._store[userId] = this._store[userId].filter((s) => s !== normalized);

    // Add to front
    this._store[userId].unshift(normalized);

    // Trim to max
    if (this._store[userId].length > MAX_RECENT_SEARCHES) {
      this._store[userId] = this._store[userId].slice(0, MAX_RECENT_SEARCHES);
    }
  },

  /** Get recent searches for a user. */
  getRecent(userId: string, limit: number = 5): string[] {
    if (!this._store[userId]) return [];
    return this._store[userId].slice(0, limit);
  },
};
