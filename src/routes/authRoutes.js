import { Router } from "express";
import { adminLogin, login, me, register } from "../controllers/authController.js";
import { sendEmailOtp, verifyEmailOtp } from "../controllers/twoFactorController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/admin/login", adminLogin);
router.get("/me", requireAuth, me);
router.post("/2fa/send-email", sendEmailOtp);
router.post("/2fa/verify-email", verifyEmailOtp);

export default router;
