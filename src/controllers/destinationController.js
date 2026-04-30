import prisma from "../../prismaClient.js";

const serialize = (data) =>
  JSON.parse(JSON.stringify(data, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  ));

const normalizePuerto = (puerto) => {
  if (!puerto) {
    return puerto;
  }

  const { CIUDAD, ...rest } = puerto;

  return {
    ...rest,
    nombre_puerto: puerto.nombre,
    pais: CIUDAD?.PAIS?.nombre ?? null,
  };
};

const normalizeDestination = (destino) => ({
  ...destino,
  VIAJE: destino.VIAJE?.map((viaje) => ({
    ...viaje,
    ITINERARIO: viaje.ITINERARIO
      ? {
          ...viaje.ITINERARIO,
          escala: viaje.ITINERARIO.escala?.map((escala) => ({
            ...escala,
            PUERTO: normalizePuerto(escala.PUERTO),
          })),
        }
      : viaje.ITINERARIO,
  })),
});

const destinoSelect = {
  id: true,
  titulo: true,
  pais: true,
  region: true,
  ubicacion: true,
  descripcion: true,
  rating_promedio: true,
  imagen_url: true,
  precio_desde: true,
  moneda: true,
  galeria_urls: true,
  clima: true,
  highlights: true,
  incluye: true,
  idioma: true,
  duracion_tipica: true,
  puerto_principal: true,
  destino_tags: {
    select: {
      tags: { select: { nombre: true, color_hex: true } },
    },
  },
};

export const getAllDestinations = async (req, res, next) => {
  try {
    const { titulo } = req.query;
    const destinos = await prisma.destinos.findMany({
      where: {
        activo: true,
        ...(titulo ? { titulo: { contains: titulo, mode: "insensitive" } } : {}),
      },
      select: destinoSelect,
      orderBy: { created_at: "desc" },
    });

    res.json({ ok: true, data: serialize(destinos) });
  } catch (error) {
    next(error);
  }
};

export const getDestinationById = async (req, res, next) => {
  try {
    const id = BigInt(req.params.id);

    const destino = await prisma.destinos.findUnique({
      where: { id },
      select: {
        ...destinoSelect,
        ofertas: {
          where: { activa: true },
          select: {
            id: true,
            titulo: true,
            descripcion: true,
            precio_publicado: true,
            valor_descuento: true,
            fecha_fin: true,
          },
        },
        VIAJE: {
          where: { estado_publicacion: "publicado" },
          select: {
            id_viaje: true,
            nombre_viaje: true,
            duracion_dias: true,
            fecha_salida_real: true,
            ITINERARIO: {
              select: {
                nombre_ruta: true,
                descripcion: true,
                escala: {
                  orderBy: { orden_escala: "asc" },
                  select: {
                    orden_escala: true,
                    tipo_escala: true,
                    PUERTO: {
                      select: {
                        nombre: true,
                        CIUDAD: {
                          select: {
                            PAIS: { select: { nombre: true } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          take: 3,
        },
      },
    });

    if (!destino) {
      return res.status(404).json({ ok: false, message: "Destino no encontrado" });
    }

    res.json({ ok: true, data: normalizeDestination(serialize(destino)) });
  } catch (error) {
    next(error);
  }
};
