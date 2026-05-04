import { Router } from "express";
import { createPayment } from "../controllers/paymentController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = Router();

router.post("/", requireAuth, createPayment);

export default router;
