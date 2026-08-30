import { paymentMethodRepository } from "./payment-methods.repository.js";
import type { PaymentMethodStats } from "./payment-methods.repository.js";
import { NotFoundError, ConflictError, ValidationError } from "../../common/errors/index.js";

export type { PaymentMethodStats };

export const paymentMethodService = {
  async findAll(userId: string) {
    return paymentMethodRepository.findAllByUser(userId);
  },

  async findById(userId: string, id: string) {
    const pm = await paymentMethodRepository.findById(id);
    if (!pm || pm.userId !== userId) {
      throw new NotFoundError("Payment method not found");
    }
    const stats = await paymentMethodRepository.findTransactionStats(id);
    return { ...pm, stats };
  },

  async create(userId: string, data: Parameters<typeof paymentMethodRepository.create>[1]) {
    // Check for duplicate name
    const existing = await paymentMethodRepository.findByName(userId, data.name);
    if (existing) {
      throw new ConflictError("A payment method with this name already exists");
    }
    return paymentMethodRepository.create(userId, data);
  },

  async update(
    userId: string,
    id: string,
    data: Parameters<typeof paymentMethodRepository.update>[1],
  ) {
    const pm = await paymentMethodRepository.findById(id);
    if (!pm || pm.userId !== userId) {
      throw new NotFoundError("Payment method not found");
    }

    // Check for duplicate name (excluding the current method)
    if (data.name && data.name !== pm.name) {
      const existing = await paymentMethodRepository.findByName(userId, data.name);
      if (existing) {
        throw new ConflictError("A payment method with this name already exists");
      }
    }

    return paymentMethodRepository.update(id, data);
  },

  async delete(userId: string, id: string) {
    const pm = await paymentMethodRepository.findById(id);
    if (!pm || pm.userId !== userId) {
      throw new NotFoundError("Payment method not found");
    }

    // Prevent deletion if linked to transactions
    const transactionCount = await paymentMethodRepository.countTransactions(id);
    if (transactionCount > 0) {
      throw new ValidationError(
        `Cannot delete "${pm.name}": ${transactionCount} transaction(s) are using this payment method. Reassign them first.`,
      );
    }

    return paymentMethodRepository.delete(id);
  },
};
