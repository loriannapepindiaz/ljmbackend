import express from "express";
import cors from "cors";
import { env } from "./src/config/env.js";
import prisma from "./prismaClient.js";
import apiRoutes from "./src/routes/index.js";
import { errorHandler, notFoundHandler } from "./src/middlewares/errorHandler.js";

const app = express();
const allowedOrigins = new Set([
  env.frontendUrl,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "http://localhost:5175",
  "http://127.0.0.1:5175",
]);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origen no permitido por CORS: ${origin}`));
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use("/uploads", express.static("uploads"));

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
