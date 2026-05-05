import { Router } from "express";
import { getPasajeros, updatePasajero, inactivarPasajero } from "../controllers/pasajeroController.js";

const router = Router();

router.get("/",                getPasajeros);
router.patch("/:id",           updatePasajero);
router.patch("/:id/inactivar", inactivarPasajero);

export default router;
