import prisma from "../../prismaClient.js";
import { HttpError } from "../utils/httpError.js";

const DRAFT_STATE = "pendiente";
const PAID_STATE = "Pagado";
const CONFIRMED_RESERVATION_STATE = "confirmada";

const serialize = (data) =>
  JSON.parse(JSON.stringify(data, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  ));

const getClientId = (req) => {
  const clientId = Number(req.auth?.clientId);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    throw new HttpError(403, "Esta accion requiere una cuenta de cliente.");
  }
  return clientId;
};

const parseReservationId = (payload) => {
  const rawId = payload?.reservationId ?? payload?.bookingDraft?.reservationId;
  const reservationId = Number(rawId);

  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    throw new HttpError(400, "No se recibio una reserva valida para procesar el pago.");
  }

  return BigInt(reservationId);
};

const parseAmount = (amount) => {
  const parsedAmount = Number(amount);

  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw new HttpError(400, "El monto del pago debe ser mayor que cero.");
  }

  return Number(parsedAmount.toFixed(2));
};

const findOrCreateCurrency = async (currencyCode = "USD") => {
  const code = String(currencyCode || "USD").slice(0, 3).toUpperCase();

  return prisma.mONEDA.upsert({
    where: { codigo: code },
    update: {},
    create: {
      codigo: code,
      nombre: code,
    },
  });
};

const findOrCreatePaymentMethod = async (method) => {
  const methodName = method?.name ?? method?.id;

  if (!methodName) {
    return null;
  }

  return prisma.mETODO_PAGO.upsert({
    where: { tipo_nombre: methodName },
    update: {
      activo: true,
    },
    create: {
      tipo_nombre: methodName,
      campos_requeridos: method?.type ?? null,
      activo: true,
    },
  });
};

export const createPayment = async (req, res, next) => {
  try {
    const idCliente = getClientId(req);
    const payload = req.body ?? {};
    const reservationId = parseReservationId(payload);
    const amount = parseAmount(payload.amount);

    const reservation = await prisma.rESERVA.findFirst({
      where: {
        id_reserva: reservationId,
        id_cliente: idCliente,
        estado_reserva: DRAFT_STATE,
      },
      select: {
        id_reserva: true,
        moneda: true,
      },
    });

    if (!reservation) {
      throw new HttpError(404, "No existe una reserva pendiente activa para este pago.");
    }

    const [currency, method] = await Promise.all([
      findOrCreateCurrency(payload.currency ?? reservation.moneda),
      findOrCreatePaymentMethod(payload.method),
    ]);

    const payment = await prisma.$transaction(async (tx) => {
      const createdPayment = await tx.pago_reserva.create({
        data: {
          id_reserva: reservation.id_reserva,
          id_metodo: method?.id_metodo ?? null,
          id_moneda: currency.id_moneda,
          monto: amount,
          estado: PAID_STATE,
          referencia_bancaria: `LJM-${reservation.id_reserva}-${Date.now()}`,
          notas: JSON.stringify({
            method: payload.method ?? null,
            source: "checkout",
          }),
        },
        include: {
          METODO_PAGO: true,
          MONEDA: true,
        },
      });

      await tx.rESERVA.update({
        where: { id_reserva: reservation.id_reserva },
        data: {
          estado_reserva: CONFIRMED_RESERVATION_STATE,
          monto_total: amount,
          subtotal: amount,
          moneda: currency.codigo ?? reservation.moneda,
          id_moneda: currency.id_moneda,
        },
      });

      return createdPayment;
    });

    res.status(201).json({
      ok: true,
      data: serialize({
        id: payment.id_pago,
        reservationId: payment.id_reserva,
        amount: Number(payment.monto),
        currency: payment.MONEDA?.codigo ?? payload.currency ?? reservation.moneda,
        status: payment.estado,
        method: {
          id: String(payment.id_metodo ?? payload.method?.id ?? ""),
          name: payment.METODO_PAGO?.tipo_nombre ?? payload.method?.name ?? "",
          type: payload.method?.type ?? payment.METODO_PAGO?.campos_requeridos ?? "",
          last4: payload.method?.last4,
        },
        reference: payment.referencia_bancaria,
        paidAt: payment.fecha_pago,
      }),
    });
  } catch (error) {
    next(error);
  }
};
