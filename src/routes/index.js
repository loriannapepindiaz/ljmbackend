import { Router } from "express";
import authRoutes from "./authRoutes.js";
import bookingDraftRoutes from "./bookingDraftRoutes.js";
import cabinRoutes from "./cabinRoutes.js";
import cruiseRoutes from "./cruiseRoutes.js";
import destinationRoutes from "./destinationRoutes.js";
import experienceRoutes from "./experienceRoutes.js";
import pasajeroRoutes from "./pasajeroRoutes.js";
import paymentRoutes from "./paymentRoutes.js";
import reservaRoutes from "./reservaRoutes.js";
import pagoAdminRoutes from "./pagoAdminRoutes.js";
import reporteRoutes from "./reporteRoutes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/booking-drafts", bookingDraftRoutes);
router.use("/cabinas", cabinRoutes);
router.use("/cruceros", cruiseRoutes);
router.use("/destinations", destinationRoutes);
router.use("/experiences", experienceRoutes);
router.use("/pasajeros", pasajeroRoutes);
router.use("/payments", paymentRoutes);
router.use("/reservas", reservaRoutes);
router.use("/pagos", pagoAdminRoutes);
router.use("/reportes", reporteRoutes);

export default router;
