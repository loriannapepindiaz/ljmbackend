import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Backend funcionando 🔥");
});

app.listen(3000, () => {
  console.log("Servidor corriendo en http://localhost:3000");
});
