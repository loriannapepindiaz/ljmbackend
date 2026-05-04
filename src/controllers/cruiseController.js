import prisma from "../../prismaClient.js";

const serialize = (data) =>
  JSON.parse(JSON.stringify(data, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  ));

const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

const normalizeCruise = (cruise) => {
  const gallery = cruise.imagenes_crucero?.map((image) => image.url ?? image.imagen_url).filter(Boolean) ?? [];
  const facilities = cruise.instalaciones_crucero?.filter((item) => item.activa).map((item) => ({
    nombre: item.nombre,
    icono: item.icono,
    descripcion: item.descripcion,
  })) ?? [];

  return {
    id: String(cruise.id_crucero),
    title: cruise.nombre,
    nombre: cruise.nombre,
    subtitle: cruise.TIPO_CRUCERO?.nombre_tipo ?? cruise.ambiente ?? "LJM Sealine",
    className: cruise.TIPO_CRUCERO?.nombre_tipo ?? cruise.ambiente ?? "Clase LJM",
    description: cruise.descripcion,
    length: cruise.eslora_metros ? `${toNumber(cruise.eslora_metros)}m` : null,
    guests: cruise.capacidad_max_pasajeros,
    badge: cruise.ambiente ?? cruise.TIPO_CRUCERO?.nombre_tipo ?? "Activo",
    imageSrc: cruise.imagen_portada_url ?? gallery[0] ?? null,
    heroImage: cruise.imagen_portada_url ?? gallery[0] ?? null,
    specs: {
      length: cruise.eslora_metros ? `${toNumber(cruise.eslora_metros)}m` : null,
      tonnage: cruise.tonelaje ? `${toNumber(cruise.tonelaje)}t` : null,
      guests: cruise.capacidad_max_pasajeros,
      decks: cruise.numero_cubiertas,
    },
    visionTitle: cruise.ruta_descripcion ?? `La Vision: ${cruise.nombre}`,
    visionDescription: cruise.descripcion,
    galleryImages: gallery.map((src, index) => ({ src, alt: `${cruise.nombre} vista ${index + 1}` })),
    facilities,
    raw: cruise,
  };
};

const cruiseSelect = {
  id_crucero: true,
  nombre: true,
  descripcion: true,
  activo: true,
  ambiente: true,
  eslora_metros: true,
  tonelaje: true,
  imagen_portada_url: true,
  capacidad_max_pasajeros: true,
  numero_cubiertas: true,
  ruta_descripcion: true,
  TIPO_CRUCERO: { select: { nombre_tipo: true } },
  imagenes_crucero: { select: { url: true, orden: true }, orderBy: { orden: "asc" } },
  instalaciones_crucero: {
    select: { nombre: true, icono: true, descripcion: true, activa: true, orden: true },
    orderBy: { orden: "asc" },
  },
};

export const getAllCruises = async (_req, res, next) => {
  try {
    const cruises = await prisma.cRUCERO.findMany({
      where: { activo: true },
      select: cruiseSelect,
      orderBy: { id_crucero: "asc" },
    });

    res.json({ ok: true, data: serialize(cruises).map(normalizeCruise) });
  } catch (error) {
    next(error);
  }
};

export const getCruiseById = async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, message: "ID de crucero invalido." });
    }

    const cruise = await prisma.cRUCERO.findFirst({
      where: { id_crucero: id, activo: true },
      select: cruiseSelect,
    });

    if (!cruise) {
      return res.status(404).json({ ok: false, message: "Crucero no encontrado." });
    }

    res.json({ ok: true, data: normalizeCruise(serialize(cruise)) });
  } catch (error) {
    next(error);
  }
};
