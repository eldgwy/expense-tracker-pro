import { z } from "zod";
import { nameSchema, hexColorSchema } from "../../common/validators/index.js";
import { CATEGORY_ICONS, CATEGORY_COLORS } from "../../common/constants/index.js";

const iconSchema = z.string().refine((val) => (CATEGORY_ICONS as readonly string[]).includes(val), {
  message: `Icon must be one of: ${CATEGORY_ICONS.join(", ")}`,
});

/**
 * Validates a category color value:
 * - Must be a valid 6-character hex color (#RRGGBB).
 * - Should match one of the suggested CATEGORY_COLORS for consistency.
 */
const categoryColorSchema = hexColorSchema.refine(
  (val) => (CATEGORY_COLORS as readonly string[]).includes(val.toUpperCase()),
  {
    message: `Color should be one of the suggested palette: ${CATEGORY_COLORS.join(", ")}`,
  },
);

export const createCategorySchema = z.object({
  name: nameSchema,
  icon: iconSchema.optional(),
  color: categoryColorSchema.optional(),
});

export const updateCategorySchema = z.object({
  name: nameSchema.optional(),
  icon: iconSchema.optional(),
  color: categoryColorSchema.optional(),
});
