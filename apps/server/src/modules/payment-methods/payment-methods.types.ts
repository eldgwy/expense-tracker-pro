import type { PaymentMethodType } from "../../generated/prisma/client.js";

export interface CreatePaymentMethodInput {
  name: string;
  type: PaymentMethodType;
  icon?: string;
  color?: string;
  isDefault?: boolean;
  lastFour?: string;
}

export interface UpdatePaymentMethodInput {
  name?: string;
  icon?: string;
  color?: string;
  isDefault?: boolean;
  lastFour?: string;
}
