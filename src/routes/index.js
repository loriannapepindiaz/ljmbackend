import { Router } from "express";
import authRoutes from "./authRoutes.js";
import destinationRoutes from "./destinationRoutes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/destinations", destinationRoutes);

export default router;
