import prisma from "../../prismaClient.js";

const serialize = (data) =>
  JSON.parse(JSON.stringify(data, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  ));

const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

/* ─── Asignaciones (tabla principal) ────────────────────────────────── */
export const getAsignaciones = async (_req, res, next) => {
  try {
    const rows = await prisma.$queryRaw`
      WITH ultima_asignacion AS (
        SELECT DISTINCT ON (ac."id_habitacion")
          ac."id_habitacion",
          ac."id_reserva",
          ac."fecha_asignacion",
          ac."fecha_hasta",
          ac."precio_final",
          ac."estado_asignacion"
        FROM "ASIGNACION_CABINA" ac
        ORDER BY ac."id_habitacion", ac."fecha_asignacion" DESC
      )
      SELECT
        h."id_habitacion",
        h."numero_cabina",
        h."estado"              AS estado_fisico,
        c."numero_cubierta",
        th."id_tipo_habitacion",
        th."nombre"             AS tipo_habitacion,
        cru."nombre"            AS crucero,
        ua."id_reserva",
        ua."fecha_asignacion",
        ua."fecha_hasta",
        ua."precio_final",
        r."codigo_reserva",
        r."estado_reserva",
        cl."nombre"             AS cliente_nombre,
        cl."apellido"           AS cliente_apellido,
        cl."email"              AS cliente_email,
        CASE
          WHEN ua."estado_asignacion" = 'activa'
           AND CURRENT_DATE BETWEEN ua."fecha_asignacion" AND ua."fecha_hasta"
          THEN 'Ocupada'
          ELSE 'Disponible'
        END                     AS estado_ocupacion
      FROM "HABITACION" h
      JOIN "CUBIERTA"        c   ON h."id_cubierta"        = c."id_cubierta"
      JOIN "TIPO_HABITACION" th  ON h."id_tipo_habitacion" = th."id_tipo_habitacion"
      LEFT JOIN "CRUCERO"    cru ON c."id_crucero"         = cru."id_crucero"
      LEFT JOIN ultima_asignacion ua ON h."id_habitacion"  = ua."id_habitacion"
      LEFT JOIN "RESERVA"    r   ON ua."id_reserva"        = r."id_reserva"
      LEFT JOIN "CLIENTE"    cl  ON r."id_cliente"         = cl."id_cliente"
      WHERE c."tipo_cubierta" = 'cabinas'
      ORDER BY c."numero_cubierta" ASC, h."numero_cabina" ASC
    `;

    const data = serialize(rows).map((row) => ({
      id_habitacion:      row.id_habitacion,
      numero_cabina:      row.numero_cabina ?? null,
      tipo_habitacion:    row.tipo_habitacion ?? null,
      id_tipo_habitacion: row.id_tipo_habitacion != null ? String(row.id_tipo_habitacion) : null,
      cubierta:           row.numero_cubierta ?? null,
      crucero:            row.crucero ?? null,
      id_reserva:         row.id_reserva ? String(row.id_reserva) : null,
      codigo_reserva:     row.codigo_reserva ?? null,
      estado_reserva:     row.estado_reserva ?? null,
      huesped:            row.cliente_nombre
                            ? `${row.cliente_nombre} ${row.cliente_apellido ?? ""}`.trim() || null
                            : null,
      email:              row.cliente_email ?? null,
      fecha_entrada:      row.fecha_asignacion ?? null,
      fecha_salida:       row.fecha_hasta ?? null,
      precio_final:       toNumber(row.precio_final),
      estado_ocupacion:   row.estado_ocupacion,
      estado_fisico:      row.estado_fisico ?? null,
    }));

    res.json({ ok: true, data, total: data.length });
  } catch (error) {
    next(error);
  }
};

/* ─── Métricas ───────────────────────────────────────────────────────── */
export const getMetricasHabitaciones = async (_req, res, next) => {
  try {
    const [totRow, ocRow, manRow, dispRow] = await Promise.all([
      prisma.$queryRaw`
        SELECT COUNT(h."id_habitacion")::int AS total
        FROM "HABITACION" h
        JOIN "CUBIERTA" c ON h."id_cubierta" = c."id_cubierta"
        WHERE c."tipo_cubierta" = 'cabinas'
      `,
      prisma.$queryRaw`
        SELECT COUNT(DISTINCT h."id_habitacion")::int AS ocupadas
        FROM "HABITACION" h
        JOIN "CUBIERTA" c ON h."id_cubierta" = c."id_cubierta"
        JOIN "ASIGNACION_CABINA" ac
          ON h."id_habitacion" = ac."id_habitacion"
         AND ac."estado_asignacion" = 'activa'
         AND CURRENT_DATE BETWEEN ac."fecha_asignacion" AND ac."fecha_hasta"
        WHERE c."tipo_cubierta" = 'cabinas'
      `,
      prisma.$queryRaw`
        SELECT COUNT(h."id_habitacion")::int AS mantenimiento
        FROM "HABITACION" h
        JOIN "CUBIERTA" c ON h."id_cubierta" = c."id_cubierta"
        WHERE c."tipo_cubierta" = 'cabinas'
          AND h."estado" = 'en_mantenimiento'
      `,
      prisma.$queryRaw`
        SELECT COUNT(h."id_habitacion")::int AS disponibles
        FROM "HABITACION" h
        JOIN "CUBIERTA" c ON h."id_cubierta" = c."id_cubierta"
        WHERE c."tipo_cubierta" = 'cabinas'
          AND h."estado" = 'disponible'
          AND NOT EXISTS (
            SELECT 1 FROM "ASIGNACION_CABINA" ac
            WHERE ac."id_habitacion" = h."id_habitacion"
              AND ac."estado_asignacion" = 'activa'
              AND CURRENT_DATE BETWEEN ac."fecha_asignacion" AND ac."fecha_hasta"
          )
      `,
    ]);

    res.json({
      ok: true,
      data: {
        total:        totRow[0]?.total       ?? 0,
        ocupadas:     ocRow[0]?.ocupadas     ?? 0,
        disponibles:  dispRow[0]?.disponibles ?? 0,
        mantenimiento: manRow[0]?.mantenimiento ?? 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

/* ─── Tipos (solo cubiertas tipo 'cabinas') ──────────────────────────── */
export const getTiposHabitacion = async (_req, res, next) => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT
        th."id_tipo_habitacion",
        th."nombre",
        COUNT(h."id_habitacion")::int AS total
      FROM "TIPO_HABITACION" th
      JOIN "HABITACION" h ON h."id_tipo_habitacion" = th."id_tipo_habitacion"
      JOIN "CUBIERTA"   c ON h."id_cubierta"        = c."id_cubierta"
      WHERE c."tipo_cubierta" = 'cabinas'
      GROUP BY th."id_tipo_habitacion", th."nombre"
      ORDER BY th."id_tipo_habitacion" ASC
    `;

    const data = serialize(rows).map((t) => ({
      id:     String(t.id_tipo_habitacion),
      nombre: t.nombre,
      total:  t.total,
    }));

    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
};

/* ─── Tipos de cabina (frontend público) ────────────────────────────── */
const normalizeCabinType = (type) => ({
  id: String(type.id_tipo_habitacion),
  idTipoHabitacion: type.id_tipo_habitacion,
  id_tipo_habitacion: type.id_tipo_habitacion,
  idHabitacion: type.HABITACION?.[0]?.id_habitacion ?? null,
  id_habitacion: type.HABITACION?.[0]?.id_habitacion ?? null,
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
        HABITACION: {
          some: { estado: { equals: "disponible", mode: "insensitive" } },
        },
      },
      select: {
        id_tipo_habitacion: true, nombre: true, descripcion: true,
        capacidad_max: true, precio_noche: true, tamano_m2: true,
        capacidad_ninos: true, imagen_url: true, estado_disponibilidad: true,
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

/* ─── getCabinas (público: listing por crucero/tipo) ────────────────── */
export const getCabinas = async (req, res, next) => {
  try {
    const { id_crucero, tipo_id } = req.query;
    const where = {};
    if (tipo_id)    where.id_tipo_habitacion = Number(tipo_id);
    if (id_crucero) {
      const parsed = Number(id_crucero);
      if (!Number.isInteger(parsed))
        return res.status(400).json({ ok: false, message: "id_crucero debe ser un entero válido." });
      where.CUBIERTA = { id_crucero: parsed };
    }
    const habitaciones = await prisma.hABITACION.findMany({
      where,
      select: {
        id_habitacion: true, numero_cabina: true, estado: true,
        CUBIERTA: { select: { numero_cubierta: true, id_crucero: true, CRUCERO: { select: { nombre: true } } } },
        TIPO_HABITACION: { select: { id_tipo_habitacion: true, nombre: true, precio_noche: true, capacidad_max: true, tamano_m2: true } },
      },
      orderBy: [{ id_cubierta: "asc" }, { numero_cabina: "asc" }],
    });
    const data = serialize(habitaciones).map((h) => ({
      id: String(h.id_habitacion), numero_cabina: h.numero_cabina ?? null,
      categoria: h.TIPO_HABITACION?.nombre ?? null,
      tipo_id: h.TIPO_HABITACION?.id_tipo_habitacion != null ? String(h.TIPO_HABITACION.id_tipo_habitacion) : null,
      estado: h.estado ?? "disponible",
      crucero_id: h.CUBIERTA?.id_crucero != null ? String(h.CUBIERTA.id_crucero) : null,
      crucero_nombre: h.CUBIERTA?.CRUCERO?.nombre ?? null,
      cubierta_numero: h.CUBIERTA?.numero_cubierta ?? null,
      precio_noche: toNumber(h.TIPO_HABITACION?.precio_noche),
      capacidad_max: h.TIPO_HABITACION?.capacidad_max ?? null,
      tamano_m2: toNumber(h.TIPO_HABITACION?.tamano_m2),
    }));
    res.json({ ok: true, data, total: data.length });
  } catch (error) {
    next(error);
  }
};
