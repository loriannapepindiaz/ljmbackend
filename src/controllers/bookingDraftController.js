import prisma from "../../prismaClient.js";
import { HttpError } from "../utils/httpError.js";

const DRAFT_STATE = "pendiente";

const serialize = (data) =>
  JSON.parse(JSON.stringify(data, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  ));

const parseDraftSnapshot = (observaciones) => {
  if (!observaciones) {
    return {};
  }

  try {
    return JSON.parse(observaciones)?.bookingDraft ?? {};
  } catch {
    return {};
  }
};

const getClientId = (req) => {
  const clientId = Number(req.auth?.clientId);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    throw new HttpError(403, "Esta accion requiere una cuenta de cliente.");
  }
  return clientId;
};

const includeDraftRelations = {
  VIAJE: {
    select: {
      id_viaje: true,
      nombre_viaje: true,
      duracion_dias: true,
      destinos: {
        select: {
          id: true,
          titulo: true,
          pais: true,
          ubicacion: true,
          descripcion: true,
          imagen_url: true,
          precio_desde: true,
          moneda: true,
          duracion_tipica: true,
          puerto_principal: true,
          clima: true,
          idioma: true,
          highlights: true,
          incluye: true,
          galeria_urls: true,
        },
      },
    },
  },
  ASIGNACION_CABINA: {
    include: {
      HABITACION: {
        include: {
          TIPO_HABITACION: true,
        },
      },
    },
  },
};

const findDraftReservation = (idCliente) =>
  prisma.rESERVA.findFirst({
    where: { id_cliente: idCliente, estado_reserva: DRAFT_STATE },
    include: includeDraftRelations,
    orderBy: { fecha_reserva: "desc" },
  });

const findTripForDestination = async (destination) => {
  const id = Number(destination?.id);
  const title = destination?.titulo ?? destination?.title;

  return prisma.vIAJE.findFirst({
    where: {
      estado_publicacion: "publicado",
      ...(Number.isInteger(id) && id > 0
        ? { destino_id: BigInt(id) }
        : title
          ? { destinos: { titulo: { contains: title, mode: "insensitive" } } }
          : {}),
    },
    select: { id_viaje: true },
    orderBy: { fecha_salida_real: "asc" },
  });
};

const findCabinForSuite = async (suite) => {
  const id = Number(suite?.id);
  const title = suite?.title ?? suite?.nombre;

  const type = await prisma.tIPO_HABITACION.findFirst({
    where: {
      ...(Number.isInteger(id) && id > 0
        ? { id_tipo_habitacion: id }
        : title
          ? { nombre: { contains: title, mode: "insensitive" } }
          : {}),
    },
    select: { id_tipo_habitacion: true, precio_noche: true },
  });

  if (!type) {
    return null;
  }

  const cabin = await prisma.hABITACION.findFirst({
    where: {
      id_tipo_habitacion: type.id_tipo_habitacion,
      estado: { equals: "disponible", mode: "insensitive" },
    },
    select: { id_habitacion: true },
    orderBy: { id_habitacion: "asc" },
  });

  return cabin ? { ...cabin, price: type.precio_noche } : null;
};

const hasActivePetCare = (personalization) =>
  personalization?.services?.some((service) => service.id === "pet-care" && service.active) ?? false;

const normalizeDiet = (diet) => {
  const normalizedDiet = String(diet ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
  const dietMap = {
    halal: "halal",
    kosher: "kosher",
    ninguna: "ninguna",
    no: "ninguna",
    otra: "otra",
    sin_gluten: "sin_gluten",
    sin_lactosa: "sin_lactosa",
    sin_mariscos: "sin_mariscos",
    vegana: "vegana",
    vegano: "vegana",
    vegetariana: "vegetariana",
    vegetariano: "vegetariana",
  };

  return dietMap[normalizedDiet] ?? (normalizedDiet ? "otra" : null);
};

const parseCurrencyAmount = (value) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value !== "string") {
    return 0;
  }

  const sanitizedValue = value
    .replace(/\s/g, "")
    .replace(/[^\d,.-]/g, "");
  const lastComma = sanitizedValue.lastIndexOf(",");
  const lastDot = sanitizedValue.lastIndexOf(".");
  const decimalSeparator = lastComma > lastDot ? "," : ".";
  const normalizedValue = sanitizedValue
    .replace(/[,.]/g, (separator, index) => {
      if (separator === decimalSeparator && sanitizedValue.length - index <= 3) {
        return ".";
      }

      return "";
    });
  const parsedValue = Number(normalizedValue);

  return Number.isFinite(parsedValue) ? parsedValue : 0;
};

const syncCompanions = async (reservationId, companions = []) => {
  await prisma.pASAJERO.deleteMany({
    where: {
      id_reserva: reservationId,
      es_titular: false,
    },
  });

  if (!Array.isArray(companions) || companions.length === 0) {
    return;
  }

  await prisma.pASAJERO.createMany({
    data: companions.map((companion) => ({
      id_reserva: reservationId,
      nombre: companion.nombre ?? "",
      apellido: companion.apellidos ?? "",
      fecha_nacimiento: companion.fecha ? new Date(companion.fecha) : null,
      documento_tipo: "Pasaporte",
      documento_numero: companion.pasaporte ?? "",
      relacion_titular: "acompanante",
      es_titular: false,
    })),
  });
};

const syncDiningRequest = async (reservationId, personalization) => {
  if (!personalization) {
    return;
  }

  await prisma.dining_requests.deleteMany({
    where: { id_reserva: reservationId },
  });

  await prisma.dining_requests.create({
    data: {
      id_reserva: reservationId,
      turno_cena: "flexible",
      dieta_especial: normalizeDiet(personalization.diet),
      alergias_notas: personalization.allergies?.map((allergy) => allergy.label).join(", ") ?? null,
      notas: JSON.stringify({
        pillow: personalization.pillow ?? null,
        services: personalization.services ?? [],
        additionalRequirements: personalization.additionalRequirements ?? "",
        specialRequest: personalization.specialRequest ?? "",
      }),
      estado: "pendiente",
    },
  });
};

const syncExperiences = async (reservationId, activities = []) => {
  await prisma.reserva_experiencia.deleteMany({
    where: { id_reserva: reservationId },
  });

  if (!Array.isArray(activities) || activities.length === 0) {
    return;
  }

  const validActivities = activities
    .map((activity) => ({
      id: Number(activity.id),
      price: parseCurrencyAmount(activity.precio_base),
    }))
    .filter((activity) => Number.isInteger(activity.id) && activity.id > 0);

  if (validActivities.length === 0) {
    return;
  }

  await prisma.reserva_experiencia.createMany({
    data: validActivities.map((activity) => ({
      id_reserva: reservationId,
      id_experiencia: BigInt(activity.id),
      cantidad: 1,
      precio_unitario: activity.price,
    })),
    skipDuplicates: true,
  });
};

const normalizeDraft = (reservation) => {
  if (!reservation) {
    return {};
  }

  const snapshot = parseDraftSnapshot(reservation.observaciones);
  const destination = snapshot.destination ?? reservation.VIAJE?.destinos ?? undefined;
  const assignedCabin = reservation.ASIGNACION_CABINA?.[0]?.HABITACION;
  const type = assignedCabin?.TIPO_HABITACION;
  const suite = snapshot.suite ?? (type
    ? {
        id: String(type.id_tipo_habitacion),
        title: type.nombre,
        description: type.descripcion,
        imageUrl: type.imagen_url,
        size: type.tamano_m2 ? `${Number(type.tamano_m2)} m2` : undefined,
        feature: type.nombre,
        capacity: type.capacidad_max ? `${type.capacidad_max} huespedes` : undefined,
        pricePerNight: type.precio_noche ? Number(type.precio_noche) : 0,
        highlights: [],
        amenities: [],
        gallery: [type.imagen_url].filter(Boolean),
      }
    : undefined);

  return {
    ...snapshot,
    reservationId: String(reservation.id_reserva),
    destination,
    suite,
    syncStatus: "synced",
  };
};

export const getCurrentBookingDraft = async (req, res, next) => {
  try {
    const idCliente = getClientId(req);
    const draft = await findDraftReservation(idCliente);
    res.json({ ok: true, data: normalizeDraft(serialize(draft)) });
  } catch (error) {
    next(error);
  }
};

export const saveCurrentBookingDraft = async (req, res, next) => {
  try {
    const idCliente = getClientId(req);
    const payload = req.body ?? {};
    const trip = payload.destination ? await findTripForDestination(payload.destination) : null;
    const cabin = payload.suite ? await findCabinForSuite(payload.suite) : null;
    const suitePrice = parseCurrencyAmount(payload.suite?.pricePerNight);
    const subtotal = suitePrice || (cabin?.price ? Number(cabin.price) : null);
    const snapshot = JSON.stringify({ bookingDraft: payload });
    const passengerCount = Array.isArray(payload.companions)
      ? Math.max(1, payload.companions.length)
      : undefined;
    const petsEnabled = hasActivePetCare(payload.personalization);

    const existingDraft = await findDraftReservation(idCliente);

    const reservation = existingDraft
      ? await prisma.rESERVA.update({
          where: { id_reserva: existingDraft.id_reserva },
          data: {
            ...(trip ? { id_viaje: trip.id_viaje } : {}),
            ...(subtotal !== null ? { subtotal, monto_total: subtotal } : {}),
            ...(passengerCount ? { pasajeros_adultos: passengerCount } : {}),
            ...(payload.personalization ? { mascotas: petsEnabled } : {}),
            observaciones: snapshot,
          },
        })
      : await prisma.rESERVA.create({
          data: {
            id_cliente: idCliente,
            ...(trip ? { id_viaje: trip.id_viaje } : {}),
            fecha_reserva: new Date(),
            estado_reserva: DRAFT_STATE,
            pasajeros_adultos: 1,
            numero_habitaciones: 1,
            moneda: payload.destination?.moneda ?? "USD",
            ...(subtotal !== null ? { subtotal, monto_total: subtotal } : {}),
            ...(passengerCount ? { pasajeros_adultos: passengerCount } : {}),
            mascotas: petsEnabled,
            observaciones: snapshot,
          },
        });

    if (cabin) {
      await prisma.aSIGNACION_CABINA.deleteMany({
        where: { id_reserva: reservation.id_reserva },
      });

      await prisma.aSIGNACION_CABINA.create({
        data: {
          id_reserva: reservation.id_reserva,
          id_habitacion: cabin.id_habitacion,
          fecha_asignacion: new Date(),
          precio_final: subtotal ?? cabin.price ?? 0,
          estado_asignacion: "activa",
        },
      });
    }

    if (Array.isArray(payload.companions)) {
      await syncCompanions(reservation.id_reserva, payload.companions);
    }

    await syncDiningRequest(reservation.id_reserva, payload.personalization);

    if (Array.isArray(payload.activities)) {
      await syncExperiences(reservation.id_reserva, payload.activities);
    }

    const updatedDraft = await prisma.rESERVA.findUnique({
      where: { id_reserva: reservation.id_reserva },
      include: includeDraftRelations,
    });

    res.json({ ok: true, data: normalizeDraft(serialize(updatedDraft)) });
  } catch (error) {
    next(error);
  }
};
