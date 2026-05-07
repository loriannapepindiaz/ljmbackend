import prisma from "../../prismaClient.js";

const serialize = (data) =>
  JSON.parse(JSON.stringify(data, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  ));

const normalizeEstado = (estado) => {
  const s = (estado ?? "").toLowerCase().trim();
  if (s === "confirmada" || s === "confirmado") return "Confirmado";
  if (s === "pagado" || s === "pago") return "Pagado";
  return "Pendiente";
};

const reservaSelect = {
  id_reserva: true,
  id_cliente: true,
  id_viaje: true,
  codigo_reserva: true,
  estado_reserva: true,
  monto_total: true,
  fecha_reserva: true,
  observaciones: true,
  moneda: true,
  CLIENTE: { select: { nombre: true, apellido: true, email: true } },
  VIAJE: {
    select: {
      nombre_viaje: true,
      CRUCERO: { select: { id_crucero: true, nombre: true } },
    },
  },
  ASIGNACION_CABINA: {
    where: { estado_asignacion: "activa" },
    select: {
      id_habitacion: true,
      HABITACION: { select: { numero_cabina: true } },
    },
    take: 1,
  },
};

const normalizeReserva = (r) => ({
  id: String(r.id_reserva),
  codigo: r.codigo_reserva ?? null,
  pasajero_id: r.id_cliente != null ? String(r.id_cliente) : null,
  viaje_id: r.id_viaje != null ? String(r.id_viaje) : null,
  guest: r.CLIENTE
    ? [r.CLIENTE.nombre, r.CLIENTE.apellido].filter(Boolean).join(" ") || "—"
    : "—",
  guest_email: r.CLIENTE?.email ?? null,
  ship: r.VIAJE?.CRUCERO?.nombre ?? r.VIAJE?.nombre_viaje ?? "—",
  viaje_nombre: r.VIAJE?.nombre_viaje ?? null,
  crucero_id:
    r.VIAJE?.CRUCERO?.id_crucero != null
      ? String(r.VIAJE.CRUCERO.id_crucero)
      : null,
  cabin:
    r.ASIGNACION_CABINA?.[0]?.HABITACION?.numero_cabina ?? "—",
  habitacion_id:
    r.ASIGNACION_CABINA?.[0]?.id_habitacion != null
      ? String(r.ASIGNACION_CABINA[0].id_habitacion)
      : null,
  status: normalizeEstado(r.estado_reserva),
  total:
    r.monto_total != null
      ? `$${Number(r.monto_total).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : "—",
  monto_total: r.monto_total != null ? Number(r.monto_total) : 0,
  fecha_reserva: r.fecha_reserva
    ? new Date(r.fecha_reserva).toISOString()
    : null,
  observaciones: r.observaciones ?? null,
  moneda: r.moneda ?? "USD",
});

export const getReservas = async (req, res, next) => {
  try {
    const { search, estado } = req.query;

    const andConditions = [{ estado_reserva: { not: "cancelada" } }];

    if (estado && estado !== "all") {
      const estadoMap = {
        confirmed: ["confirmada", "Confirmado", "Confirmada"],
        pending: ["pendiente", "Pendiente", "Pendente"],
        paid: ["Pagado", "pagado", "Pago"],
      };
      const values = estadoMap[estado];
      if (values) {
        andConditions.push({ estado_reserva: { in: values } });
      }
    }

    if (search) {
      andConditions.push({
        OR: [
          { codigo_reserva: { contains: search, mode: "insensitive" } },
          { CLIENTE: { nombre: { contains: search, mode: "insensitive" } } },
          { CLIENTE: { apellido: { contains: search, mode: "insensitive" } } },
          {
            VIAJE: {
              CRUCERO: {
                nombre: { contains: search, mode: "insensitive" },
              },
            },
          },
          {
            VIAJE: {
              nombre_viaje: { contains: search, mode: "insensitive" },
            },
          },
        ],
      });
    }

    const reservas = await prisma.rESERVA.findMany({
      where: { AND: andConditions },
      select: reservaSelect,
      orderBy: { fecha_reserva: "desc" },
    });

    const data = serialize(reservas).map(normalizeReserva);
    res.json({ ok: true, data, total: data.length });
  } catch (error) {
    next(error);
  }
};

export const createReserva = async (req, res, next) => {
  try {
    const { id_cliente, id_viaje, id_habitacion, estado_reserva, monto_total, observaciones } =
      req.body;

    if (!id_cliente || !id_viaje) {
      return res
        .status(400)
        .json({ ok: false, message: "Pasajero y viaje son requeridos." });
    }

    const cliente = await prisma.cLIENTE.findFirst({
      where: { id_cliente: Number(id_cliente) },
    });
    if (!cliente) {
      return res
        .status(404)
        .json({ ok: false, message: "Pasajero no encontrado." });
    }

    if (id_habitacion) {
      const occupied = await prisma.aSIGNACION_CABINA.findFirst({
        where: {
          id_habitacion: Number(id_habitacion),
          estado_asignacion: "activa",
          RESERVA: { estado_reserva: { not: "cancelada" } },
        },
      });
      if (occupied) {
        return res.status(409).json({
          ok: false,
          message: "La cabina ya está ocupada por otra reserva activa.",
        });
      }
    }

    const codigo = `RES-${Date.now().toString(36).toUpperCase()}`;

    const created = await prisma.rESERVA.create({
      data: {
        id_cliente: Number(id_cliente),
        id_viaje: Number(id_viaje),
        estado_reserva: estado_reserva ?? "Pendiente",
        monto_total: monto_total ? Number(monto_total) : null,
        observaciones: observaciones ?? null,
        codigo_reserva: codigo,
        fecha_reserva: new Date(),
        ...(id_habitacion
          ? {
              ASIGNACION_CABINA: {
                create: {
                  id_habitacion: Number(id_habitacion),
                  fecha_asignacion: new Date(),
                  estado_asignacion: "activa",
                },
              },
            }
          : {}),
      },
      select: reservaSelect,
    });

    res
      .status(201)
      .json({ ok: true, data: normalizeReserva(serialize(created)) });
  } catch (error) {
    next(error);
  }
};

export const updateReserva = async (req, res, next) => {
  try {
    let id;
    try {
      id = BigInt(req.params.id);
    } catch {
      return res
        .status(400)
        .json({ ok: false, message: "ID de reserva inválido." });
    }

    const { estado_reserva, id_habitacion, monto_total, observaciones } =
      req.body;

    const existing = await prisma.rESERVA.findFirst({
      where: { id_reserva: id },
    });
    if (!existing) {
      return res
        .status(404)
        .json({ ok: false, message: "Reserva no encontrada." });
    }

    if (id_habitacion !== undefined && id_habitacion !== null) {
      const newCabinId = Number(id_habitacion);

      const occupied = await prisma.aSIGNACION_CABINA.findFirst({
        where: {
          id_habitacion: newCabinId,
          estado_asignacion: "activa",
          id_reserva: { not: id },
          RESERVA: { estado_reserva: { not: "cancelada" } },
        },
      });
      if (occupied) {
        return res.status(409).json({
          ok: false,
          message: "La cabina ya está ocupada por otra reserva activa.",
        });
      }

      // Release active assignments for this reservation
      await prisma.aSIGNACION_CABINA.updateMany({
        where: { id_reserva: id, estado_asignacion: "activa" },
        data: { estado_asignacion: "liberada" },
      });

      // Upsert the new cabin assignment
      const existingAssign = await prisma.aSIGNACION_CABINA.findUnique({
        where: {
          id_reserva_id_habitacion: { id_reserva: id, id_habitacion: newCabinId },
        },
      });
      if (existingAssign) {
        await prisma.aSIGNACION_CABINA.update({
          where: {
            id_reserva_id_habitacion: { id_reserva: id, id_habitacion: newCabinId },
          },
          data: { estado_asignacion: "activa", fecha_asignacion: new Date() },
        });
      } else {
        await prisma.aSIGNACION_CABINA.create({
          data: {
            id_reserva: id,
            id_habitacion: newCabinId,
            fecha_asignacion: new Date(),
            estado_asignacion: "activa",
          },
        });
      }
    }

    const updated = await prisma.rESERVA.update({
      where: { id_reserva: id },
      data: {
        ...(estado_reserva !== undefined && { estado_reserva }),
        ...(monto_total !== undefined && { monto_total: Number(monto_total) }),
        ...(observaciones !== undefined && { observaciones }),
      },
      select: reservaSelect,
    });

    res.json({ ok: true, data: normalizeReserva(serialize(updated)) });
  } catch (error) {
    next(error);
  }
};

export const cancelarReserva = async (req, res, next) => {
  try {
    let id;
    try {
      id = BigInt(req.params.id);
    } catch {
      return res
        .status(400)
        .json({ ok: false, message: "ID de reserva inválido." });
    }

    const existing = await prisma.rESERVA.findFirst({
      where: { id_reserva: id },
    });
    if (!existing) {
      return res
        .status(404)
        .json({ ok: false, message: "Reserva no encontrada." });
    }

    await prisma.aSIGNACION_CABINA.updateMany({
      where: { id_reserva: id },
      data: { estado_asignacion: "liberada" },
    });

    await prisma.rESERVA.update({
      where: { id_reserva: id },
      data: { estado_reserva: "cancelada" },
    });

    res.json({ ok: true, message: "Reserva cancelada correctamente." });
  } catch (error) {
    next(error);
  }
};

export const getViajesCatalogo = async (_req, res, next) => {
  try {
    const viajes = await prisma.vIAJE.findMany({
      select: {
        id_viaje: true,
        nombre_viaje: true,
        fecha_salida_real: true,
        CRUCERO: { select: { id_crucero: true, nombre: true } },
      },
      orderBy: { id_viaje: "desc" },
      take: 200,
    });
    const data = serialize(viajes).map((v) => ({
      id: String(v.id_viaje),
      nombre: v.nombre_viaje ?? `Viaje #${v.id_viaje}`,
      fecha_salida: v.fecha_salida_real,
      crucero_id:
        v.CRUCERO?.id_crucero != null ? String(v.CRUCERO.id_crucero) : null,
      crucero_nombre: v.CRUCERO?.nombre ?? null,
    }));
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
};

export const getProximasSalidas = async (_req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const viajes = await prisma.vIAJE.findMany({
      where: {
        fecha_salida_real: { gte: today },
        estado_publicacion: "publicado",
      },
      select: {
        id_viaje: true,
        nombre_viaje: true,
        fecha_salida_real: true,
        fecha_llegada_real: true,
        duracion_dias: true,
        CRUCERO: { select: { nombre: true } },
      },
      orderBy: { fecha_salida_real: "asc" },
      take: 5,
    });

    const data = serialize(viajes).map((v) => ({
      id: String(v.id_viaje),
      nombre: v.nombre_viaje ?? `Viaje #${v.id_viaje}`,
      fecha_salida: v.fecha_salida_real,
      fecha_llegada: v.fecha_llegada_real,
      duracion_dias: v.duracion_dias,
      crucero: v.CRUCERO?.nombre ?? null,
    }));

    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
};
