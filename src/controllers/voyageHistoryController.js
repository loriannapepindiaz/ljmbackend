import prisma from "../../prismaClient.js";
import { HttpError } from "../utils/httpError.js";

const serialize = (data) =>
  JSON.parse(JSON.stringify(data, (_key, value) => (typeof value === "bigint" ? value.toString() : value)));

const getClientId = (req) => {
  const clientId = Number(req.auth?.clientId);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    throw new HttpError(403, "Esta accion requiere una cuenta de cliente.");
  }
  return clientId;
};

const buildMemberCode = (clientId) => `LJM-${String(clientId).padStart(6, "0")}`;

const ensureMemberCode = async (client) => {
  if (client.member_code) return client;

  return prisma.cLIENTE.update({
    where: { id_cliente: client.id_cliente },
    data: { member_code: buildMemberCode(client.id_cliente) },
  });
};

const parseReservationDraft = (observaciones) => {
  if (!observaciones) return {};

  try {
    return JSON.parse(observaciones)?.bookingDraft ?? {};
  } catch {
    return {};
  }
};

const getDurationDays = (draft, reservation) => {
  const candidates = [
    reservation?.VIAJE?.duracion_dias,
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

const addDays = (value, days) => {
  if (!value || !days) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  date.setDate(date.getDate() + days);
  return date;
};

const includeReservationVoyage = {
  VIAJE: {
    include: {
      CRUCERO: true,
      destinos: true,
    },
  },
  PASAJERO: true,
  ASIGNACION_CABINA: {
    include: {
      HABITACION: {
        include: {
          TIPO_HABITACION: true,
        },
      },
    },
  },
  pago_reserva: {
    include: { MONEDA: true, METODO_PAGO: true },
    orderBy: { fecha_pago: "desc" },
  },
  reserva_experiencia: { include: { experiencias: true } },
};

const reservationDate = (reservation, draft = parseReservationDraft(reservation?.observaciones)) =>
  reservation?.VIAJE?.fecha_salida_real ??
  draft.departureDate ??
  draft.fecha_salida ??
  draft.fechaSalida ??
  draft.fecha_inicio ??
  draft.fechaInicio ??
  draft.startDate ??
  draft.travelDate ??
  addDays(reservation?.fecha_reserva, 60) ??
  null;

const reservationReturnDate = (reservation, draft = parseReservationDraft(reservation?.observaciones)) =>
  reservation?.VIAJE?.fecha_llegada_real ??
  draft.returnDate ??
  draft.fecha_llegada ??
  draft.fecha_regreso ??
  draft.fechaLlegada ??
  draft.fechaRegreso ??
  addDays(reservationDate(reservation, draft), getDurationDays(draft, reservation));

const isFutureDate = (value, now) => {
  if (!value) return false;

  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date >= now;
};

const isPastDate = (value, now) => {
  if (!value) return false;

  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date < now;
};

const cabinName = (reservation, draft) =>
  reservation.ASIGNACION_CABINA?.[0]?.HABITACION?.TIPO_HABITACION?.nombre ??
  draft.suite?.title ??
  "Habitacion por confirmar";

const destinationName = (reservation, draft) =>
  draft.destination?.titulo ??
  reservation.VIAJE?.destinos?.titulo ??
  reservation.VIAJE?.nombre_viaje ??
  "Destino por confirmar";

const shipName = (reservation, draft) => reservation.VIAJE?.CRUCERO?.nombre ?? draft.ship?.title ?? "LJM Sealine";

const destinationImageFallbacks = {
  "escape de aguas cristalinas": "https://images.unsplash.com/photo-1548574505-5e239809ee19?auto=format&fit=crop&w=1200&q=80",
  "islas maldivas": "https://images.unsplash.com/photo-1514282401047-d79a71a590e8?auto=format&fit=crop&w=1200&q=80",
  "odisea de las islas griegas": "https://images.unsplash.com/photo-1570077188670-e3a8d69ac5ff?auto=format&fit=crop&w=1200&q=80",
  "serenidad tropical": "https://images.unsplash.com/photo-1514282401047-d79a71a590e8?auto=format&fit=crop&w=1200&q=80",
};

const normalizeImageKey = (value) =>
  String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const firstText = (...values) =>
  values.find((value) => typeof value === "string" && value.trim()) ?? null;

const destinationImage = (reservation, draft) => {
  const destination = reservation.VIAJE?.destinos;
  const title = destinationName(reservation, draft);

  return firstText(
    draft.destination?.imagen_url,
    draft.destination?.imageUrl,
    draft.destination?.galeria_urls?.[0],
    destination?.imagen_url,
    destination?.galeria_urls?.[0],
    destinationImageFallbacks[normalizeImageKey(title)],
  );
};

const LOYALTY_MAX_TRIPS = 20;

const buildLoyalty = (client, totalTrips) => {
  const trips = Math.max(0, Number(totalTrips ?? 0));
  const progressPct = Math.min(100, Math.round((trips / LOYALTY_MAX_TRIPS) * 100));
  const remainingTrips = Math.max(LOYALTY_MAX_TRIPS - trips, 0);

  if (trips >= LOYALTY_MAX_TRIPS) {
    return { tier: "Admiral", label: "Almirante", progressPct, nightsToNextTier: 0 };
  }

  if (trips >= 12) {
    return { tier: "Navigator", label: "Navegante", progressPct, nightsToNextTier: remainingTrips };
  }

  if (trips >= 6) {
    return { tier: "Voyager", label: "Miembro Oro", progressPct, nightsToNextTier: remainingTrips };
  }

  return {
    tier: client.loyalty_tier ?? "Explorer",
    label: client.loyalty_tier_label ?? "Explorador",
    progressPct,
    nightsToNextTier: remainingTrips,
  };
};

const buildReservationSummary = (reservation) => {
  if (!reservation) return null;

  const draft = parseReservationDraft(reservation.observaciones);
  const payment = reservation.pago_reserva?.[0] ?? null;

  return {
    id: reservation.id_reserva,
    code: reservation.codigo_reserva ?? `LJM-${reservation.id_reserva}`,
    status: reservation.estado_reserva ?? "Por confirmar",
    destination: destinationName(reservation, draft),
    ship: shipName(reservation, draft),
    cabin: cabinName(reservation, draft),
    departureDate: reservationDate(reservation, draft),
    returnDate: reservationReturnDate(reservation, draft),
    nights: getDurationDays(draft, reservation),
    guests: reservation.PASAJERO?.length || reservation.pasajeros_adultos || 1,
    total: Number(payment?.monto ?? reservation.monto_total ?? 0),
    currency: payment?.MONEDA?.codigo ?? reservation.moneda ?? "USD",
    paymentStatus: payment?.estado ?? "Pendiente",
    image: destinationImage(reservation, draft),
    experiences: (reservation.reserva_experiencia ?? []).map((item) => ({
      id: item.id,
      name: item.experiencias?.nombre ?? "Experiencia",
      price: Number(item.precio_unitario ?? item.experiencias?.precio_base ?? 0),
    })),
  };
};

const buildHistoryItem = (item) => ({
  id: item.id_historial_viaje,
  reservationId: item.id_reserva,
  destination:
    item.destino_principal ??
    item.VIAJE?.destinos?.titulo ??
    "Destino registrado",
  ship: item.VIAJE?.CRUCERO?.nombre ?? "LJM Sealine",
  cabin: "Habitacion registrada",
  departureDate: item.fecha_embarque_real ?? item.VIAJE?.fecha_salida_real ?? null,
  returnDate: item.fecha_desembarque_real ?? item.VIAJE?.fecha_llegada_real ?? null,
  nights: item.noches_navegadas ?? null,
  rating: item.calificacion ?? null,
});

const buildReservationHistoryItem = (reservation) => {
  const summary = buildReservationSummary(reservation);

  return {
    id: summary.id,
    reservationId: summary.id,
    destination: summary.destination,
    ship: summary.ship,
    cabin: summary.cabin,
    departureDate: summary.departureDate,
    returnDate: summary.returnDate,
    nights: summary.nights ?? null,
    rating: null,
  };
};

const sumReservationNights = (reservations) =>
  reservations.reduce((sum, reservation) => {
    const summary = buildReservationSummary(reservation);
    return sum + Number(summary?.nights ?? 0);
  }, 0);

const sumExternalHistoryNights = (historyItems, reservationIds) =>
  historyItems.reduce((sum, item) => {
    if (item.reservationId && reservationIds.has(String(item.reservationId))) {
      return sum;
    }

    return sum + Number(item.nights ?? 0);
  }, 0);

export const getCurrentVoyageHistory = async (req, res, next) => {
  try {
    const clientId = getClientId(req);
    const now = new Date();

    const rawClient = await prisma.cLIENTE.findUnique({ where: { id_cliente: clientId } });
    const reservations = await prisma.rESERVA.findMany({
      where: {
        id_cliente: clientId,
        NOT: { estado_reserva: { equals: "borrador", mode: "insensitive" } },
      },
      include: includeReservationVoyage,
      orderBy: { fecha_reserva: "desc" },
      take: 20,
    });
    const storedHistory = await prisma.historial_viajes.findMany({
      where: {
        PASAJERO: { id_cliente_referencia: clientId },
      },
      include: {
        VIAJE: { include: { CRUCERO: true, destinos: true } },
      },
      orderBy: { fecha_embarque_real: "desc" },
      take: 8,
    });

    if (!rawClient) {
      throw new HttpError(404, "No se encontro el cliente.");
    }

    const client = await ensureMemberCode(rawClient);
    const upcomingReservation =
      reservations.find((reservation) => {
        const date = reservationDate(reservation);
        return isFutureDate(date, now);
      }) ??
      reservations.find((reservation) =>
        ["confirmada", "pagada", "pendiente"].includes(String(reservation.estado_reserva ?? "").toLowerCase()),
      ) ??
      reservations[0] ??
      null;

    const storedTravelHistory = storedHistory.map(buildHistoryItem);
    const storedReservationIds = new Set(storedTravelHistory.map((item) => String(item.reservationId)));
    const reservationTravelHistory = reservations
      .filter((reservation) => reservation.id_reserva !== upcomingReservation?.id_reserva)
      .filter((reservation) => !storedReservationIds.has(String(reservation.id_reserva)))
      .map(buildReservationHistoryItem);

    const travelHistory = [
      ...storedTravelHistory,
      ...reservationTravelHistory,
    ].slice(0, 20);
    const upcomingReservationSummary = buildReservationSummary(upcomingReservation);
    const reservationIds = new Set(reservations.map((reservation) => String(reservation.id_reserva)));
    const totalNights = sumReservationNights(reservations) + sumExternalHistoryNights(storedTravelHistory, reservationIds);
    const loyalty = buildLoyalty(client, reservations.length);

    res.json({
      ok: true,
      data: serialize({
        client: {
          id: client.id_cliente,
          memberCode: client.member_code,
          fullName: [client.nombre, client.apellido].filter(Boolean).join(" ").trim(),
        },
        loyalty: {
          tier: loyalty.tier,
          label: loyalty.label,
          progressPct: loyalty.progressPct,
          nightsToNextTier: loyalty.nightsToNextTier,
        },
        stats: {
          totalReservations: reservations.length,
          completedTrips: travelHistory.length,
          totalNights,
        },
        upcomingReservation: upcomingReservationSummary,
        travelHistory,
      }),
    });
  } catch (error) {
    next(error);
  }
};
