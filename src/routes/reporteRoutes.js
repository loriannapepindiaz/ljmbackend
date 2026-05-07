import { Router } from "express";
import { getReportes, getReporteEjecutivo } from "../controllers/reporteController.js";

const router = Router();

router.get("/ejecutivo", getReporteEjecutivo);
router.get("/", getReportes);

export default router;
