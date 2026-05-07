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

const fullName = (...parts) => parts.filter(Boolean).join(" ").trim();

const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "LJ";

const buildTripName = (trip) =>
  trip.destino_principal ??
  trip.VIAJE?.destinos?.titulo ??
  trip.RESERVA?.VIAJE?.destinos?.titulo ??
  trip.VIAJE?.nombre_viaje ??
  trip.RESERVA?.VIAJE?.nombre_viaje ??
  "Travesia registrada";

const buildHistoryTrip = (trip) => ({
  historyId: trip.id_historial_viaje,
  reservationId: trip.id_reserva,
  voyageId: trip.id_viaje,
  title: buildTripName(trip),
  ship: trip.VIAJE?.CRUCERO?.nombre ?? trip.RESERVA?.VIAJE?.CRUCERO?.nombre ?? "LJM Sealine",
  departureDate: trip.fecha_embarque_real ?? trip.VIAJE?.fecha_salida_real ?? trip.RESERVA?.VIAJE?.fecha_salida_real ?? null,
  returnDate: trip.fecha_desembarque_real ?? trip.VIAJE?.fecha_llegada_real ?? trip.RESERVA?.VIAJE?.fecha_llegada_real ?? null,
  rating: trip.calificacion ?? null,
});

const reservationDate = (reservation) =>
  reservation.VIAJE?.fecha_salida_real ?? reservation.fecha_reserva ?? null;

const reservationReturnDate = (reservation) =>
  reservation.VIAJE?.fecha_llegada_real ?? null;

const buildReservationTrip = (reservation) => ({
  historyId: `reservation-${reservation.id_reserva}`,
  reservationId: reservation.id_reserva,
  voyageId: reservation.id_viaje,
  title:
    reservation.VIAJE?.destinos?.titulo ??
    reservation.VIAJE?.nombre_viaje ??
    "Travesia registrada",
  ship: reservation.VIAJE?.CRUCERO?.nombre ?? "LJM Sealine",
  departureDate: reservationDate(reservation),
  returnDate: reservationReturnDate(reservation),
  rating: null,
});

const timeAgo = (value) => {
  const createdAt = new Date(value);
  if (Number.isNaN(createdAt.getTime())) return "recientemente";

  const diffMs = Date.now() - createdAt.getTime();
  const minutes = Math.max(1, Math.floor(diffMs / 60000));
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} dias`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} sem`;

  const months = Math.floor(days / 30);
  return `${months} meses`;
};

const buildReview = (review) => {
  const name = review.nombre_mostrado || fullName(review.CLIENTE?.nombre, review.CLIENTE?.apellido) || "Navegante LJM";

  return {
    id: review.id,
    initials: initials(name),
    name,
    registryId: review.CLIENTE?.member_code ?? (review.id_cliente ? `LJM-${String(review.id_cliente).padStart(6, "0")}` : "LJM"),
    voyageId: review.id_viaje,
    voyageName: review.VIAJE?.destinos?.titulo ?? review.VIAJE?.nombre_viaje ?? "Travesia LJM",
    stars: review.puntuacion,
    text: review.texto,
    timeAgo: timeAgo(review.created_at),
    createdAt: review.created_at,
    mine: Boolean(review._mine),
  };
};

const buildSummary = (reviews) => {
  const distribution = [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    count: reviews.filter((review) => Number(review.puntuacion) === stars).length,
  }));
  const total = reviews.length;
  const average = total
    ? reviews.reduce((sum, review) => sum + Number(review.puntuacion ?? 0), 0) / total
    : 0;

  return {
    average: Number(average.toFixed(1)),
    total,
    distribution: distribution.map((item) => ({
      ...item,
      pct: total ? Math.round((item.count / total) * 100) : 0,
    })),
  };
};

const getClientHistory = (clientId) =>
  prisma.historial_viajes.findMany({
    where: {
      PASAJERO: { id_cliente_referencia: clientId },
    },
    include: {
      VIAJE: { include: { CRUCERO: true, destinos: true } },
      RESERVA: { include: { VIAJE: { include: { CRUCERO: true, destinos: true } } } },
    },
    orderBy: { fecha_embarque_real: "desc" },
    take: 30,
  });

const getCompletedReservations = (clientId) => {
  const now = new Date();
  const completedStatuses = ["completada", "finalizada", "completed", "cerrada"];

  return prisma.rESERVA.findMany({
    where: {
      id_cliente: clientId,
      id_viaje: { not: null },
      NOT: { estado_reserva: { equals: "borrador", mode: "insensitive" } },
    },
    include: {
      VIAJE: { include: { CRUCERO: true, destinos: true } },
    },
    orderBy: { fecha_reserva: "desc" },
    take: 30,
  }).then((reservations) =>
    reservations.filter((reservation) => {
      const status = String(reservation.estado_reserva ?? "").toLowerCase();
      const returnDate = reservationReturnDate(reservation);
      return completedStatuses.includes(status) || (returnDate && new Date(returnDate) < now);
    }),
  );
};

export const getCurrentReviews = async (req, res, next) => {
  try {
    const clientId = getClientId(req);
    const [client, history, completedReservations, visibleReviews, ownReviews] = await Promise.all([
      prisma.cLIENTE.findUnique({ where: { id_cliente: clientId } }),
      getClientHistory(clientId),
      getCompletedReservations(clientId),
      prisma.testimonios.findMany({
        where: { visible: true },
        include: { CLIENTE: true, VIAJE: { include: { destinos: true } } },
        orderBy: { created_at: "desc" },
        take: 20,
      }),
      prisma.testimonios.findMany({
        where: { id_cliente: clientId },
        include: { CLIENTE: true, VIAJE: { include: { destinos: true } } },
        orderBy: { created_at: "desc" },
        take: 20,
      }),
    ]);

    if (!client) {
      throw new HttpError(404, "No se encontro el cliente.");
    }

    const historyTrips = history.map(buildHistoryTrip);
    const historyReservationIds = new Set(historyTrips.map((trip) => String(trip.reservationId)));
    const reservationTrips = completedReservations
      .filter((reservation) => !historyReservationIds.has(String(reservation.id_reserva)))
      .map(buildReservationTrip);
    const mergedReviews = [...ownReviews.map((review) => ({ ...review, _mine: true })), ...visibleReviews]
      .filter((review, index, source) => source.findIndex((item) => String(item.id) === String(review.id)) === index);

    res.json({
      ok: true,
      data: serialize({
        client: {
          id: client.id_cliente,
          fullName: fullName(client.nombre, client.apellido),
          email: client.email,
          memberCode: client.member_code ?? `LJM-${String(client.id_cliente).padStart(6, "0")}`,
        },
        history: [...historyTrips, ...reservationTrips],
        reviews: mergedReviews.map(buildReview),
        summary: buildSummary(mergedReviews),
      }),
    });
  } catch (error) {
    next(error);
  }
};

export const saveCurrentReview = async (req, res, next) => {
  try {
    const clientId = getClientId(req);
    const voyageId = Number(req.body?.voyageId);
    const rating = Number(req.body?.rating);
    const text = String(req.body?.text ?? "").trim();

    if (!Number.isInteger(voyageId) || voyageId <= 0) {
      throw new HttpError(400, "Selecciona un viaje de tu historial.");
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new HttpError(400, "Selecciona una calificacion entre 1 y 5.");
    }

    if (text.length < 10) {
      throw new HttpError(400, "Escribe una resena de al menos 10 caracteres.");
    }

    const [client, historyTrip, completedReservations] = await Promise.all([
      prisma.cLIENTE.findUnique({ where: { id_cliente: clientId } }),
      prisma.historial_viajes.findFirst({
        where: {
          id_viaje: voyageId,
          PASAJERO: { id_cliente_referencia: clientId },
        },
      }),
      getCompletedReservations(clientId),
    ]);
    const reservationTrip = completedReservations.find((reservation) => Number(reservation.id_viaje) === voyageId);

    if (!client || (!historyTrip && !reservationTrip)) {
      throw new HttpError(403, "Solo puedes resenar viajes registrados en tu historial.");
    }

    const existing = await prisma.testimonios.findFirst({
      where: { id_cliente: clientId, id_viaje: voyageId },
    });
    const payload = {
      id_cliente: clientId,
      id_viaje: voyageId,
      nombre_mostrado: fullName(client.nombre, client.apellido) || "Navegante LJM",
      email: client.email,
      texto: text,
      puntuacion: rating,
      visible: true,
    };

    if (existing) {
      await prisma.testimonios.update({
        where: { id: existing.id },
        data: payload,
      });
    } else {
      await prisma.testimonios.create({ data: payload });
    }

    if (historyTrip) {
      await prisma.historial_viajes.update({
        where: { id_historial_viaje: historyTrip.id_historial_viaje },
        data: { calificacion: rating },
      });
    }

    await getCurrentReviews(req, res, next);
  } catch (error) {
    next(error);
  }
};
