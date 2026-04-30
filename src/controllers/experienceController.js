import prisma from "../../prismaClient.js";

const serialize = (data) =>
  JSON.parse(JSON.stringify(data, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  ));

const experienceSelect = {
  id: true,
  nombre: true,
  descripcion: true,
  unidad_cobro: true,
  precio_base: true,
  categoria: true,
  imagen_url: true,
  activa: true,
};

const buildNameFilter = (nombre) => {
  if (!nombre?.trim()) {
    return {};
  }

  const words = nombre
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 2);

  return {
    OR: [
      { nombre: { contains: nombre, mode: "insensitive" } },
      {
        AND: words.map((word) => ({
          nombre: { contains: word, mode: "insensitive" },
        })),
      },
    ],
  };
};

export const getAllExperiences = async (req, res, next) => {
  try {
    const { nombre } = req.query;

    const experiencias = await prisma.experiencias.findMany({
      where: {
        activa: true,
        ...buildNameFilter(typeof nombre === "string" ? nombre : ""),
      },
      select: experienceSelect,
      orderBy: { id: "asc" },
    });

    res.json({ ok: true, data: serialize(experiencias) });
  } catch (error) {
    next(error);
  }
};

export const getExperienceById = async (req, res, next) => {
  try {
    const experiencia = await prisma.experiencias.findUnique({
      where: { id: BigInt(req.params.id) },
      select: experienceSelect,
    });

    if (!experiencia || !experiencia.activa) {
      return res.status(404).json({ ok: false, message: "Experiencia no encontrada" });
    }

    res.json({ ok: true, data: serialize(experiencia) });
  } catch (error) {
    next(error);
  }
};
