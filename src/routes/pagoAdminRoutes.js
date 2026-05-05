import { Router } from "express";
import {
  getPagos,
  createPagoAdmin,
  updatePago,
  inactivarPago,
} from "../controllers/pagoAdminController.js";

const router = Router();

router.get("/", getPagos);
router.post("/", createPagoAdmin);
router.patch("/:id", updatePago);
router.patch("/:id/inactivar", inactivarPago);

export default router;
