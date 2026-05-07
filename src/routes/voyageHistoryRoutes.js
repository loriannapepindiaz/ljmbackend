import { Router } from "express";
import { getCurrentVoyageHistory } from "../controllers/voyageHistoryController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = Router();

router.get("/current", requireAuth, getCurrentVoyageHistory);

export default router;
