import type { Response, NextFunction } from "express";
import { paymentMethodService } from "./payment-methods.service.js";
import { sendSuccess, sendCreated, sendNoContent } from "../../common/responses/index.js";
import type { AuthenticatedRequest } from "../../common/types/index.js";

export const paymentMethodController = {
  async findAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const paymentMethods = await paymentMethodService.findAll(req.user.id);
      sendSuccess(res, { paymentMethods });
    } catch (err) {
      next(err);
    }
  },

  async findById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const paymentMethod = await paymentMethodService.findById(
        req.user.id,
        req.params.id as string,
      );
      sendSuccess(res, { paymentMethod });
    } catch (err) {
      next(err);
    }
  },

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const paymentMethod = await paymentMethodService.create(req.user.id, req.body);
      sendCreated(res, { paymentMethod });
    } catch (err) {
      next(err);
    }
  },

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const paymentMethod = await paymentMethodService.update(
        req.user.id,
        req.params.id as string,
        req.body,
      );
      sendSuccess(res, { paymentMethod });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await paymentMethodService.delete(req.user.id, req.params.id as string);
      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  },
};
