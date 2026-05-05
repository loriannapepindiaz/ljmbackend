import prisma from "../../prismaClient.js";

const serialize = (data) =>
  JSON.parse(JSON.stringify(data, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  ));

const INACTIVE = "Inactivo";

const pagoSelect = {
  id_pago: true,
  id_reserva: true,
  monto: true,
  fecha_pago: true,
  estado: true,
  referencia_bancaria: true,
  notas: true,
  MONEDA: { select: { codigo: true } },
  METODO_PAGO: { select: { tipo_nombre: true } },
  RESERVA: {
    select: {
      codigo_reserva: true,
      estado_reserva: true,
      monto_total: true,
      moneda: true,
      CLIENTE: { select: { nombre: true, apellido: true, email: true } },
      VIAJE: {
        select: {
          nombre_viaje: true,
          CRUCERO: { select: { nombre: true } },
        },
      },
    },
  },
};

const normalizePago = (p) => ({
  id: String(p.id_pago),
  reserva_id: String(p.id_reserva),
  reserva_codigo: p.RESERVA?.codigo_reserva ?? null,
  pasajero: p.RESERVA?.CLIENTE
    ? [p.RESERVA.CLIENTE.nombre, p.RESERVA.CLIENTE.apellido].filter(Boolean).join(" ") || "—"
    : "—",
  pasajero_email: p.RESERVA?.CLIENTE?.email ?? null,
  ruta: p.RESERVA?.VIAJE?.CRUCERO?.nombre ?? p.RESERVA?.VIAJE?.nombre_viaje ?? "—",
  viaje_nombre: p.RESERVA?.VIAJE?.nombre_viaje ?? null,
  fecha_pago: p.fecha_pago ? new Date(p.fecha_pago).toISOString() : null,
  monto: p.monto != null ? Number(p.monto) : 0,
  monto_formatted:
    p.monto != null
      ? `$${Number(p.monto).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : "—",
  estado: p.estado ?? "Pendiente",
  moneda: p.MONEDA?.codigo ?? p.RESERVA?.moneda ?? "USD",
  metodo_pago: p.METODO_PAGO?.tipo_nombre ?? null,
  referencia: p.referencia_bancaria ?? null,
  notas: (() => {
    if (!p.notas) return null;
    try {
      const parsed = JSON.parse(p.notas);
      return typeof parsed === "object" ? null : p.notas;
    } catch {
      return p.notas;
    }
  })(),
  reserva_estado: p.RESERVA?.estado_reserva ?? null,
  reserva_monto: p.RESERVA?.monto_total != null ? Number(p.RESERVA.monto_total) : null,
});

const findOrCreateUSD = async () =>
  prisma.mONEDA.upsert({
    where: { codigo: "USD" },
    update: {},
    create: { codigo: "USD", nombre: "Dólar Estadounidense" },
  });

export const getPagos = async (req, res, next) => {
  try {
    const { search, estado, last30 } = req.query;

    const andConditions = [{ estado: { not: INACTIVE } }];

    if (estado && estado !== "all") {
      const map = {
        paid:     "Pagado",
        pending:  "Pendiente",
        refunded: "Reembolsado",
      };
      if (map[estado]) andConditions.push({ estado: map[estado] });
    }

    if (last30 === "true") {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      andConditions.push({ fecha_pago: { gte: cutoff } });
    }

    if (search) {
      andConditions.push({
        OR: [
          { referencia_bancaria: { contains: search, mode: "insensitive" } },
          { RESERVA: { codigo_reserva: { contains: search, mode: "insensitive" } } },
          { RESERVA: { CLIENTE: { nombre:   { contains: search, mode: "insensitive" } } } },
          { RESERVA: { CLIENTE: { apellido: { contains: search, mode: "insensitive" } } } },
          { RESERVA: { VIAJE: { CRUCERO: { nombre: { contains: search, mode: "insensitive" } } } } },
          { RESERVA: { VIAJE: { nombre_viaje: { contains: search, mode: "insensitive" } } } },
        ],
      });
    }

    const pagos = await prisma.pago_reserva.findMany({
      where: { AND: andConditions },
      select: pagoSelect,
      orderBy: { fecha_pago: "desc" },
    });

    const data = serialize(pagos).map(normalizePago);
    res.json({ ok: true, data, total: data.length });
  } catch (error) {
    next(error);
  }
};

export const createPagoAdmin = async (req, res, next) => {
  try {
    const { id_reserva, estado, monto, notas } = req.body;

    if (!id_reserva) {
      return res.status(400).json({ ok: false, message: "La reserva es requerida." });
    }

    const reserva = await prisma.rESERVA.findFirst({
      where: { id_reserva: BigInt(id_reserva) },
      select: { id_reserva: true, moneda: true, monto_total: true, estado_reserva: true },
    });

    if (!reserva) {
      return res.status(404).json({ ok: false, message: "Reserva no encontrada." });
    }

    // Check for existing active non-refunded payment
    const existing = await prisma.pago_reserva.findFirst({
      where: {
        id_reserva: reserva.id_reserva,
        estado: { in: ["Pagado", "Pendiente"] },
      },
    });
    if (existing) {
      return res.status(409).json({
        ok: false,
        message: "Ya existe un pago activo para esta reserva.",
      });
    }

    const moneda = await findOrCreateUSD();
    const montoFinal = monto ? Number(monto) : Number(reserva.monto_total ?? 0);

    const estadoFinal = estado ?? "Pendiente";

    const created = await prisma.$transaction(async (tx) => {
      const pago = await tx.pago_reserva.create({
        data: {
          id_reserva: reserva.id_reserva,
          id_moneda: moneda.id_moneda,
          monto: montoFinal,
          estado: estadoFinal,
          referencia_bancaria: `ADMIN-${reserva.id_reserva}-${Date.now()}`,
          notas: notas ?? null,
        },
        select: pagoSelect,
      });

      // If payment is marked as Pagado, update reservation state
      if (estadoFinal === "Pagado") {
        await tx.rESERVA.update({
          where: { id_reserva: reserva.id_reserva },
          data: { estado_reserva: "Pagado", monto_total: montoFinal },
        });
      }

      return pago;
    });

    res.status(201).json({ ok: true, data: normalizePago(serialize(created)) });
  } catch (error) {
    next(error);
  }
};

export const updatePago = async (req, res, next) => {
  try {
    let id;
    try { id = BigInt(req.params.id); } catch {
      return res.status(400).json({ ok: false, message: "ID de pago inválido." });
    }

    const { estado, monto, notas } = req.body;

    const existing = await prisma.pago_reserva.findFirst({ where: { id_pago: id } });
    if (!existing) {
      return res.status(404).json({ ok: false, message: "Pago no encontrado." });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const pago = await tx.pago_reserva.update({
        where: { id_pago: id },
        data: {
          ...(estado !== undefined && { estado }),
          ...(monto  !== undefined && { monto: Number(monto) }),
          ...(notas  !== undefined && { notas }),
        },
        select: pagoSelect,
      });

      // Sync reservation state when payment is marked Pagado
      if (estado === "Pagado") {
        await tx.rESERVA.update({
          where: { id_reserva: existing.id_reserva },
          data: { estado_reserva: "Pagado" },
        });
      }

      return pago;
    });

    res.json({ ok: true, data: normalizePago(serialize(updated)) });
  } catch (error) {
    next(error);
  }
};

export const inactivarPago = async (req, res, next) => {
  try {
    let id;
    try { id = BigInt(req.params.id); } catch {
      return res.status(400).json({ ok: false, message: "ID de pago inválido." });
    }

    const existing = await prisma.pago_reserva.findFirst({ where: { id_pago: id } });
    if (!existing) {
      return res.status(404).json({ ok: false, message: "Pago no encontrado." });
    }

    await prisma.pago_reserva.update({
      where: { id_pago: id },
      data: { estado: INACTIVE },
    });

    res.json({ ok: true, message: "Pago eliminado correctamente." });
  } catch (error) {
    next(error);
  }
};
