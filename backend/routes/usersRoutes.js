import { Router } from "express";
import {
  getUsers,
  updateUserHandler,
  disableUserHandler,
  enableUserHandler,
  deleteUserHandler,
  resetPasswordHandler,
  loginHistoryHandler
} from "../controllers/usersController.js";
import { requireAuth, requireRole } from "../middleware/authMiddleware.js";

const router = Router();

router.use(requireAuth, requireRole("admin"));

router.get("/", getUsers);
router.patch("/:id", updateUserHandler);
router.post("/:id/disable", disableUserHandler);
router.post("/:id/enable", enableUserHandler);
router.delete("/:id", deleteUserHandler);
router.post("/:id/reset-password", resetPasswordHandler);
router.get("/:id/login-history", loginHistoryHandler);

export default router;