import { Router } from "express";
import { checkEmail, setPasswordHandler, login, logout, me, profile } from "../controllers/authController.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { loginLimiter, accountLimiter } from "../middleware/rateLimiters.js";

const router = Router();

router.post("/check-email", accountLimiter, checkEmail);
router.post("/set-password", accountLimiter, setPasswordHandler);
router.post("/login", loginLimiter, login);
router.post("/logout", logout);
router.get("/me", requireAuth, me);
router.get("/profile", requireAuth, profile);

export default router;