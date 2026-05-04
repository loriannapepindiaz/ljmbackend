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
  pricePerNight: toNumber(type.precio_noche) ?? 0,
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
