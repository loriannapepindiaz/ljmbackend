import { Router } from "express";
import { getCabinTypes } from "../controllers/cabinController.js";

const router = Router();

router.get("/", getCabinTypes);

export default router;
