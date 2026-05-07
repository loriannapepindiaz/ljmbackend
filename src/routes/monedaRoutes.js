import { Router } from "express";
import prisma from "../../prismaClient.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const monedas = await prisma.mONEDA.findMany({
      where: { codigo: { not: null } },
      select: { id_moneda: true, codigo: true, nombre: true },
      orderBy: { codigo: "asc" },
    });
    res.json({ ok: true, data: monedas });
  } catch (error) {
    next(error);
  }
});

export default router;
