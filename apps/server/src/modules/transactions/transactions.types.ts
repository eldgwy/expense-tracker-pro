import type { Transaction, Category, PaymentMethod } from "../../generated/prisma/client.js";

export type TransactionWithRelations = Transaction & {
  category: Category;
  paymentMethod: PaymentMethod | null;
};

export interface TransactionSummary {
  totalIncome: number;
  totalExpense: number;
  totalTransfer: number;
  netAmount: number;
  count: number;
}

export interface TransactionFilters {
  page?: number;
  limit?: number;
  type?: string;
  categoryId?: string;
  startDate?: string;
  endDate?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}
