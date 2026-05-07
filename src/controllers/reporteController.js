import prisma from "../../prismaClient.js";

const PAID_STATUSES = ["Pagado", "PAGADO", "pagado", "Pago", "PAGO"];
const CANCELLED_STATUSES = ["cancelada", "Cancelada", "CANCELADA", "cancelado", "Cancelado", "CANCELADO"];
const MONTHS_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

const toNumber = (value) => (value == null ? 0 : Number(value));

const round = (value, decimals = 2) => {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};

const parseDate = (value, fallback) => {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
};

const startOfMonth = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

const endOfMonth = (date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));

const addMonths = (date, months) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));

const buildRange = (query) => {
  const now = new Date();
  const defaultStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const defaultEnd = new Date(Date.UTC(now.getUTCFullYear(), 11, 31, 23, 59, 59, 999));
  const start = startOfMonth(parseDate(query.fecha_inicio, defaultStart));
  const end = endOfMonth(parseDate(query.fecha_fin, defaultEnd));

  return start <= end ? { start, end } : { start: startOfMonth(end), end: endOfMonth(start) };
};

const monthKey = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

const buildMonthlyBuckets = (start, end) => {
  const buckets = [];
  for (let cursor = startOfMonth(start); cursor <= end; cursor = addMonths(cursor, 1)) {
    buckets.push({
      key: monthKey(cursor),
      mes: MONTHS_SHORT[cursor.getUTCMonth()],
      total: 0,
    });
  }
  return buckets;
};

const reservationDateWhere = (start, end) => ({
  fecha_reserva: {
    gte: start,
    lte: end,
  },
});

const activeReservationWhere = (start, end) => ({
  ...reservationDateWhere(start, end),
  estado_reserva: { notIn: CANCELLED_STATUSES },
});

const paidPaymentsWhere = (start, end) => ({
  estado: { in: PAID_STATUSES },
  fecha_pago: {
    gte: start,
    lte: end,
  },
});

const getReservationCount = (start, end) =>
  prisma.rESERVA.count({
    where: activeReservationWhere(start, end),
  });

const getGrowth = async (start, end) => {
  const currentCount = await getReservationCount(start, end);
  const monthsInRange =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() + 1;
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = startOfMonth(addMonths(start, -monthsInRange));
  const previousCount = await getReservationCount(previousStart, previousEnd);

  if (previousCount === 0) return currentCount > 0 ? 100 : 0;
  return round(((currentCount - previousCount) / previousCount) * 100);
};

const getOccupancy = async (start, end) => {
  const [totalCabins, occupiedCabins, reservedCabins] = await Promise.all([
    prisma.hABITACION.count({
      where: {
        estado: { notIn: ["Inactivo", "inactivo", "fuera_servicio", "Fuera de servicio"] },
      },
    }),
    prisma.aSIGNACION_CABINA.findMany({
      where: {
        estado_asignacion: "activa",
        RESERVA: activeReservationWhere(start, end),
      },
      distinct: ["id_habitacion"],
      select: { id_habitacion: true },
    }),
    prisma.rESERVA.aggregate({
      where: {
        ...activeReservationWhere(start, end),
        id_viaje: { not: null },
      },
      _sum: { numero_habitaciones: true },
    }),
  ]);

  if (totalCabins <= 0) return 0;

  const occupiedCount = occupiedCabins.length > 0 ? occupiedCabins.length : Number(reservedCabins._sum.numero_habitaciones ?? 0);
  return round(Math.min((occupiedCount / totalCabins) * 100, 100));
};

const getSatisfaction = async () => {
  const [avg, total] = await Promise.all([
    prisma.testimonios.aggregate({
      _avg: { puntuacion: true },
      _count: { puntuacion: true },
    }),
    prisma.testimonios.count(),
  ]);

  return {
    promedio: round(avg._avg.puntuacion ?? 0, 1),
    total: avg._count.puntuacion ?? 0,
  };
};

const getMonthlyIncome = async (start, end) => {
  const payments = await prisma.pago_reserva.findMany({
    where: paidPaymentsWhere(start, end),
    select: {
      monto: true,
      fecha_pago: true,
    },
  });

  const buckets = buildMonthlyBuckets(start, end);
  const totals = new Map(buckets.map((bucket) => [bucket.key, bucket]));

  let totalIncome = 0;
  payments.forEach((payment) => {
    const total = toNumber(payment.monto);
    totalIncome += total;
    const bucket = totals.get(monthKey(payment.fecha_pago));
    if (bucket) bucket.total = round(bucket.total + total);
  });

  return {
    totalIncome: round(totalIncome),
    ingresosPorMes: buckets.map(({ mes, total }) => ({ mes, total })),
  };
};

const norm = (s) => (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const normalizeService = (nombre, categoria) => {
  // Use the activity NAME to classify (categoria stores destination, not service type)
  const n = norm(nombre);
  const c = norm(categoria);
  const text = `${n} ${c}`;

  if (text.includes("spa") || text.includes("wellness") || text.includes("masaje") || text.includes("relax") || text.includes("bienestar") || text.includes("facial") || text.includes("sauna")) return "Spa & Wellness";
  if (text.includes("cena") || text.includes("dining") || text.includes("restaur") || text.includes("gastr") || text.includes("comida") || text.includes("buffet") || text.includes("cocina") || text.includes("brunch") || text.includes("almuerzo") || text.includes("bebida")) return "Dining";
  // Everything else (tours, excursions, water sports, adventures, safaris, etc.)
  return "Excursiones";
};

const getIncomeByService = async (start, end) => {
  const totals = { Cruceros: 0, Dining: 0, Excursiones: 0, "Spa & Wellness": 0 };

  // Step 1: total paid (pago_reserva) — this covers the whole reservation (cruise + addons)
  try {
    const payments = await prisma.pago_reserva.findMany({
      where: paidPaymentsWhere(start, end),
      select: { monto: true },
    });
    totals.Cruceros = payments.reduce((sum, p) => sum + toNumber(p.monto), 0);
  } catch (e) {
    console.error("[incomeByService/pagos]", e?.message);
  }

  // Step 2: experience addons added by clients — deduct from Cruceros and assign to each service
  try {
    const experiences = await prisma.reserva_experiencia.findMany({
      where: {
        RESERVA: {
          fecha_reserva: { gte: start, lte: end },
          estado_reserva: { notIn: CANCELLED_STATUSES },
        },
      },
      select: {
        subtotal: true,
        cantidad: true,
        precio_unitario: true,
        experiencias: { select: { nombre: true, categoria: true } },
      },
    });

    experiences.forEach((item) => {
      const service = normalizeService(item.experiencias?.nombre, item.experiencias?.categoria);
      if (!service) return;
      const amount = item.subtotal == null
        ? toNumber(item.precio_unitario) * Number(item.cantidad ?? 1)
        : toNumber(item.subtotal);
      totals[service] += amount;
      // Deduct from Cruceros since the total payment already includes these addons
      totals.Cruceros = Math.max(0, totals.Cruceros - amount);
    });

  } catch (e) {
    console.error("[incomeByService/experiencias]", e?.message);
  }

  const grandTotal = Object.values(totals).reduce((sum, v) => sum + v, 0);
  return Object.entries(totals).map(([servicio, total]) => ({
    servicio,
    total: round(total),
    porcentaje: grandTotal > 0 ? round((total / grandTotal) * 100) : 0,
  }));
};

const getOccupancyByCruise = async (start, end) => {
  const cruises = await prisma.cRUCERO.findMany({
    where: { activo: true },
    select: {
      id_crucero: true,
      nombre: true,
      capacidad_max_pasajeros: true,
      CUBIERTA: {
        select: {
          HABITACION: {
            where: {
              estado: { notIn: ["Inactivo", "inactivo", "fuera_servicio", "Fuera de servicio"] },
            },
            select: { id_habitacion: true },
          },
        },
      },
    },
    orderBy: { nombre: "asc" },
  });

  const assignments = await prisma.aSIGNACION_CABINA.findMany({
    where: {
      estado_asignacion: "activa",
      RESERVA: {
        fecha_reserva: { gte: start, lte: end },
        estado_reserva: { notIn: CANCELLED_STATUSES },
        VIAJE: { CRUCERO: { activo: true } },
      },
    },
    select: {
      id_habitacion: true,
      RESERVA: {
        select: {
          VIAJE: {
            select: {
              id_crucero: true,
            },
          },
        },
      },
    },
  });

  const occupiedByCruise = new Map();
  assignments.forEach((assignment) => {
    const cruiseId = assignment.RESERVA?.VIAJE?.id_crucero;
    if (!cruiseId) return;
    if (!occupiedByCruise.has(cruiseId)) occupiedByCruise.set(cruiseId, new Set());
    occupiedByCruise.get(cruiseId).add(assignment.id_habitacion);
  });

  const reservationsByCruise = new Map();

  if (assignments.length === 0) {
    const reservations = await prisma.rESERVA.findMany({
      where: {
        ...activeReservationWhere(start, end),
        id_viaje: { not: null },
        VIAJE: { CRUCERO: { activo: true } },
      },
      select: {
        pasajeros_adultos: true,
        pasajeros_ninos: true,
        numero_habitaciones: true,
        VIAJE: {
          select: {
            id_crucero: true,
          },
        },
      },
    });

    reservations.forEach((reservation) => {
      const cruiseId = reservation.VIAJE?.id_crucero;
      if (!cruiseId) return;
      const current = reservationsByCruise.get(cruiseId) ?? { rooms: 0, passengers: 0 };
      current.rooms += Number(reservation.numero_habitaciones ?? 1);
      current.passengers += Number(reservation.pasajeros_adultos ?? 0) + Number(reservation.pasajeros_ninos ?? 0);
      reservationsByCruise.set(cruiseId, current);
    });
  }

  return cruises
    .map((cruise) => {
      const totalCabins = cruise.CUBIERTA.reduce((sum, deck) => sum + deck.HABITACION.length, 0);
      const fallback = reservationsByCruise.get(cruise.id_crucero);
      const occupied = occupiedByCruise.get(cruise.id_crucero)?.size ?? fallback?.rooms ?? 0;
      const denominator = totalCabins > 0 ? totalCabins : Number(cruise.capacidad_max_pasajeros ?? 0);
      const numerator = totalCabins > 0 ? occupied : fallback?.passengers ?? 0;
      const ocupacion = denominator > 0 ? round(Math.min((numerator / denominator) * 100, 100)) : 0;

      return {
        crucero: cruise.nombre ?? `Crucero #${cruise.id_crucero}`,
        name: cruise.nombre ?? `Crucero #${cruise.id_crucero}`,
        ocupacion,
        value: ocupacion,
      };
    })
    .filter((item) => item.ocupacion > 0)
    .slice(0, 8);
};

const settle = (promise, fallback) =>
  promise.then((v) => v).catch((err) => {
    console.error("[reportes]", err?.message ?? err);
    return fallback;
  });


export const getReporteEjecutivo = async (_req, res, next) => {
  try {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));

    const serial = `LJM-${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;

    const CONFIRMED = ["confirmada", "Confirmada", "CONFIRMADA", "confirmado", "Confirmado"];
    const PENDING   = ["pendiente", "Pendiente", "PENDIENTE"];

    const [total, confirmadas, pendientes, pagoAgg, transacciones] = await Promise.all([
      settle(prisma.rESERVA.count({ where: { fecha_reserva: { gte: monthStart, lte: monthEnd } } }), 0),
      settle(prisma.rESERVA.count({ where: { fecha_reserva: { gte: monthStart, lte: monthEnd }, estado_reserva: { in: CONFIRMED } } }), 0),
      settle(prisma.rESERVA.count({ where: { fecha_reserva: { gte: monthStart, lte: monthEnd }, estado_reserva: { in: PENDING } } }), 0),
      settle(prisma.pago_reserva.aggregate({
        where: { estado: { in: PAID_STATUSES }, fecha_pago: { gte: monthStart, lte: monthEnd } },
        _sum: { monto: true },
      }), { _sum: { monto: null } }),
      settle(prisma.pago_reserva.findMany({
        where: { fecha_pago: { gte: monthStart, lte: monthEnd } },
        select: {
          monto: true, fecha_pago: true, estado: true,
          RESERVA: {
            select: {
              codigo_reserva: true, estado_reserva: true,
              CLIENTE: { select: { nombre: true, apellido: true } },
              VIAJE:   { select: { nombre_viaje: true } },
            },
          },
        },
        orderBy: { fecha_pago: "desc" },
        take: 15,
      }), []),
    ]);

    // Weekly buckets (week 1–4 of the month)
    const weeks = [
      { label: "SEMANA 01", reservas: 0, ingresos: 0 },
      { label: "SEMANA 02", reservas: 0, ingresos: 0 },
      { label: "SEMANA 03", reservas: 0, ingresos: 0 },
      { label: "SEMANA 04", reservas: 0, ingresos: 0 },
    ];

    transacciones.forEach((p) => {
      const day = new Date(p.fecha_pago).getUTCDate();
      const wi = day <= 7 ? 0 : day <= 14 ? 1 : day <= 21 ? 2 : 3;
      weeks[wi].ingresos += toNumber(p.monto);
      weeks[wi].reservas += 1;
    });
    weeks.forEach((w) => { w.ingresos = round(w.ingresos); });

    const maxIngresos = Math.max(...weeks.map((w) => w.ingresos), 1);

    const data = {
      serial,
      fecha_generado: now.toISOString(),
      resumen: {
        total,
        confirmadas,
        pendientes,
        ingresos_totales: round(toNumber(pagoAgg._sum.monto)),
        pct_confirmadas: total > 0 ? round((confirmadas / total) * 100) : 0,
        pct_pendientes:  total > 0 ? round((pendientes  / total) * 100) : 0,
        pct_otros:       total > 0 ? round(((total - confirmadas - pendientes) / total) * 100) : 0,
      },
      semanas: weeks.map((w) => ({ ...w, pct: round((w.ingresos / maxIngresos) * 100) })),
      transacciones: transacciones.map((p) => ({
        fecha:        p.fecha_pago,
        codigo:       p.RESERVA?.codigo_reserva ?? "—",
        cliente:      p.RESERVA?.CLIENTE ? `${p.RESERVA.CLIENTE.nombre ?? ""} ${p.RESERVA.CLIENTE.apellido ?? ""}`.trim() : "—",
        viaje:        p.RESERVA?.VIAJE?.nombre_viaje ?? "—",
        estado_pago:  p.estado ?? "—",
        estado_reserva: p.RESERVA?.estado_reserva ?? "—",
        monto:        round(toNumber(p.monto)),
      })),
    };

    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
};

export const getReportes = async (req, res, next) => {
  try {
    const { start, end } = buildRange(req.query);

    const [income, tasaOcupacion, satisfaccion, crecimientoReservas, ingresosPorServicio, ocupacionPorCrucero] =
      await Promise.all([
        settle(getMonthlyIncome(start, end),    { totalIncome: 0, ingresosPorMes: [] }),
        settle(getOccupancy(start, end),         0),
        settle(getSatisfaction(),                { promedio: 0, total: 0 }),
        settle(getGrowth(start, end),            0),
        settle(getIncomeByService(start, end),   []),
        settle(getOccupancyByCruise(start, end), []),
      ]);

    const data = {
      ingresos_mensuales:   income.totalIncome,
      tasa_ocupacion:       tasaOcupacion,
      satisfaccion_cliente: satisfaccion.promedio,
      satisfaccion_total:   satisfaccion.total,
      crecimiento_reservas: crecimientoReservas,
      ingresos_por_mes:     income.ingresosPorMes,
      ingresos_por_servicio: ingresosPorServicio,
      ocupacion_por_crucero: ocupacionPorCrucero,
    };

    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
};
