import { Router } from "express";
import {
  addDiningRequest,
  addExcursion,
  addGuest,
  deleteGuest,
  getLatestManageBooking,
  getManageBooking,
  reserveTable,
  updateGuest,
} from "../controllers/manageBookingController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = Router();

router.get("/current", requireAuth, getManageBooking);
router.get("/latest", getLatestManageBooking);
router.post("/guests", requireAuth, addGuest);
router.put("/guests/:id", requireAuth, updateGuest);
router.delete("/guests/:id", requireAuth, deleteGuest);
router.post("/dining-requests", requireAuth, addDiningRequest);
router.post("/table-reservations", requireAuth, reserveTable);
router.post("/excursions", requireAuth, addExcursion);

export default router;
