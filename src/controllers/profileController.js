import prisma from "../../prismaClient.js";
import { HttpError } from "../utils/httpError.js";

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

const parseReservationDraft = (observaciones) => {
  if (!observaciones) return {};

  try {
    return JSON.parse(observaciones)?.bookingDraft ?? {};
  } catch {
    return {};
  }
};

const formatName = (...parts) => parts.filter(Boolean).join(" ").trim();

const buildMemberCode = (clientId) => `LJM-${String(clientId).padStart(6, "0")}`;

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

const ensureMemberCode = async (client) => {
  if (client.member_code) return client;

  return prisma.cLIENTE.update({
    where: { id_cliente: client.id_cliente },
    data: { member_code: buildMemberCode(client.id_cliente) },
    include: {
      cliente_preferencia: {
        include: { preferencias: true },
        orderBy: { created_at: "desc" },
      },
    },
  });
};

const includeReservationProfile = {
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

const cabinName = (reservation, draft) =>
  reservation.ASIGNACION_CABINA?.[0]?.HABITACION?.TIPO_HABITACION?.nombre ??
  draft.suite?.title ??
  "Habitacion por confirmar";

const destinationName = (reservation, draft) =>
  draft.destination?.titulo ??
  reservation.VIAJE?.destinos?.titulo ??
  reservation.VIAJE?.nombre_viaje ??
  "Destino por confirmar";

const shipName = (reservation, draft) =>
  reservation.VIAJE?.CRUCERO?.nombre ??
  draft.ship?.title ??
  "LJM Sealine";

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
  const guests = reservation.PASAJERO?.length || reservation.pasajeros_adultos || 1;

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
    guests,
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
  destination: item.destino_principal ?? item.VIAJE?.destinos?.titulo ?? item.RESERVA?.VIAJE?.destinos?.titulo ?? "Destino registrado",
  ship: item.VIAJE?.CRUCERO?.nombre ?? item.RESERVA?.VIAJE?.CRUCERO?.nombre ?? "LJM Sealine",
  cabin: item.RESERVA?.ASIGNACION_CABINA?.[0]?.HABITACION?.TIPO_HABITACION?.nombre ?? "Habitacion registrada",
  departureDate: item.fecha_embarque_real ?? item.VIAJE?.fecha_salida_real ?? item.RESERVA?.VIAJE?.fecha_salida_real ?? null,
  returnDate: item.fecha_desembarque_real ?? item.VIAJE?.fecha_llegada_real ?? item.RESERVA?.VIAJE?.fecha_llegada_real ?? null,
  nights: item.noches_navegadas ?? null,
  rating: item.calificacion ?? null,
});

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

const getRecommendation = (preferences, upcomingReservation, history) => {
  if (preferences.length) {
    const firstPreference = preferences[0];
    return {
      title: `Recomendacion para ${firstPreference.name}`,
      description: `Tenemos registrada tu preferencia por ${firstPreference.name.toLowerCase()}. Tus proximas sugerencias se ajustaran a esa categoria.`,
    };
  }

  if (upcomingReservation) {
    return {
      title: `Explora mas en ${upcomingReservation.destination}`,
      description: "Agrega experiencias o servicios personalizados para completar tu proximo crucero.",
    };
  }

  if (history.length) {
    return {
      title: "Nueva travesia sugerida",
      description: `Podemos recomendar una ruta inspirada en tu viaje a ${history[0].destination}.`,
    };
  }

  return null;
};

export const getProfile = async (req, res, next) => {
  try {
    const clientId = getClientId(req);
    const now = new Date();

    const user = await prisma.uSUARIO.findFirst({
      where: { id_cliente: clientId, es_cliente: true },
      include: { ROL: true },
    });
    const client = await prisma.cLIENTE.findUnique({
      where: { id_cliente: clientId },
      include: {
        cliente_preferencia: {
          include: { preferencias: true },
          orderBy: { created_at: "desc" },
        },
      },
    });
    const reservations = await prisma.rESERVA.findMany({
      where: {
        id_cliente: clientId,
        NOT: { estado_reserva: { equals: "borrador", mode: "insensitive" } },
      },
      include: includeReservationProfile,
      orderBy: { fecha_reserva: "desc" },
      take: 20,
    });
    const history = await prisma.historial_viajes.findMany({
      where: {
        PASAJERO: { id_cliente_referencia: clientId },
      },
      include: {
        VIAJE: { include: { CRUCERO: true, destinos: true } },
        RESERVA: { include: includeReservationProfile },
      },
      orderBy: { fecha_embarque_real: "desc" },
      take: 8,
    });
    const availablePreferences = await prisma.preferencias.findMany({
      where: { activa: true },
      orderBy: [{ categoria: "asc" }, { nombre: "asc" }],
    });

    if (!user || !client) {
      throw new HttpError(404, "No se encontro el perfil del cliente.");
    }

    const clientWithMemberCode = await ensureMemberCode(client);

    const upcomingReservation =
      reservations.find((reservation) => {
        const date = reservationDate(reservation);
        return date && new Date(date) >= now;
      }) ??
      reservations.find((reservation) =>
        ["confirmada", "pagada", "pendiente"].includes(String(reservation.estado_reserva ?? "").toLowerCase()),
      ) ??
      null;

    const additionalUpcomingReservations = reservations
      .filter((reservation) => reservation.id_reserva !== upcomingReservation?.id_reserva)
      .filter((reservation) => {
        const date = reservationDate(reservation);
        return date && new Date(date) >= now;
      })
      .map(buildReservationSummary);

    const reservationHistory = reservations
      .filter((reservation) => reservation.id_reserva !== upcomingReservation?.id_reserva)
      .filter((reservation) => {
        const returnDate = reservationReturnDate(reservation);
        if (!returnDate) return false;
        const date = new Date(returnDate);
        return !Number.isNaN(date.getTime()) && date < now;
      })
      .map((reservation) => {
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
      });

    const preferences = (clientWithMemberCode.cliente_preferencia ?? [])
      .map((item) => item.preferencias)
      .filter(Boolean)
      .map((preference) => ({
        id: preference.id,
        name: preference.nombre,
        category: preference.categoria,
      }));

    const storedTravelHistory = history.map(buildHistoryItem);
    const travelHistory = [
      ...storedTravelHistory,
      ...reservationHistory,
    ].slice(0, 8);
    const upcomingReservationSummary = buildReservationSummary(upcomingReservation);
    const reservationIds = new Set(reservations.map((reservation) => String(reservation.id_reserva)));
    const totalNights = sumReservationNights(reservations) + sumExternalHistoryNights(storedTravelHistory, reservationIds);
    const loyalty = buildLoyalty(clientWithMemberCode, reservations.length);

    const profile = {
      user: {
        id: user.id_usuario,
        username: user.username,
        email: user.email,
        role: user.ROL?.nombre_rol ?? null,
        status: user.estado_cuenta,
        avatarUrl: user.avatar_url ?? client.avatar_url ?? null,
      },
      client: {
        id: clientWithMemberCode.id_cliente,
        fullName: formatName(clientWithMemberCode.nombre, clientWithMemberCode.apellido) || user.username || user.email,
        firstName: clientWithMemberCode.nombre,
        lastName: clientWithMemberCode.apellido,
        email: clientWithMemberCode.email ?? user.email,
        phone: clientWithMemberCode.telefono,
        nationality: clientWithMemberCode.nacionalidad,
        birthdate: clientWithMemberCode.fecha_nac,
        memberCode: clientWithMemberCode.member_code,
        avatarUrl: clientWithMemberCode.avatar_url,
      },
      loyalty: {
        tier: loyalty.tier,
        label: loyalty.label,
        progressPct: loyalty.progressPct,
        nightsToNextTier: loyalty.nightsToNextTier,
      },
      preferences,
      availablePreferences: availablePreferences.map((preference) => ({
        id: preference.id,
        name: preference.nombre,
        category: preference.categoria,
      })),
      stats: {
        totalReservations: reservations.length,
        completedTrips: reservations.length,
        totalNights,
      },
      upcomingReservation: upcomingReservationSummary,
      upcomingReservations: additionalUpcomingReservations,
      travelHistory,
      recommendation: getRecommendation(preferences, upcomingReservationSummary, travelHistory),
    };

    res.json({ ok: true, data: serialize(profile) });
  } catch (error) {
    next(error);
  }
};

export const updateProfile = async (req, res, next) => {
  try {
    const clientId = getClientId(req);
    const hasEmail = Object.prototype.hasOwnProperty.call(req.body ?? {}, "email");
    const hasPreferences = Array.isArray(req.body?.preferenceIds);
    const email = String(req.body?.email ?? "").trim().toLowerCase();

    if (hasEmail && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      throw new HttpError(400, "Ingresa un correo electronico valido.");
    }

    await prisma.$transaction(async (tx) => {
      if (hasEmail) {
        await tx.cLIENTE.update({
          where: { id_cliente: clientId },
          data: { email, updated_at: new Date() },
        });

        await tx.uSUARIO.updateMany({
          where: { id_usuario: Number(req.auth?.sub), id_cliente: clientId },
          data: { email, updated_at: new Date() },
        });
      }

      if (hasPreferences) {
        const preferenceIds = [...new Set(req.body.preferenceIds.map(Number))]
          .filter((id) => Number.isInteger(id) && id > 0)
          .map(BigInt);

        const activePreferences = await tx.preferencias.findMany({
          where: { id: { in: preferenceIds }, activa: true },
          select: { id: true },
        });

        await tx.cliente_preferencia.deleteMany({
          where: { id_cliente: clientId },
        });

        if (activePreferences.length) {
          await tx.cliente_preferencia.createMany({
            data: activePreferences.map((preference) => ({
              id_cliente: clientId,
              id_preferencia: preference.id,
            })),
            skipDuplicates: true,
          });
        }
      }
    });

    await getProfile(req, res, next);
  } catch (error) {
    next(error);
  }
};
