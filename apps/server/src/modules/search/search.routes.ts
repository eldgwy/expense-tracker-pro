import { Router } from "express";
import { searchController } from "./search.controller.js";
import { validate, asyncHandler } from "../../common/middleware/index.js";
import { globalSearchQuerySchema, searchSuggestionsSchema } from "./search.validation.js";
import { authMiddleware } from "../../common/middleware/auth.js";

const router: Router = Router();

/**
 * GET /api/v1/search/suggestions?q=partial&limit=5
 *
 * Autocomplete suggestions while the user is typing.
 * Requires authentication.
 * - q: partial search query (required, min 2 chars, max 100 chars)
 * - limit: max suggestions per group (optional, default 5, max 10)
 */
router.get(
  "/suggestions",
  validate(searchSuggestionsSchema, "query"),
  authMiddleware,
  asyncHandler(searchController.suggestions),
);

/**
 * GET /api/v1/search?q=keyword&entities=transactions,categories&limit=10
 *
 * Global search across the user's data entities.
 * Requires authentication.
 * - q: search query (required, min 1 char, max 200 chars)
 * - entities: comma-separated list of entities to search (optional, defaults to all)
 * - limit: max results per entity (optional, default 10, max 50)
 */
router.get(
  "/",
  validate(globalSearchQuerySchema, "query"),
  authMiddleware,
  asyncHandler(searchController.globalSearch),
);

export { router as searchRoutes };
