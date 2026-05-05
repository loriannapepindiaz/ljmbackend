import { Router } from "express";
import { getCabinTypes, getCabinas } from "../controllers/cabinController.js";

const router = Router();

router.get("/habitaciones", getCabinas);
router.get("/", getCabinTypes);

export default router;
