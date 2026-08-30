import { Router } from "express";
import { userController } from "./users.controller.js";
import { validate, asyncHandler } from "../../common/middleware/index.js";
import { authMiddleware } from "../../common/middleware/auth.js";
import {
  updateProfileSchema,
  updatePasswordSchema,
  deactivateAccountSchema,
  deleteAccountSchema,
} from "./users.validation.js";
import { uploadAvatarMiddleware } from "../../common/utils/upload.js";

const router: Router = Router();

// All routes require authentication
router.get("/me", authMiddleware, asyncHandler(userController.getProfile));
router.patch(
  "/me",
  authMiddleware,
  validate(updateProfileSchema),
  asyncHandler(userController.updateProfile),
);

// Avatar upload / removal
router.post(
  "/me/avatar",
  authMiddleware,
  uploadAvatarMiddleware,
  asyncHandler(userController.uploadAvatar),
);
router.delete("/me/avatar", authMiddleware, asyncHandler(userController.removeAvatar));

router.post(
  "/me/password",
  authMiddleware,
  validate(updatePasswordSchema),
  asyncHandler(userController.updatePassword),
);

// Account lifecycle
router.post(
  "/me/deactivate",
  authMiddleware,
  validate(deactivateAccountSchema),
  asyncHandler(userController.deactivateAccount),
);
router.post("/me/reactivate", authMiddleware, asyncHandler(userController.reactivateAccount));
router.delete(
  "/me",
  authMiddleware,
  validate(deleteAccountSchema),
  asyncHandler(userController.deleteAccount),
);

export { router as userRoutes };
