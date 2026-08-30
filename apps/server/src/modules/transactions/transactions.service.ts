import { transactionRepository } from "./transactions.repository.js";
import { categoryRepository } from "../categories/categories.repository.js";
import { paymentMethodRepository } from "../payment-methods/payment-methods.repository.js";
import { NotFoundError, ValidationError } from "../../common/errors/index.js";
import { paginate } from "../../common/utils/index.js";
import { deleteReceiptFile } from "../../common/utils/upload.js";

export const transactionService = {
  async findAll(
    userId: string,
    filters: {
      page?: number;
      limit?: number;
      type?: string;
      categoryId?: string;
      paymentMethodId?: string;
      minAmount?: number;
      maxAmount?: number;
      startDate?: string;
      endDate?: string;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      search?: string;
    } = {},
  ) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const { skip, take } = paginate(page, limit);

    const { data, total } = await transactionRepository.findAllByUser(userId, {
      skip,
      take,
      type: filters.type,
      categoryId: filters.categoryId,
      paymentMethodId: filters.paymentMethodId,
      minAmount: filters.minAmount,
      maxAmount: filters.maxAmount,
      startDate: filters.startDate ? new Date(filters.startDate) : undefined,
      endDate: filters.endDate ? new Date(filters.endDate) : undefined,
      sortBy: filters.sortBy,
      sortOrder: filters.sortOrder,
      search: filters.search,
    });

    return { data, total, page, limit };
  },

  async findById(userId: string, id: string) {
    const transaction = await transactionRepository.findById(id);
    if (!transaction || transaction.userId !== userId) {
      throw new NotFoundError("Transaction not found");
    }
    return transaction;
  },

  async create(
    userId: string,
    data: {
      type: string;
      amount: number;
      description: string;
      date: string;
      notes?: string;
      categoryId: string;
      paymentMethodId?: string | null;
    },
  ) {
    // Validate amount
    if (data.amount <= 0) {
      throw new ValidationError("Amount must be positive");
    }

    // Validate category exists and belongs to the user
    const category = await categoryRepository.findById(data.categoryId);
    if (!category) {
      throw new ValidationError("Category not found");
    }
    if (category.userId !== userId) {
      throw new ValidationError("Category does not belong to this user");
    }

    // Validate payment method (if provided) exists and belongs to the user
    if (data.paymentMethodId) {
      const pm = await paymentMethodRepository.findById(data.paymentMethodId);
      if (!pm) {
        throw new ValidationError("Payment method not found");
      }
      if (pm.userId !== userId) {
        throw new ValidationError("Payment method does not belong to this user");
      }
    }

    // Construct Prisma create data (repository handles final userId injection)
    const createData = {
      type: data.type,
      amount: data.amount,
      description: data.description,
      date: new Date(data.date),
      notes: data.notes ?? null,
      category: { connect: { id: data.categoryId } },
      paymentMethod: data.paymentMethodId ? { connect: { id: data.paymentMethodId } } : undefined,
    };

    return transactionRepository.create(userId, createData);
  },

  async update(userId: string, id: string, data: Record<string, unknown>) {
    const transaction = await transactionRepository.findById(id);
    if (!transaction || transaction.userId !== userId) {
      throw new NotFoundError("Transaction not found");
    }

    // If categoryId is being updated, validate ownership
    if (data.categoryId) {
      const category = await categoryRepository.findById(data.categoryId as string);
      if (!category) {
        throw new ValidationError("Category not found");
      }
      if (category.userId !== userId) {
        throw new ValidationError("Category does not belong to this user");
      }
    }

    // If paymentMethodId is being updated, validate ownership
    if (data.paymentMethodId) {
      const pm = await paymentMethodRepository.findById(data.paymentMethodId as string);
      if (!pm) {
        throw new ValidationError("Payment method not found");
      }
      if (pm.userId !== userId) {
        throw new ValidationError("Payment method does not belong to this user");
      }
    }

    return transactionRepository.update(id, data);
  },

  async uploadReceipt(userId: string, id: string, receiptUrl: string) {
    const transaction = await transactionRepository.findById(id);
    if (!transaction || transaction.userId !== userId) {
      throw new NotFoundError("Transaction not found");
    }

    // Delete old receipt file from disk if it exists
    if (transaction.receiptUrl) {
      await deleteReceiptFile(transaction.receiptUrl);
    }

    return transactionRepository.update(id, { receiptUrl });
  },

  async removeReceipt(userId: string, id: string) {
    const transaction = await transactionRepository.findById(id);
    if (!transaction || transaction.userId !== userId) {
      throw new NotFoundError("Transaction not found");
    }

    // Delete receipt file from disk
    if (transaction.receiptUrl) {
      await deleteReceiptFile(transaction.receiptUrl);
    }

    return transactionRepository.update(id, { receiptUrl: null });
  },

  async bulkDelete(userId: string, ids: string[]) {
    // Fetch transactions to clean up receipt files
    const transactions = await transactionRepository.findManyByIds(ids);

    // Verify ownership of all transactions
    const ownedIds = transactions.filter((t) => t.userId === userId).map((t) => t.id);

    if (ownedIds.length === 0) {
      throw new NotFoundError("No transactions found to delete");
    }

    // Clean up receipt files
    for (const txn of transactions) {
      if (txn.userId === userId && txn.receiptUrl) {
        await deleteReceiptFile(txn.receiptUrl).catch(() => {});
      }
    }

    const result = await transactionRepository.deleteMany(ownedIds, userId);
    return { count: result.count };
  },

  async bulkUpdate(
    userId: string,
    ids: string[],
    data: {
      categoryId?: string;
      paymentMethodId?: string | null;
    },
  ) {
    // Validate category ownership if updating
    if (data.categoryId) {
      const category = await categoryRepository.findById(data.categoryId);
      if (!category) {
        throw new ValidationError("Category not found");
      }
      if (category.userId !== userId) {
        throw new ValidationError("Category does not belong to this user");
      }
    }

    // Validate payment method ownership if updating
    if (data.paymentMethodId) {
      const pm = await paymentMethodRepository.findById(data.paymentMethodId);
      if (!pm) {
        throw new ValidationError("Payment method not found");
      }
      if (pm.userId !== userId) {
        throw new ValidationError("Payment method does not belong to this user");
      }
    }

    // If paymentMethodId is explicitly null, set it to null (clear payment method)
    const updateData: Record<string, unknown> = {};
    if (data.categoryId) updateData.categoryId = data.categoryId;
    if (data.paymentMethodId !== undefined) updateData.paymentMethodId = data.paymentMethodId;

    if (Object.keys(updateData).length === 0) {
      throw new ValidationError("No fields to update");
    }

    const result = await transactionRepository.updateMany(ids, userId, updateData);
    return { count: result.count };
  },

  async delete(userId: string, id: string) {
    const transaction = await transactionRepository.findById(id);
    if (!transaction || transaction.userId !== userId) {
      throw new NotFoundError("Transaction not found");
    }

    // Clean up receipt file from disk if it exists
    if (transaction.receiptUrl) {
      await deleteReceiptFile(transaction.receiptUrl);
    }

    return transactionRepository.delete(id);
  },

  async getSummary(
    userId: string,
    filters: {
      startDate?: string;
      endDate?: string;
      type?: string;
      categoryId?: string;
      paymentMethodId?: string;
      minAmount?: number;
      maxAmount?: number;
      search?: string;
    } = {},
  ) {
    return transactionRepository.getSummary(userId, {
      startDate: filters.startDate ? new Date(filters.startDate) : undefined,
      endDate: filters.endDate ? new Date(filters.endDate) : undefined,
      type: filters.type,
      categoryId: filters.categoryId,
      paymentMethodId: filters.paymentMethodId,
      minAmount: filters.minAmount,
      maxAmount: filters.maxAmount,
      search: filters.search,
    });
  },
};
