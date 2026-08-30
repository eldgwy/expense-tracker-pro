import { z } from "zod";
import { nameSchema, hexColorSchema } from "../../common/validators/index.js";

const goalPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const createSavingsGoalSchema = z.object({
  name: nameSchema,
  targetAmount: z.number().positive("Target amount must be positive"),
  currentAmount: z.number().min(0).optional(),
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)")
    .optional(),
  priority: goalPrioritySchema.optional(),
  icon: z.string().min(1).max(50).optional(),
  color: hexColorSchema.optional(),
});

export const updateSavingsGoalSchema = createSavingsGoalSchema.partial();

export const savingsGoalQuerySchema = z.object({
  status: z.enum(["active", "completed"]).optional(),
  priority: goalPrioritySchema.optional(),
  sortBy: z
    .enum(["deadline", "targetAmount", "priority", "createdAt", "currentAmount"])
    .optional()
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
});

export const addProgressSchema = z.object({
  amount: z.number().positive("Progress amount must be positive"),
  allowExceed: z.boolean().optional(),
});

export const withdrawProgressSchema = z.object({
  amount: z.number().positive("Withdrawal amount must be positive"),
});
