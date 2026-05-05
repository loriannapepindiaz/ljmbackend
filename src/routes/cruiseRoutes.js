import { Router } from "express";
import { getAllCruises, getCruiseById, createCruise, updateCruise, softDeleteCruise } from "../controllers/cruiseController.js";

const router = Router();

router.get("/", getAllCruises);
router.get("/:id", getCruiseById);
router.post("/", createCruise);
router.patch("/:id", updateCruise);
router.patch("/:id/inactivar", softDeleteCruise);

export default router;
