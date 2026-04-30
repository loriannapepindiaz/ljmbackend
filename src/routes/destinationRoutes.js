import { Router } from "express";
import { getAllDestinations, getDestinationById } from "../controllers/destinationController.js";

const router = Router();

router.get("/", getAllDestinations);
router.get("/:id", getDestinationById);

export default router;
