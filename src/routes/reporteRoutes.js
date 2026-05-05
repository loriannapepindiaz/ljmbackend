import { Router } from "express";
import { getReportes } from "../controllers/reporteController.js";

const router = Router();

router.get("/", getReportes);

export default router;
