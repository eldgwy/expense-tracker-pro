import { z } from "zod";
import { SEARCHABLE_ENTITIES } from "./search.types.js";

/** UUID format regex */
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse a comma-separated string into an array of trimmed values */
const commaSeparatedList = (maxItems: number) =>
  z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      return val
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, maxItems);
    });

export const globalSearchQuerySchema = z
  .object({
    q: z
      .string()
      .min(1, "Search query is required")
      .max(200, "Search query must be 200 characters or less")
      .transform((s) => s.trim()),
    entities: z
      .string()
      .optional()
      .transform((val) => {
        if (!val) return undefined;
        return val
          .split(",")
          .map((e) => e.trim().toLowerCase())
          .filter((e) => (SEARCHABLE_ENTITIES as readonly string[]).includes(e));
      })
      .pipe(
        z
          .array(z.enum(SEARCHABLE_ENTITIES as unknown as [string, ...string[]]))
          .min(1)
          .max(5)
          .optional(),
      ),
    limit: z
      .string()
      .regex(/^\d+$/, "Invalid limit")
      .transform(Number)
      .pipe(z.number().int().positive().max(50).optional())
      .optional(),
    categoryIds: commaSeparatedList(20).pipe(
      z.array(z.string().regex(uuidRegex, "Invalid category UUID")).min(1).max(20).optional(),
    ),
    categoryType: z
      .enum(["income", "expense"])
      .optional()
      .transform((val) => (val ? val.toUpperCase() : undefined)),
    datePreset: z
      .enum([
        "today",
        "yesterday",
        "this_week",
        "last_week",
        "this_month",
        "last_month",
        "this_year",
      ])
      .optional(),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)")
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)")
      .optional(),
    sortBy: z.enum(["date", "amount", "title", "category", "created_at", "updated_at"]).optional(),
    sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
    minAmount: z
      .string()
      .regex(
        /^\d+(\.\d{1,2})?$/,
        "Invalid minAmount (must be a positive number with up to 2 decimals)",
      )
      .transform(Number)
      .pipe(z.number().nonnegative().max(9999999.99).optional())
      .optional(),
    maxAmount: z
      .string()
      .regex(
        /^\d+(\.\d{1,2})?$/,
        "Invalid maxAmount (must be a positive number with up to 2 decimals)",
      )
      .transform(Number)
      .pipe(z.number().nonnegative().max(9999999.99).optional())
      .optional(),
    exactAmount: z
      .string()
      .regex(
        /^\d+(\.\d{1,2})?$/,
        "Invalid exactAmount (must be a positive number with up to 2 decimals)",
      )
      .transform(Number)
      .pipe(z.number().nonnegative().max(9999999.99).optional())
      .optional(),
  })
  .refine(
    (data) => {
      // Cannot use exactAmount with minAmount or maxAmount
      if (data.exactAmount != null && (data.minAmount != null || data.maxAmount != null)) {
        return false;
      }
      return true;
    },
    {
      message: "Cannot use exactAmount with minAmount or maxAmount. Choose either exact or range.",
      path: ["exactAmount"],
    },
  )
  .refine(
    (data) => {
      // minAmount must be less than or equal to maxAmount
      if (data.minAmount != null && data.maxAmount != null && data.minAmount > data.maxAmount) {
        return false;
      }
      return true;
    },
    {
      message: "minAmount must be less than or equal to maxAmount",
      path: ["minAmount"],
    },
  )
  .refine(
    (data) => {
      // Cannot use both datePreset and custom date range
      if (data.datePreset && (data.startDate || data.endDate)) {
        return false;
      }
      return true;
    },
    {
      message: "Cannot use datePreset with startDate or endDate. Choose one.",
      path: ["datePreset"],
    },
  )
  .refine(
    (data) => {
      // If startDate is provided, endDate must also be provided
      if (data.startDate && !data.endDate) {
        return false;
      }
      return true;
    },
    {
      message: "endDate is required when startDate is provided",
      path: ["endDate"],
    },
  )
  .refine(
    (data) => {
      // If endDate is provided, startDate must also be provided
      if (data.endDate && !data.startDate) {
        return false;
      }
      return true;
    },
    {
      message: "startDate is required when endDate is provided",
      path: ["startDate"],
    },
  );

export type GlobalSearchQueryInput = z.infer<typeof globalSearchQuerySchema>;

// ─── Search Suggestions Schema ───────────────────────────────

export const searchSuggestionsSchema = z.object({
  q: z
    .string()
    .min(2, "Suggestion query must be at least 2 characters")
    .max(100, "Suggestion query must be 100 characters or less")
    .transform((s) => s.trim()),
  limit: z
    .string()
    .regex(/^\d+$/, "Invalid limit")
    .transform(Number)
    .pipe(z.number().int().positive().max(10).optional())
    .optional(),
});

export type SearchSuggestionsInput = z.infer<typeof searchSuggestionsSchema>;
