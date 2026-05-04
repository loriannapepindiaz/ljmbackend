import { Router } from "express";
import authRoutes from "./authRoutes.js";
import bookingDraftRoutes from "./bookingDraftRoutes.js";
import cabinRoutes from "./cabinRoutes.js";
import cruiseRoutes from "./cruiseRoutes.js";
import destinationRoutes from "./destinationRoutes.js";
import experienceRoutes from "./experienceRoutes.js";
import paymentRoutes from "./paymentRoutes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/booking-drafts", bookingDraftRoutes);
router.use("/cabinas", cabinRoutes);
router.use("/cruceros", cruiseRoutes);
router.use("/destinations", destinationRoutes);
router.use("/experiences", experienceRoutes);
router.use("/payments", paymentRoutes);

export default router;
