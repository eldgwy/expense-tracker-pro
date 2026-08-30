import type { Response, NextFunction } from "express";
import { categoryService } from "./categories.service.js";
import { sendSuccess, sendCreated, sendNoContent } from "../../common/responses/index.js";
import type { AuthenticatedRequest } from "../../common/types/index.js";

export const categoryController = {
  async findAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const query = req.query.q as string | undefined;
      const categories = await categoryService.findAll(req.user.id, query);
      sendSuccess(res, { categories });
    } catch (err) {
      next(err);
    }
  },

  async findById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const category = await categoryService.findById(req.user.id, req.params.id as string);
      sendSuccess(res, { category });
    } catch (err) {
      next(err);
    }
  },

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const category = await categoryService.create(req.user.id, req.body);
      sendCreated(res, { category });
    } catch (err) {
      next(err);
    }
  },

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const category = await categoryService.update(req.user.id, req.params.id as string, req.body);
      sendSuccess(res, { category });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await categoryService.delete(req.user.id, req.params.id as string);
      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  },
};
