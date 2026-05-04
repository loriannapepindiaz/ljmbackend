import { Router } from "express";
import { getCurrentBookingDraft, saveCurrentBookingDraft } from "../controllers/bookingDraftController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = Router();

router.get("/current", requireAuth, getCurrentBookingDraft);
router.put("/current", requireAuth, saveCurrentBookingDraft);

export default router;
