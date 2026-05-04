import { Router } from "express";
import { getAllCruises, getCruiseById } from "../controllers/cruiseController.js";

const router = Router();

router.get("/", getAllCruises);
router.get("/:id", getCruiseById);

export default router;
