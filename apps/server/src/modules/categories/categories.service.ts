import { categoryRepository } from "./categories.repository.js";
import { NotFoundError, ConflictError, ValidationError } from "../../common/errors/index.js";

export const categoryService = {
  async findAll(userId: string, query?: string) {
    return categoryRepository.findAllByUser(userId, query);
  },

  async findById(userId: string, id: string) {
    const category = await categoryRepository.findById(id);
    if (!category || category.userId !== userId) {
      throw new NotFoundError("Category not found");
    }
    return category;
  },

  async create(userId: string, data: Parameters<typeof categoryRepository.create>[1]) {
    // Check for duplicate name
    const existing = await categoryRepository.findByName(userId, data.name);
    if (existing) {
      throw new ConflictError("A category with this name already exists");
    }
    return categoryRepository.create(userId, data);
  },

  async update(userId: string, id: string, data: { name?: string; icon?: string; color?: string }) {
    const category = await categoryRepository.findById(id);
    if (!category || category.userId !== userId) {
      throw new NotFoundError("Category not found");
    }
    if (category.isSystem && data.name && data.name !== category.name) {
      throw new ValidationError("Cannot rename a system category");
    }

    // Check for duplicate name (excluding the current category)
    if (data.name && data.name !== category.name) {
      const existing = await categoryRepository.findByName(userId, data.name);
      if (existing) {
        throw new ConflictError("A category with this name already exists");
      }
    }

    return categoryRepository.update(id, data);
  },

  async delete(userId: string, id: string) {
    const category = await categoryRepository.findById(id);
    if (!category || category.userId !== userId) {
      throw new NotFoundError("Category not found");
    }
    if (category.isSystem) {
      throw new ValidationError("Cannot delete a system category");
    }

    // Check for related transactions — prevent deletion to maintain data integrity
    if (category.transactionCount > 0) {
      throw new ValidationError(
        `Cannot delete "${category.name}": ${category.transactionCount} transaction(s) are using this category. Reassign them first.`,
      );
    }

    // Delete related budgets first (they have a required foreign key to category)
    await categoryRepository.deleteBudgetsByCategory(id);

    return categoryRepository.delete(id);
  },
};
