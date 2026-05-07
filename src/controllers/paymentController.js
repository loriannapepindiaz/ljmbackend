import prisma from "../../prismaClient.js";
import { HttpError } from "../utils/httpError.js";
import { ensureInvoiceForReservation } from "./invoiceController.js";

const DRAFT_STATE = "pendiente";
const PAID_STATE = "Pagado";
const CONFIRMED_RESERVATION_STATE = "confirmada";
const PAYMENT_LOG_PREFIX = "[Payment API]";

const logPaymentStep = (step, data = undefined) => {
  console.log(PAYMENT_LOG_PREFIX, step, data ?? "");
};

const logPaymentError = (step, error) => {
  console.error(PAYMENT_LOG_PREFIX, "ERROR", step, error);
};

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

const parseCurrencyAmount = (value) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value !== "string") {
    return 0;
  }

  const sanitizedValue = value.replace(/\s/g, "").replace(/[^\d,.-]/g, "");
  const lastComma = sanitizedValue.lastIndexOf(",");
  const lastDot = sanitizedValue.lastIndexOf(".");
  const decimalSeparator = lastComma > lastDot ? "," : ".";
  const normalizedValue = sanitizedValue.replace(/[,.]/g, (separator, index) => {
    if (separator === decimalSeparator && sanitizedValue.length - index <= 3) {
      return ".";
    }

    return "";
  });
  const parsedValue = Number(normalizedValue);

  return Number.isFinite(parsedValue) ? parsedValue : 0;
};

const normalizeAnimalCompanion = (animal) => {
  if (!animal?.nombre || !animal?.tipoAnimal) {
    return null;
  }

  return {
    nombre: String(animal.nombre).trim(),
    tipoAnimal: String(animal.tipoAnimal).trim(),
    raza: String(animal.raza ?? "").trim(),
    pesoKg: String(animal.pesoKg ?? "").trim(),
    unidadPeso: ["kg", "lb"].includes(String(animal.unidadPeso ?? "").toLowerCase())
      ? String(animal.unidadPeso).toLowerCase()
      : "kg",
    cuidadosEspeciales: String(animal.cuidadosEspeciales ?? "").trim(),
    certificadoNombre: String(animal.certificadoNombre ?? "").trim(),
    certificadoTipo: String(animal.certificadoTipo ?? "").trim(),
  };
};

const hasActivePetCare = (personalization) =>
  personalization?.services?.some((service) => service.id === "pet-care" && service.active) ?? false;

const syncAnimalCompanion = async (tx, reservationId, animalCompanion) => {
  await tx.mascota_reserva.deleteMany({
    where: { id_reserva: reservationId },
  });

  const animal = normalizeAnimalCompanion(animalCompanion);

  if (!animal) {
    return;
  }

  await tx.mascota_reserva.create({
    data: {
      id_reserva: reservationId,
      nombre_mascota: animal.nombre,
      tipo_animal: animal.tipoAnimal,
      raza: animal.raza || null,
      peso_kg: parseCurrencyAmount(animal.pesoKg) || null,
      cuidados_especiales: animal.cuidadosEspeciales || null,
      url_certificado: animal.certificadoNombre || null,
    },
  });
};

const findCabinForSuite = async (tx, suite) => {
  const cabinId = Number(suite?.idHabitacion ?? suite?.id_habitacion);
  const typeId = Number(suite?.idTipoHabitacion ?? suite?.id_tipo_habitacion ?? suite?.id);
  const title = suite?.title ?? suite?.nombre;

  if (Number.isInteger(cabinId) && cabinId > 0) {
    const cabin = await tx.hABITACION.findFirst({
      where: { id_habitacion: cabinId },
      select: {
        id_habitacion: true,
        TIPO_HABITACION: { select: { precio_noche: true } },
      },
    });

    return cabin ? { id_habitacion: cabin.id_habitacion, price: cabin.TIPO_HABITACION?.precio_noche } : null;
  }

  const type = await tx.tIPO_HABITACION.findFirst({
    where: {
      ...(Number.isInteger(typeId) && typeId > 0
        ? { id_tipo_habitacion: typeId }
        : title
          ? { nombre: { contains: title, mode: "insensitive" } }
          : {}),
    },
    select: { id_tipo_habitacion: true, precio_noche: true },
  });

  if (!type) return null;

  const cabin = await tx.hABITACION.findFirst({
    where: {
      id_tipo_habitacion: type.id_tipo_habitacion,
      estado: { equals: "disponible", mode: "insensitive" },
    },
    select: { id_habitacion: true },
    orderBy: { id_habitacion: "asc" },
  });

  return cabin ? { id_habitacion: cabin.id_habitacion, price: type.precio_noche } : null;
};

const addDays = (value, days) => {
  if (!value || !days) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  date.setDate(date.getDate() + Number(days));
  return date;
};

const getDurationDays = (draft) => {
  const candidates = [
    draft?.destination?.duracion_tipica,
    draft?.destination?.duracion_dias,
    draft?.destination?.duration,
    draft?.destination?.noches,
    draft?.destination?.nights,
    draft?.duracion_tipica,
    draft?.duracion_dias,
    draft?.duration,
    draft?.noches,
    draft?.nights,
  ];

  for (const candidate of candidates) {
    const match = String(candidate ?? "").match(/\d+/);
    const days = match ? Number(match[0]) : 0;

    if (Number.isFinite(days) && days > 0) return days;
  }

  return null;
};

const getDepartureDate = (draft) =>
  draft?.departureDate ??
  draft?.fecha_salida ??
  draft?.fechaSalida ??
  draft?.fecha_inicio ??
  draft?.fechaInicio ??
  draft?.startDate ??
  draft?.travelDate ??
  null;

const getReturnDate = (draft) =>
  draft?.returnDate ??
  draft?.fecha_llegada ??
  draft?.fecha_regreso ??
  draft?.fechaLlegada ??
  draft?.fechaRegreso ??
  addDays(getDepartureDate(draft), getDurationDays(draft));

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
    logPaymentStep("POST pago recibido", {
      idCliente,
      reservationId: payload.reservationId ?? payload.bookingDraft?.reservationId,
      amount: payload.amount,
      currency: payload.currency,
      method: payload.method,
      bookingDraftTotal: payload.bookingDraft?.total ?? payload.bookingDraft?.monto_total,
      bookingDraftCharges: payload.bookingDraft?.charges,
    });
    const reservationId = parseReservationId(payload);
    const amount = parseAmount(payload.amount);
    logPaymentStep("Pago validado", { reservationId, amount });
    const normalizedBookingDraft = payload.bookingDraft
      ? {
          ...payload.bookingDraft,
          animalCompanion: normalizeAnimalCompanion(payload.bookingDraft.animalCompanion),
          departureDate: payload.bookingDraft.departureDate ?? payload.bookingDraft.fecha_salida ?? getDepartureDate(payload.bookingDraft) ?? undefined,
          fecha_salida: payload.bookingDraft.fecha_salida ?? payload.bookingDraft.departureDate ?? getDepartureDate(payload.bookingDraft) ?? undefined,
          returnDate: payload.bookingDraft.returnDate ?? payload.bookingDraft.fecha_llegada ?? getReturnDate(payload.bookingDraft) ?? undefined,
          fecha_llegada: payload.bookingDraft.fecha_llegada ?? payload.bookingDraft.returnDate ?? getReturnDate(payload.bookingDraft) ?? undefined,
        }
      : null;
    const bookingDraftSnapshot = normalizedBookingDraft
      ? JSON.stringify({ bookingDraft: normalizedBookingDraft })
      : undefined;

    const reservation = await prisma.rESERVA.findFirst({
      where: {
        id_reserva: reservationId,
        id_cliente: idCliente,
        estado_reserva: DRAFT_STATE,
      },
      select: {
        id_reserva: true,
        moneda: true,
        ASIGNACION_CABINA: {
          select: { id_habitacion: true },
        },
      },
    });
    logPaymentStep("Reserva pendiente buscada", reservation);

    if (!reservation) {
      logPaymentError("Reserva pendiente no encontrada", { reservationId, idCliente });
      throw new HttpError(404, "No existe una reserva pendiente activa para este pago.");
    }

    const [currency, method] = await Promise.all([
      findOrCreateCurrency(payload.currency ?? reservation.moneda),
      findOrCreatePaymentMethod(payload.method),
    ]);
    logPaymentStep("Moneda y metodo resueltos", { currency, method });

    const payment = await prisma.$transaction(async (tx) => {
      logPaymentStep("Transaccion pago iniciada", { reservationId: reservation.id_reserva, amount });
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
          mascotas: hasActivePetCare(normalizedBookingDraft?.personalization) || Boolean(normalizedBookingDraft?.animalCompanion),
          ...(bookingDraftSnapshot ? { observaciones: bookingDraftSnapshot } : {}),
        },
      });

      if (!reservation.ASIGNACION_CABINA?.length && normalizedBookingDraft?.suite) {
        const cabin = await findCabinForSuite(tx, normalizedBookingDraft.suite);

        if (cabin) {
          await tx.aSIGNACION_CABINA.create({
            data: {
              id_reserva: reservation.id_reserva,
              id_habitacion: cabin.id_habitacion,
              fecha_asignacion: normalizedBookingDraft.departureDate ? new Date(normalizedBookingDraft.departureDate) : new Date(),
              fecha_hasta: normalizedBookingDraft.returnDate ? new Date(normalizedBookingDraft.returnDate) : null,
              precio_final: amount || parseCurrencyAmount(normalizedBookingDraft.suite.pricePerNight) || Number(cabin.price ?? 0),
              estado_asignacion: "activa",
            },
          });
          logPaymentStep("Asignacion de cabina asegurada en pago", { reservationId: reservation.id_reserva, cabinId: cabin.id_habitacion });
        } else {
          logPaymentError("No se pudo resolver cabina para asignacion en pago", { reservationId: reservation.id_reserva, suite: normalizedBookingDraft.suite });
        }
      }

      if (normalizedBookingDraft?.animalCompanion !== undefined) {
        await syncAnimalCompanion(tx, reservation.id_reserva, normalizedBookingDraft.animalCompanion);
      }

      logPaymentStep("Transaccion pago completada", { paymentId: createdPayment.id_pago, reservationId: reservation.id_reserva });
      return createdPayment;
    }, {
      timeout: 15000,
      maxWait: 15000,
    });

    logPaymentStep("Asegurando factura", { reservationId: reservation.id_reserva, amount });
    await ensureInvoiceForReservation(prisma, reservation.id_reserva, amount);
    logPaymentStep("Factura asegurada", { reservationId: reservation.id_reserva });

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
    logPaymentError("POST pago", error);
    next(error);
  }
};
