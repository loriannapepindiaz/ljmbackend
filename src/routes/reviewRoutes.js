import { Router } from "express";
import { getCurrentReviews, saveCurrentReview } from "../controllers/reviewController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = Router();

router.get("/current", requireAuth, getCurrentReviews);
router.post("/current", requireAuth, saveCurrentReview);

export default router;
