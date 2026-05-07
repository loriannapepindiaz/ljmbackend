import { Router } from "express";
import { getCurrentInvoice, getInvoiceByReservation } from "../controllers/invoiceController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = Router();

router.get("/current", requireAuth, getCurrentInvoice);
router.get("/reservation/:reservationId", requireAuth, getInvoiceByReservation);

export default router;
