import prisma from "../../prismaClient.js";

const serialize = (data) =>
  JSON.parse(JSON.stringify(data, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  ));

const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

const normalizeCabinType = (type) => ({
  id: String(type.id_tipo_habitacion),
  title: type.nombre,
  nombre: type.nombre,
  description: type.descripcion,
  imageUrl: type.imagen_url,
  size: type.tamano_m2 ? `${toNumber(type.tamano_m2)} m2` : null,
  feature: type.nombre,
  capacity: type.capacidad_max ? `${type.capacidad_max} huespedes` : null,
  pricePerNight: toNumber(type.precio_noche),
  highlights: [
    type.capacidad_max ? `Capacidad maxima: ${type.capacidad_max} huespedes` : null,
    type.tamano_m2 ? `${toNumber(type.tamano_m2)} m2 de espacio privado` : null,
    type.capacidad_ninos ? `Apta para ${type.capacidad_ninos} ninos` : null,
    type.estado_disponibilidad ? `Estado: ${type.estado_disponibilidad}` : null,
  ].filter(Boolean),
  amenities: ["Wi-Fi incluido", "Room service", "Amenidades premium", "Concierge"],
  gallery: [type.imagen_url].filter(Boolean),
  availableCabins: type.HABITACION?.length ?? 0,
});

export const getCabinas = async (req, res, next) => {
  try {
    const { id_crucero, categoria, estado } = req.query;

    const where = {};

    if (estado) {
      where.estado = { equals: estado, mode: "insensitive" };
    }

    if (categoria) {
      where.TIPO_HABITACION = {
        nombre: { contains: categoria, mode: "insensitive" },
      };
    }

    if (id_crucero) {
      const parsed = Number(id_crucero);
      if (!Number.isInteger(parsed)) {
        return res.status(400).json({ ok: false, message: "id_crucero debe ser un entero válido." });
      }
      where.CUBIERTA = { id_crucero: parsed };
    }

    const habitaciones = await prisma.hABITACION.findMany({
      where,
      select: {
        id_habitacion: true,
        numero_cabina: true,
        estado: true,
        CUBIERTA: {
          select: {
            numero_cubierta: true,
            id_crucero: true,
            CRUCERO: { select: { nombre: true } },
          },
        },
        TIPO_HABITACION: { select: { nombre: true } },
      },
      orderBy: [{ id_cubierta: "asc" }, { numero_cabina: "asc" }],
    });

    const data = serialize(habitaciones).map((h) => ({
      id: String(h.id_habitacion),
      numero_cabina: h.numero_cabina ?? null,
      categoria: h.TIPO_HABITACION?.nombre ?? null,
      estado: h.estado ?? null,
      crucero_id: h.CUBIERTA?.id_crucero != null ? String(h.CUBIERTA.id_crucero) : null,
      crucero_nombre: h.CUBIERTA?.CRUCERO?.nombre ?? null,
      cubierta_numero: h.CUBIERTA?.numero_cubierta ?? null,
    }));

    res.json({ ok: true, data, total: data.length });
  } catch (error) {
    next(error);
  }
};

export const getCabinTypes = async (_req, res, next) => {
  try {
    const cabinTypes = await prisma.tIPO_HABITACION.findMany({
      where: {
        estado_disponibilidad: { equals: "disponible", mode: "insensitive" },
      },
      select: {
        id_tipo_habitacion: true,
        nombre: true,
        descripcion: true,
        capacidad_max: true,
        precio_noche: true,
        tamano_m2: true,
        capacidad_ninos: true,
        imagen_url: true,
        estado_disponibilidad: true,
        HABITACION: {
          where: { estado: { equals: "disponible", mode: "insensitive" } },
          select: { id_habitacion: true },
        },
      },
      orderBy: { id_tipo_habitacion: "asc" },
    });

    res.json({ ok: true, data: serialize(cabinTypes).map(normalizeCabinType) });
  } catch (error) {
    next(error);
  }
};
