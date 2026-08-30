import type { DateRangePreset } from "../types/index.js";

/**
 * Pick specific keys from an object, returning a new partial object.
 */
export function pick<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[],
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Omit specific keys from an object, returning a new object.
 */
export function omit<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[],
): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}

/**
 * Calculate pagination offset from page and limit.
 */
export function paginate(page: number, limit: number): { skip: number; take: number } {
  return {
    skip: (page - 1) * limit,
    take: limit,
  };
}

/**
 * Generate a random numeric code of given length.
 */
export function generateCode(length: number): string {
  const digits = "0123456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += digits[Math.floor(Math.random() * digits.length)];
  }
  return code;
}

/**
 * Format a number as currency string.
 */
export function formatCurrency(amount: number, currency = "USD", locale = "en-US"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amount);
}

/**
 * Safely parse JSON, returning undefined on failure.
 */
export function safeJsonParse<T = unknown>(json: string): T | undefined {
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}

// ─── Date Range Helper ────────────────────────────────────────

/**
 * Compute start and end dates from a date range preset.
 */
export function computeDateRange(
  preset: DateRangePreset,
  customStart?: string,
  customEnd?: string,
): { startDate: Date; endDate: Date } {
  const now = new Date();

  switch (preset) {
    case "today": {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      return { startDate: start, endDate: end };
    }

    case "this_week": {
      const dayOfWeek = now.getDay();
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday start
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
      const end = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + (6 - diff),
        23,
        59,
        59,
        999,
      );
      return { startDate: start, endDate: end };
    }

    case "this_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      return { startDate: start, endDate: end };
    }

    case "last_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { startDate: start, endDate: end };
    }

    case "this_year": {
      const start = new Date(now.getFullYear(), 0, 1);
      const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      return { startDate: start, endDate: end };
    }

    case "custom": {
      const start = customStart
        ? new Date(`${customStart}T00:00:00.000Z`)
        : new Date(now.getFullYear(), now.getMonth(), 1);
      const end = customEnd
        ? new Date(`${customEnd}T23:59:59.999Z`)
        : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      return { startDate: start, endDate: end };
    }

    default:
      return {
        startDate: new Date(now.getFullYear(), now.getMonth() - 11, 1),
        endDate: now,
      };
  }
}

/**
 * Build a Prisma date filter from a date range.
 */
export function buildDateFilter(
  range: { startDate?: Date; endDate?: Date } | null,
): Record<string, unknown> {
  if (!range) return {};
  const filter: Record<string, unknown> = {};
  if (range.startDate) filter.gte = range.startDate;
  if (range.endDate) filter.lte = range.endDate;
  return Object.keys(filter).length > 0 ? { date: filter } : {};
}
