import { Router } from "express";
import {
  getReservas,
  createReserva,
  updateReserva,
  cancelarReserva,
  getViajesCatalogo,
  getProximasSalidas,
} from "../controllers/reservaController.js";

const router = Router();

router.get("/viajes/proximas", getProximasSalidas);
router.get("/catalogo/viajes", getViajesCatalogo);
router.get("/", getReservas);
router.post("/", createReserva);
router.patch("/:id", updateReserva);
router.patch("/:id/cancelar", cancelarReserva);

export default router;
