import { Router } from "express";
import { paymentMethodController } from "./payment-methods.controller.js";
import { validate, asyncHandler } from "../../common/middleware/index.js";
import { createPaymentMethodSchema, updatePaymentMethodSchema } from "./payment-methods.validation.js";
import { uuidParamSchema } from "../../common/validators/index.js";
import { authMiddleware } from "../../common/middleware/auth.js";

const router: Router = Router();

router.get("/", authMiddleware, asyncHandler(paymentMethodController.findAll));
router.get(
  "/:id",
  validate(uuidParamSchema, "params"),
  authMiddleware,
  asyncHandler(paymentMethodController.findById),
);
router.post(
  "/",
  validate(createPaymentMethodSchema),
  authMiddleware,
  asyncHandler(paymentMethodController.create),
);
router.patch(
  "/:id",
  validate(uuidParamSchema, "params"),
  validate(updatePaymentMethodSchema),
  authMiddleware,
  asyncHandler(paymentMethodController.update),
);
router.delete(
  "/:id",
  validate(uuidParamSchema, "params"),
  authMiddleware,
  asyncHandler(paymentMethodController.delete),
);

export { router as paymentMethodRoutes };
