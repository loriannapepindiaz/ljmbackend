import { Router } from "express";
import {
  getReservas,
  createReserva,
  updateReserva,
  cancelarReserva,
  getViajesCatalogo,
} from "../controllers/reservaController.js";

const router = Router();

router.get("/catalogo/viajes", getViajesCatalogo);
router.get("/", getReservas);
router.post("/", createReserva);
router.patch("/:id", updateReserva);
router.patch("/:id/cancelar", cancelarReserva);

export default router;
