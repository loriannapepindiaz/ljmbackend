import { Router } from "express";
import { getProfile, updateProfile } from "../controllers/profileController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = Router();

router.get("/current", requireAuth, getProfile);
router.put("/current", requireAuth, updateProfile);

export default router;
