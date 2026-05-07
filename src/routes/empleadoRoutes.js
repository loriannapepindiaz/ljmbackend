import { Router } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { createEmpleado, getEmpleadosCatalogos, getEmpleadosDashboard, updateEmpleado } from "../controllers/empleadoController.js";

const router = Router();
const uploadDir = path.resolve("uploads", "empleados");
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname);
      const basename = path
        .basename(file.originalname, extension)
        .replace(/[^a-z0-9_-]/gi, "-")
        .slice(0, 40);
      cb(null, `${Date.now()}-${basename}${extension}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.get("/dashboard", getEmpleadosDashboard);
router.get("/catalogos", getEmpleadosCatalogos);
router.post("/", upload.any(), createEmpleado);
router.patch("/:id", updateEmpleado);

export default router;
