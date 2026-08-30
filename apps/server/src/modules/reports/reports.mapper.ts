import { MONTH_NAMES } from "./reports.constants.js";
import type { CategorySummaryItem } from "./reports.types.js";

interface TransactionWithCategory {
  id: string;
  amount: number;
  date: Date;
  description: string;
  type: string;
  categoryId: string;
  category: { id: string; name: string; color: string; icon: string };
}

/**
 * Group transactions by category and compute per-category totals.
 */
function groupTransactionsByCategory(transactions: TransactionWithCategory[]): {
  categories: CategorySummaryItem[];
  grandTotal: number;
} {
  const categoryMap = new Map<string, CategorySummaryItem>();

  for (const tx of transactions) {
    const key = tx.categoryId;
    if (!categoryMap.has(key)) {
      categoryMap.set(key, {
        categoryId: tx.categoryId,
        categoryName: tx.category.name,
        categoryColor: tx.category.color,
        categoryIcon: tx.category.icon,
        total: 0,
        count: 0,
        percentage: 0,
        transactions: [],
      });
    }
    const entry = categoryMap.get(key)!;
    entry.total += tx.amount;
    entry.count += 1;
    entry.transactions.push({
      amount: tx.amount,
      date: tx.date,
      description: tx.description,
    });
  }

  const categories = Array.from(categoryMap.values());
  const grandTotal = categories.reduce((sum, cat) => sum + cat.total, 0);

  // Compute percentages
  const categoriesWithPercentages = categories.map((cat) => ({
    ...cat,
    percentage: grandTotal > 0 ? Math.round((cat.total / grandTotal) * 100) : 0,
  }));

  return { categories: categoriesWithPercentages, grandTotal };
}

/**
 * Build a monthly income/expense map for a set of transactions.
 */
function buildMonthlyMap(
  transactions: Array<{ amount: number; date: Date; type: string }>,
  year: number,
): Array<{ month: string; income: number; expense: number; net: number }> {
  const monthlyData: Record<string, { income: number; expense: number; net: number }> = {};

  // Initialize all 12 months
  for (let month = 0; month < 12; month++) {
    const key = `${year}-${String(month + 1).padStart(2, "0")}`;
    monthlyData[key] = { income: 0, expense: 0, net: 0 };
  }

  // Aggregate by month
  for (const tx of transactions) {
    const key = `${tx.date.getFullYear()}-${String(tx.date.getMonth() + 1).padStart(2, "0")}`;
    if (monthlyData[key]) {
      if (tx.type === "INCOME") monthlyData[key].income += tx.amount;
      else if (tx.type === "EXPENSE") monthlyData[key].expense += tx.amount;
    }
  }

  // Compute net and format
  return Object.entries(monthlyData).map(([month, data]) => ({
    month,
    ...data,
    net: data.income - data.expense,
  }));
}

/**
 * Format a period label like "Jul 2026".
 */
function formatPeriodLabel(period: string): string {
  const [year, monthNum] = period.split("-");
  const monthIndex = parseInt(monthNum, 10) - 1;
  return `${MONTH_NAMES[monthIndex]} ${year}`;
}

export const reportMapper = {
  groupTransactionsByCategory,
  buildMonthlyMap,
  formatPeriodLabel,
};
