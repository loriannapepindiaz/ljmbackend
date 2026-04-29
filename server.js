import express from "express";
import cors from "cors";
import { env } from "./src/config/env.js";
import prisma from "./prismaClient.js";
import apiRoutes from "./src/routes/index.js";
import { errorHandler, notFoundHandler } from "./src/middlewares/errorHandler.js";

const app = express();

app.use(
  cors({
    origin: env.frontendUrl,
    credentials: true,
  }),
);
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    message: "LJM Sealine API funcionando",
  });
});

app.get("/test-db", async (_req, res) => {
  try {
    const result = await prisma.$queryRaw`SELECT NOW()`;
    res.json({ ok: true, result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.use("/api", apiRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`Servidor corriendo en http://localhost:${env.port}`);
});
