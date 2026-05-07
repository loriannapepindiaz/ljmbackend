import prisma from "../../prismaClient.js";
import { HttpError } from "../utils/httpError.js";

const serialize = (data) =>
  JSON.parse(JSON.stringify(data, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  ));

const parseDraftSnapshot = (observaciones) => {
  if (!observaciones) return {};

  try {
    return JSON.parse(observaciones)?.bookingDraft ?? {};
  } catch {
    return {};
  }
};

const parseReservationId = (value) => {
  const reservationId = Number(value);

  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    throw new HttpError(400, "No se recibio una reserva valida para consultar la factura.");
  }

  return BigInt(reservationId);
};

const assertReservationAccess = (req, reservation) => {
  const isAdmin = String(req.auth?.role ?? "").toLowerCase().includes("admin");
  const clientId = Number(req.auth?.clientId);

  if (isAdmin) return;

  if (!Number.isInteger(clientId) || Number(reservation.id_cliente) !== clientId) {
    throw new HttpError(403, "No tienes permiso para consultar esta factura.");
  }
};

const invoiceReservationInclude = {
  CLIENTE: true,
  PASAJERO: true,
  VIAJE: { include: { destinos: true } },
  ASIGNACION_CABINA: { include: { HABITACION: { include: { TIPO_HABITACION: true } } } },
  reserva_experiencia: { include: { experiencias: true } },
  mascota_reserva: true,
  pago_reserva: {
    include: { MONEDA: true, METODO_PAGO: true },
    orderBy: { fecha_pago: "desc" },
  },
  FACTURA: { orderBy: { id_factura: "desc" } },
};

const formatPaymentMethod = (payment) => {
  const parsedNotes = (() => {
    try {
      return JSON.parse(payment?.notas ?? "{}");
    } catch {
      return {};
    }
  })();
  const method = parsedNotes.method ?? {};

  return {
    id: String(payment?.id_metodo ?? method.id ?? ""),
    name: payment?.METODO_PAGO?.tipo_nombre ?? method.name ?? "Registrado",
    type: method.type ?? payment?.METODO_PAGO?.campos_requeridos ?? "",
    last4: method.last4,
  };
};

const buildInvoiceLines = (reservation, payment) => {
  const snapshot = parseDraftSnapshot(reservation.observaciones);
  const lines = [];
  const destination = snapshot.destination ?? reservation.VIAJE?.destinos;
  const assignedCabin = reservation.ASIGNACION_CABINA?.[0]?.HABITACION;
  const suite = snapshot.suite ?? assignedCabin?.TIPO_HABITACION;

  if (destination) {
    lines.push({
      code: "01",
      title: `Destino: ${destination.titulo ?? "Seleccionado"}`,
      description: [destination.pais, destination.puerto_principal ?? destination.ubicacion].filter(Boolean).join(" | "),
      qty: "1",
      amount: Number(destination.precio_desde ?? 0),
    });
  }

  if (suite) {
    lines.push({
      code: String(lines.length + 1).padStart(2, "0"),
      title: `Suite: ${suite.title ?? suite.nombre ?? "Alojamiento"}`,
      description: suite.capacity ?? suite.descripcion ?? assignedCabin?.numero_cabina ?? "Alojamiento asignado",
      qty: "1",
      amount: Number(suite.pricePerNight ?? suite.precio_noche ?? 0),
    });
  }

  for (const reservationExperience of reservation.reserva_experiencia ?? []) {
    lines.push({
      code: String(lines.length + 1).padStart(2, "0"),
      title: reservationExperience.experiencias?.nombre ?? "Experiencia",
      description: reservationExperience.experiencias?.descripcion ?? "Experiencia reservada",
      qty: String(reservationExperience.cantidad ?? 1),
      amount: Number(reservationExperience.subtotal ?? reservationExperience.precio_unitario ?? 0),
    });
  }

  const animalCompanion = snapshot.animalCompanion ?? reservation.mascota_reserva?.[0];

  if (animalCompanion) {
    lines.push({
      code: String(lines.length + 1).padStart(2, "0"),
      title: `Compañero animal: ${animalCompanion.nombre ?? animalCompanion.nombre_mascota ?? "Registrado"}`,
      description: [
        animalCompanion.tipoAnimal ?? animalCompanion.tipo_animal,
        animalCompanion.raza,
        animalCompanion.pesoKg ?? animalCompanion.peso_kg ? `${animalCompanion.pesoKg ?? animalCompanion.peso_kg} ${animalCompanion.unidadPeso ?? "kg"}` : null,
        animalCompanion.certificadoNombre ?? animalCompanion.url_certificado ? `Certificado: ${animalCompanion.certificadoNombre ?? animalCompanion.url_certificado}` : null,
      ].filter(Boolean).join(" | ") || "Servicio pet-care registrado",
      qty: "1",
      amount: 0,
    });
  }

  const subtotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const total = Number(payment?.monto ?? reservation.monto_total ?? 0);
  const serviceFee = Math.max(0, total - subtotal);

  if (serviceFee > 0) {
    lines.push({
      code: String(lines.length + 1).padStart(2, "0"),
      title: "Gestion y procesamiento",
      description: "Cargo de servicio asociado al pago",
      qty: "1",
      amount: serviceFee,
    });
  }

  return lines;
};

export const ensureInvoiceForReservation = async (tx, reservationId, amount) => {
  const existingInvoice = await tx.fACTURA.findFirst({
    where: { id_reserva: reservationId },
    orderBy: { id_factura: "desc" },
  });

  if (existingInvoice) {
    return tx.fACTURA.update({
      where: { id_factura: existingInvoice.id_factura },
      data: {
        monto_total: amount,
        estado_factura: "pagada",
      },
    });
  }

  return tx.fACTURA.create({
    data: {
      id_reserva: reservationId,
      fecha_emision: new Date(),
      monto_total: amount,
      numero_factura: `FAC-${reservationId}-${Date.now()}`,
      estado_factura: "pagada",
    },
  });
};

const getInvoicePayload = (reservation) => {
  const payment = reservation.pago_reserva?.[0] ?? null;
  const invoice = reservation.FACTURA?.[0] ?? null;
  const client = reservation.CLIENTE;
  const destination = reservation.VIAJE?.destinos;
  const assignedCabin = reservation.ASIGNACION_CABINA?.[0]?.HABITACION;
  const lines = buildInvoiceLines(reservation, payment);
  const currency = payment?.MONEDA?.codigo ?? reservation.moneda ?? "USD";

  return {
    invoice: invoice
      ? {
          id: invoice.id_factura,
          reservationId: invoice.id_reserva,
          number: invoice.numero_factura,
          status: invoice.estado_factura,
          issuedAt: invoice.fecha_emision,
          total: Number(invoice.monto_total ?? payment?.monto ?? reservation.monto_total ?? 0),
          currency,
        }
      : null,
    reservation: {
      id: reservation.id_reserva,
      code: reservation.codigo_reserva,
      status: reservation.estado_reserva,
      bookedAt: reservation.fecha_reserva,
      total: Number(reservation.monto_total ?? 0),
      subtotal: Number(reservation.subtotal ?? 0),
      currency,
      destination: destination
        ? {
            id: destination.id,
            title: destination.titulo,
            country: destination.pais,
            location: destination.ubicacion,
            port: destination.puerto_principal,
            duration: destination.duracion_tipica,
          }
        : null,
      suite: assignedCabin?.TIPO_HABITACION
        ? {
            id: assignedCabin.TIPO_HABITACION.id_tipo_habitacion,
            title: assignedCabin.TIPO_HABITACION.nombre,
            cabin: assignedCabin.numero_cabina,
            capacity: assignedCabin.TIPO_HABITACION.capacidad_max,
          }
        : null,
      passengers: (reservation.PASAJERO ?? []).map((passenger) => ({
        id: passenger.id_pasajero,
        name: [passenger.nombre, passenger.apellido].filter(Boolean).join(" "),
        document: passenger.documento_numero,
        isPrimary: passenger.es_titular,
      })),
      animalCompanions: (reservation.mascota_reserva ?? []).map((animal) => ({
        id: animal.id_mascota,
        name: animal.nombre_mascota,
        type: animal.tipo_animal,
        breed: animal.raza,
        weightKg: animal.peso_kg ? String(animal.peso_kg) : null,
        weightUnit: "kg",
        specialCare: animal.cuidados_especiales,
        certificateUrl: animal.url_certificado,
      })),
    },
    client: client
      ? {
          id: client.id_cliente,
          name: [client.nombre, client.apellido].filter(Boolean).join(" "),
          email: client.email,
          memberCode: client.member_code,
          loyaltyTier: client.loyalty_tier,
        }
      : null,
    payment: payment
      ? {
          id: payment.id_pago,
          reservationId: payment.id_reserva,
          amount: Number(payment.monto),
          currency,
          status: payment.estado,
          method: formatPaymentMethod(payment),
          reference: payment.referencia_bancaria,
          paidAt: payment.fecha_pago,
        }
      : null,
    items: lines,
  };
};

export const getInvoiceByReservation = async (req, res, next) => {
  try {
    const reservationId = parseReservationId(req.params.reservationId);
    const reservation = await prisma.rESERVA.findUnique({
      where: { id_reserva: reservationId },
      include: invoiceReservationInclude,
    });

    if (!reservation) {
      throw new HttpError(404, "No se encontro la reserva para facturar.");
    }

    assertReservationAccess(req, reservation);

    res.json({ ok: true, data: serialize(getInvoicePayload(reservation)) });
  } catch (error) {
    next(error);
  }
};

export const getCurrentInvoice = async (req, res, next) => {
  try {
    const clientId = Number(req.auth?.clientId);

    if (!Number.isInteger(clientId) || clientId <= 0) {
      throw new HttpError(403, "Esta accion requiere una cuenta de cliente.");
    }

    const reservation = await prisma.rESERVA.findFirst({
      where: {
        id_cliente: clientId,
        OR: [
          { estado_reserva: { equals: "confirmada", mode: "insensitive" } },
          { pago_reserva: { some: {} } },
        ],
      },
      include: invoiceReservationInclude,
      orderBy: { fecha_reserva: "desc" },
    });

    if (!reservation) {
      throw new HttpError(404, "No se encontro una reserva activa para gestionar.");
    }

    res.json({ ok: true, data: serialize(getInvoicePayload(reservation)) });
  } catch (error) {
    next(error);
  }
};
