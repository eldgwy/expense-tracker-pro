import { Router } from "express";
import { authController } from "./auth.controller.js";
import { validate, asyncHandler } from "../../common/middleware/index.js";
import { authMiddleware } from "../../common/middleware/auth.js";
import {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "./auth.validation.js";

const router: Router = Router();

// ─── Public Routes ────────────────────────────────────────────
router.post("/register", validate(registerSchema), asyncHandler(authController.register));
router.post("/login", validate(loginSchema), asyncHandler(authController.login));
router.post("/refresh", asyncHandler(authController.refreshToken));
router.post("/logout", asyncHandler(authController.logout));
router.post(
  "/forgot-password",
  validate(forgotPasswordSchema),
  asyncHandler(authController.forgotPassword),
);
router.post(
  "/reset-password",
  validate(resetPasswordSchema),
  asyncHandler(authController.resetPassword),
);

// ─── Protected Routes ─────────────────────────────────────────
router.get("/me", authMiddleware, asyncHandler(authController.getProfile));

export { router as authRoutes };
