import type { Response, NextFunction } from "express";
import { searchService } from "./search.service.js";
import type { AuthenticatedRequest } from "../../common/types/index.js";

export const searchController = {
  /**
   * GET /api/v1/search?q=keyword&entities=transactions,categories&limit=10
   *
   * Performs a case-insensitive partial-match search across the specified entities.
   * Query params are validated by the `validate` middleware before reaching here.
   * - q (string): search query
   * - entities (comma-separated string, optional): which entities to search
   * - limit (number, optional): max results per entity
   */
  async globalSearch(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      // Values are already parsed/transformed by the validate middleware
      const q = (req.query as any).q as string;
      const entities = (req.query as any).entities as string[] | undefined;
      const limit = (req.query as any).limit as number | undefined;
      const categoryIds = (req.query as any).categoryIds as string[] | undefined;
      const categoryType = (req.query as any).categoryType as string | undefined;
      const datePreset = (req.query as any).datePreset as string | undefined;
      const startDate = (req.query as any).startDate as string | undefined;
      const endDate = (req.query as any).endDate as string | undefined;
      const minAmount = (req.query as any).minAmount as number | undefined;
      const maxAmount = (req.query as any).maxAmount as number | undefined;
      const exactAmount = (req.query as any).exactAmount as number | undefined;
      const sortBy = (req.query as any).sortBy as string | undefined;
      const sortOrder = (req.query as any).sortOrder as string | undefined;

      // Record this search query for recent search suggestions
      searchService.recordSearch(req.user.id, q);

      const result = await searchService.globalSearch(req.user.id, {
        q,
        entities: entities as any,
        limit,
        categoryIds,
        categoryType: categoryType as any,
        datePreset: datePreset as any,
        startDate,
        endDate,
        minAmount,
        maxAmount,
        exactAmount,
        sortBy: sortBy as any,
        sortOrder: sortOrder as any,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/search/suggestions?q=partial&limit=5
   *
   * Returns grouped autocomplete suggestions while the user is typing.
   * Lightweight queries across categories, payment methods, and transaction titles.
   */
  async suggestions(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const q = (req.query as any).q as string;
      const limit = (req.query as any).limit as number | undefined;

      const result = await searchService.getSuggestions(req.user.id, q, limit);

      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },
};
