import { Router } from "express";
import authRoutes from "./authRoutes.js";
import destinationRoutes from "./destinationRoutes.js";
import experienceRoutes from "./experienceRoutes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/destinations", destinationRoutes);
router.use("/experiences", experienceRoutes);

export default router;
