import type { Response, NextFunction } from "express";
import { transactionService } from "./transactions.service.js";
import { sendSuccess, sendCreated, sendNoContent, sendMessage, buildPaginationMeta } from "../../common/responses/index.js";
import { getReceiptUrl } from "../../common/utils/upload.js";
import type { AuthenticatedRequest } from "../../common/types/index.js";

export const transactionController = {
  async findAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      // Query params are validated & parsed by the validate(transactionQuerySchema) middleware
      const {
        page,
        limit,
        type,
        categoryId,
        paymentMethodId,
        minAmount,
        maxAmount,
        startDate,
        endDate,
        sortBy,
        sortOrder,
        search,
      } = req.query as Record<string, string | undefined>;

      const result = await transactionService.findAll(req.user.id, {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        type,
        categoryId,
        paymentMethodId,
        minAmount: minAmount ? Number(minAmount) : undefined,
        maxAmount: maxAmount ? Number(maxAmount) : undefined,
        startDate,
        endDate,
        sortBy,
        sortOrder: sortOrder as "asc" | "desc" | undefined,
        search,
      });
      sendSuccess(
        res,
        { transactions: result.data },
        200,
        buildPaginationMeta(result.total, result.page, result.limit),
      );
    } catch (err) {
      next(err);
    }
  },

  async findById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const transaction = await transactionService.findById(req.user.id, req.params.id as string);
      sendSuccess(res, { transaction });
    } catch (err) {
      next(err);
    }
  },

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const transaction = await transactionService.create(req.user.id, req.body);
      sendCreated(res, { transaction });
    } catch (err) {
      next(err);
    }
  },

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const transaction = await transactionService.update(
        req.user.id,
        req.params.id as string,
        req.body,
      );
      sendSuccess(res, { transaction });
    } catch (err) {
      next(err);
    }
  },

  async uploadReceipt(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        return sendMessage(res, "No file uploaded", 400);
      }

      const receiptUrl = getReceiptUrl(req.file.filename);
      const transaction = await transactionService.uploadReceipt(
        req.user.id,
        req.params.id as string,
        receiptUrl,
      );

      sendSuccess(res, { transaction, receiptUrl });
    } catch (err) {
      next(err);
    }
  },

  async removeReceipt(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const transaction = await transactionService.removeReceipt(
        req.user.id,
        req.params.id as string,
      );
      sendSuccess(res, { transaction });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await transactionService.delete(req.user.id, req.params.id as string);
      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  },

  async bulkDelete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { ids } = req.body as { ids: string[] };
      const result = await transactionService.bulkDelete(req.user.id, ids);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  },

  async bulkUpdate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { ids, categoryId, paymentMethodId } = req.body as {
        ids: string[];
        categoryId?: string;
        paymentMethodId?: string | null;
      };
      const result = await transactionService.bulkUpdate(req.user.id, ids, {
        categoryId,
        paymentMethodId,
      });
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  },

  async getSummary(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const {
        startDate,
        endDate,
        type,
        categoryId,
        paymentMethodId,
        minAmount,
        maxAmount,
        search,
      } = req.query as Record<string, string | undefined>;
      const summary = await transactionService.getSummary(req.user.id, {
        startDate,
        endDate,
        type,
        categoryId,
        paymentMethodId,
        minAmount: minAmount ? Number(minAmount) : undefined,
        maxAmount: maxAmount ? Number(maxAmount) : undefined,
        search,
      });
      sendSuccess(res, { summary });
    } catch (err) {
      next(err);
    }
  },
};
