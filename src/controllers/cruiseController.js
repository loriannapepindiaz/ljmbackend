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

export const updateCruise = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, message: "ID de crucero inválido." });
    }

    const {
      nombre,
      capacidad_max_pasajeros,
      activo,
      descripcion,
      ambiente,
      eslora_metros,
      tonelaje,
      numero_cubiertas,
      imagen_portada_url,
      video_url,
      ruta_descripcion,
      anio_fabricacion,
      velocidad_nudos,
      capacidad_tripulacion,
      bandera,
      num_restaurantes,
      num_bares,
    } = req.body;

    if (nombre !== undefined && !String(nombre).trim()) {
      return res.status(400).json({ ok: false, message: "El nombre no puede estar vacío." });
    }
    if (capacidad_max_pasajeros !== undefined) {
      const cap = Number(capacidad_max_pasajeros);
      if (!Number.isInteger(cap) || cap <= 0) {
        return res.status(400).json({ ok: false, message: "'capacidad_max_pasajeros' debe ser un entero positivo." });
      }
    }

    const existing = await prisma.cRUCERO.findFirst({ where: { id_crucero: id } });
    if (!existing) {
      return res.status(404).json({ ok: false, message: "Crucero no encontrado." });
    }

    const updated = await prisma.cRUCERO.update({
      where: { id_crucero: id },
      data: {
        ...(nombre !== undefined                 && { nombre: String(nombre).trim() }),
        ...(capacidad_max_pasajeros !== undefined && { capacidad_max_pasajeros: Number(capacidad_max_pasajeros) }),
        ...(activo !== undefined                 && { activo: Boolean(activo) }),
        ...(descripcion !== undefined            && { descripcion }),
        ...(ambiente !== undefined               && { ambiente }),
        ...(eslora_metros !== undefined          && { eslora_metros: eslora_metros != null ? Number(eslora_metros) : null }),
        ...(tonelaje !== undefined               && { tonelaje: tonelaje != null ? Number(tonelaje) : null }),
        ...(numero_cubiertas !== undefined       && { numero_cubiertas: numero_cubiertas != null ? Number(numero_cubiertas) : null }),
        ...(imagen_portada_url !== undefined     && { imagen_portada_url }),
        ...(video_url !== undefined              && { video_url }),
        ...(ruta_descripcion !== undefined       && { ruta_descripcion }),
        ...(anio_fabricacion !== undefined       && { anio_fabricacion: anio_fabricacion != null ? Number(anio_fabricacion) : null }),
        ...(velocidad_nudos !== undefined        && { velocidad_nudos: velocidad_nudos != null ? Number(velocidad_nudos) : null }),
        ...(capacidad_tripulacion !== undefined  && { capacidad_tripulacion: capacidad_tripulacion != null ? Number(capacidad_tripulacion) : null }),
        ...(bandera !== undefined                && { bandera }),
        ...(num_restaurantes !== undefined       && { num_restaurantes: num_restaurantes != null ? Number(num_restaurantes) : null }),
        ...(num_bares !== undefined              && { num_bares: num_bares != null ? Number(num_bares) : null }),
      },
      select: cruiseSelect,
    });

    res.json({ ok: true, data: normalizeCruise(serialize(updated)) });
  } catch (error) {
    next(error);
  }
};

export const softDeleteCruise = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, message: "ID de crucero inválido." });
    }

    const existing = await prisma.cRUCERO.findFirst({ where: { id_crucero: id } });
    if (!existing) {
      return res.status(404).json({ ok: false, message: "Crucero no encontrado." });
    }

    await prisma.cRUCERO.update({
      where: { id_crucero: id },
      data: { activo: false },
    });

    res.json({ ok: true, message: "Crucero desactivado correctamente." });
  } catch (error) {
    next(error);
  }
};

export const createCruise = async (req, res, next) => {
  try {
    const {
      nombre,
      capacidad_max_pasajeros,
      id_tipo_crucero,
      descripcion,
      activo,
      ambiente,
      anio_fabricacion,
      velocidad_nudos,
      eslora_metros,
      tonelaje,
      video_url,
      imagen_portada_url,
      capacidad_tripulacion,
      numero_cubiertas,
      bandera,
      num_restaurantes,
      num_bares,
      ruta_descripcion,
      registro_maritimo,
    } = req.body;

    if (!nombre?.trim()) {
      return res.status(400).json({ ok: false, message: "El campo 'nombre' es requerido." });
    }
    if (capacidad_max_pasajeros === undefined || capacidad_max_pasajeros === null) {
      return res.status(400).json({ ok: false, message: "El campo 'capacidad_max_pasajeros' es requerido." });
    }
    if (!Number.isInteger(Number(capacidad_max_pasajeros)) || Number(capacidad_max_pasajeros) <= 0) {
      return res.status(400).json({ ok: false, message: "'capacidad_max_pasajeros' debe ser un entero positivo." });
    }
    if (id_tipo_crucero === undefined || id_tipo_crucero === null) {
      return res.status(400).json({ ok: false, message: "El campo 'id_tipo_crucero' es requerido." });
    }
    if (!Number.isInteger(Number(id_tipo_crucero))) {
      return res.status(400).json({ ok: false, message: "'id_tipo_crucero' debe ser un entero válido." });
    }

    const cruise = await prisma.cRUCERO.create({
      data: {
        nombre: nombre.trim(),
        capacidad_max_pasajeros: Number(capacidad_max_pasajeros),
        id_tipo_crucero: Number(id_tipo_crucero),
        descripcion: descripcion ?? null,
        activo: activo !== undefined ? Boolean(activo) : true,
        ambiente: ambiente ?? null,
        anio_fabricacion: anio_fabricacion != null ? Number(anio_fabricacion) : null,
        velocidad_nudos: velocidad_nudos != null ? Number(velocidad_nudos) : null,
        eslora_metros: eslora_metros != null ? Number(eslora_metros) : null,
        tonelaje: tonelaje != null ? Number(tonelaje) : null,
        video_url: video_url ?? null,
        imagen_portada_url: imagen_portada_url ?? null,
        capacidad_tripulacion: capacidad_tripulacion != null ? Number(capacidad_tripulacion) : null,
        numero_cubiertas: numero_cubiertas != null ? Number(numero_cubiertas) : null,
        bandera: bandera ?? null,
        num_restaurantes: num_restaurantes != null ? Number(num_restaurantes) : 0,
        num_bares: num_bares != null ? Number(num_bares) : 0,
        ruta_descripcion: ruta_descripcion ?? null,
        registro_maritimo: registro_maritimo ?? null,
      },
      select: cruiseSelect,
    });

    res.status(201).json({ ok: true, data: normalizeCruise(serialize(cruise)) });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(400).json({ ok: false, message: "El registro marítimo ya existe." });
    }
    if (error.code === "P2003") {
      return res.status(400).json({ ok: false, message: "El 'id_tipo_crucero' no existe." });
    }
    next(error);
  }
};
