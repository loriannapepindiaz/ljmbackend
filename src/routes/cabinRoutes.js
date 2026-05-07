import { Router } from "express";
import {
  getCabinTypes,
  getCabinas,
  getMetricasHabitaciones,
  getTiposHabitacion,
  getAsignaciones,
} from "../controllers/cabinController.js";

const router = Router();

router.get("/metricas", getMetricasHabitaciones);
router.get("/tipos", getTiposHabitacion);
router.get("/asignaciones", getAsignaciones);
router.get("/habitaciones", getCabinas);
router.get("/", getCabinTypes);

export default router;
