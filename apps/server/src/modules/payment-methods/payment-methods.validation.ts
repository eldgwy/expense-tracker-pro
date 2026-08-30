import { z } from "zod";
import { nameSchema, hexColorSchema } from "../../common/validators/index.js";
import { PAYMENT_METHOD_ICONS, PAYMENT_METHOD_COLORS } from "../../common/constants/index.js";

const iconSchema = z
  .string()
  .refine((val) => (PAYMENT_METHOD_ICONS as readonly string[]).includes(val), {
    message: `Icon must be one of: ${PAYMENT_METHOD_ICONS.join(", ")}`,
  });

const paymentMethodColorSchema = hexColorSchema.refine(
  (val) => (PAYMENT_METHOD_COLORS as readonly string[]).includes(val.toUpperCase()),
  {
    message: `Color should be one of the suggested palette: ${PAYMENT_METHOD_COLORS.join(", ")}`,
  },
);

export const createPaymentMethodSchema = z.object({
  type: z.enum(["CREDIT_CARD", "DEBIT_CARD", "CASH", "BANK_TRANSFER", "DIGITAL_WALLET"]),
  name: nameSchema,
  icon: iconSchema.optional(),
  color: paymentMethodColorSchema.optional(),
  isDefault: z.boolean().optional(),
  lastFour: z
    .string()
    .regex(/^\d{4}$/, "Last four digits must be exactly 4 digits")
    .optional()
    .nullable(),
});

export const updatePaymentMethodSchema = createPaymentMethodSchema.partial();
