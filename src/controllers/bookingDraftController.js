import prisma from "../../prismaClient.js";
import { HttpError } from "../utils/httpError.js";

const DRAFT_STATE = "pendiente";
const SERVICE_FEE_RATE = 0.05;
const BOOKING_DRAFT_LOG_PREFIX = "[BookingDraft API]";

const logBookingDraftStep = (step, data = undefined) => {
  console.log(BOOKING_DRAFT_LOG_PREFIX, step, data ?? "");
};

const logBookingDraftError = (step, error) => {
  console.error(BOOKING_DRAFT_LOG_PREFIX, "ERROR", step, error);
};

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
      fecha_salida_real: true,
      fecha_llegada_real: true,
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
  mascota_reserva: true,
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
    select: {
      id_viaje: true,
      fecha_salida_real: true,
      fecha_llegada_real: true,
      duracion_dias: true,
    },
    orderBy: { fecha_salida_real: "asc" },
  });
};

const findCabinForSuite = async (suite) => {
  const cabinId = Number(suite?.idHabitacion ?? suite?.id_habitacion);
  const id = Number(suite?.idTipoHabitacion ?? suite?.id_tipo_habitacion ?? suite?.id);
  const title = suite?.title ?? suite?.nombre;

  if (Number.isInteger(cabinId) && cabinId > 0) {
    const cabin = await prisma.hABITACION.findFirst({
      where: { id_habitacion: cabinId },
      select: {
        id_habitacion: true,
        TIPO_HABITACION: {
          select: { precio_noche: true },
        },
      },
    });

    return cabin ? { id_habitacion: cabin.id_habitacion, price: cabin.TIPO_HABITACION?.precio_noche } : null;
  }

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

const addDays = (value, days) => {
  if (!value || !days) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  date.setDate(date.getDate() + Number(days));
  return date;
};

const calculateDraftCharges = (payload, cabin) => {
  logBookingDraftStep("Calculando cargos", {
    destination: payload.destination?.titulo,
    destinationPriceRaw: payload.destination?.precio_desde,
    suite: payload.suite?.title,
    suitePriceRaw: payload.suite?.pricePerNight,
    cabinPriceRaw: cabin?.price,
    activitiesCount: Array.isArray(payload.activities) ? payload.activities.length : 0,
  });

  const destinationPrice = parseCurrencyAmount(payload.destination?.precio_desde);
  const suitePrice = parseCurrencyAmount(payload.suite?.pricePerNight);
  const cabinPrice = cabin?.price ? Number(cabin.price) : 0;
  const activitiesTotal = Array.isArray(payload.activities)
    ? payload.activities.reduce(
        (sum, activity) => sum + parseCurrencyAmount(activity.precio_base),
        0,
      )
    : 0;
  const subtotal = destinationPrice + (suitePrice || cabinPrice) + activitiesTotal;
  const serviceFee = subtotal > 0 ? Math.round(subtotal * SERVICE_FEE_RATE) : 0;

  const charges = {
    destinationPrice,
    suitePrice: suitePrice || cabinPrice,
    activitiesTotal,
    serviceFee,
    subtotal,
    total: subtotal + serviceFee,
  };

  logBookingDraftStep("Cargos calculados", charges);

  return charges;
};

const buildSuiteFromAssignedCabin = (type) => type
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
  : undefined;

const resolveSuitePrice = ({ suite, charges, type }) =>
  parseCurrencyAmount(suite?.pricePerNight) ||
  parseCurrencyAmount(charges?.suitePrice) ||
  parseCurrencyAmount(type?.precio_noche);

const withResolvedSuitePrice = ({ suite, charges, type }) => {
  if (!suite && !type) {
    return suite;
  }

  const suiteFromCabin = buildSuiteFromAssignedCabin(type);
  const mergedSuite = {
    ...suiteFromCabin,
    ...suite,
  };
  const resolvedPrice = resolveSuitePrice({ suite: mergedSuite, charges, type });

  return {
    ...mergedSuite,
    pricePerNight: resolvedPrice,
  };
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

const syncAnimalCompanion = async (reservationId, animalCompanion) => {
  await prisma.mascota_reserva.deleteMany({
    where: { id_reserva: reservationId },
  });

  const animal = normalizeAnimalCompanion(animalCompanion);

  if (!animal) {
    return;
  }

  await prisma.mascota_reserva.create({
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
  const suite = withResolvedSuitePrice({ suite: snapshot.suite, charges: snapshot.charges, type });
  const storedAnimal = reservation.mascota_reserva?.[0];
  const animalCompanion = snapshot.animalCompanion !== undefined
    ? normalizeAnimalCompanion(snapshot.animalCompanion)
    : storedAnimal
      ? {
          nombre: storedAnimal.nombre_mascota,
          tipoAnimal: storedAnimal.tipo_animal,
          raza: storedAnimal.raza ?? "",
          pesoKg: storedAnimal.peso_kg ? String(storedAnimal.peso_kg) : "",
          unidadPeso: "kg",
          cuidadosEspeciales: storedAnimal.cuidados_especiales ?? "",
          certificadoNombre: storedAnimal.url_certificado ?? "",
          certificadoTipo: "",
        }
      : null;
  const draftForCharges = { ...snapshot, destination, suite };
  const charges = calculateDraftCharges(draftForCharges, null);
  const storedTotal = parseCurrencyAmount(reservation.monto_total);
  const storedSubtotal = parseCurrencyAmount(reservation.subtotal);

  return {
    ...snapshot,
    reservationId: String(reservation.id_reserva),
    departureDate: snapshot.departureDate ?? reservation.VIAJE?.fecha_salida_real ?? undefined,
    fecha_salida: snapshot.fecha_salida ?? reservation.VIAJE?.fecha_salida_real ?? undefined,
    returnDate: snapshot.returnDate ?? reservation.VIAJE?.fecha_llegada_real ?? undefined,
    fecha_llegada: snapshot.fecha_llegada ?? reservation.VIAJE?.fecha_llegada_real ?? undefined,
    destination,
    suite,
    animalCompanion,
    charges: {
      ...charges,
      subtotal: storedSubtotal || charges.subtotal,
      total: storedTotal || charges.total,
    },
    subtotal: storedSubtotal || charges.subtotal,
    monto_total: storedTotal || charges.total,
    total: storedTotal || charges.total,
    moneda: reservation.moneda ?? undefined,
    syncStatus: "synced",
  };
};

export const getCurrentBookingDraft = async (req, res, next) => {
  try {
    const idCliente = getClientId(req);
    logBookingDraftStep("GET draft actual", { idCliente });
    const draft = await findDraftReservation(idCliente);
    logBookingDraftStep("Draft encontrado", { reservationId: draft?.id_reserva, estado: draft?.estado_reserva });
    res.json({ ok: true, data: normalizeDraft(serialize(draft)) });
  } catch (error) {
    logBookingDraftError("GET draft actual", error);
    next(error);
  }
};

export const saveCurrentBookingDraft = async (req, res, next) => {
  try {
    const idCliente = getClientId(req);
    const payload = req.body ?? {};
    logBookingDraftStep("PUT draft recibido", {
      idCliente,
      reservationId: payload.reservationId,
      destination: payload.destination?.titulo,
      suite: payload.suite?.title,
      activitiesCount: Array.isArray(payload.activities) ? payload.activities.length : 0,
      companionsCount: Array.isArray(payload.companions) ? payload.companions.length : 0,
      incomingCharges: payload.charges,
      incomingTotal: payload.total ?? payload.monto_total,
    });
    const trip = payload.destination ? await findTripForDestination(payload.destination) : null;
    logBookingDraftStep("Viaje resuelto", trip);
    const cabin = payload.suite ? await findCabinForSuite(payload.suite) : null;
    logBookingDraftStep("Cabina resuelta", cabin);
    const charges = calculateDraftCharges(payload, cabin);
    const subtotal = charges.total > 0 ? charges.total : null;
    const animalCompanion = normalizeAnimalCompanion(payload.animalCompanion);
    const payloadForSnapshot = {
      ...payload,
      animalCompanion,
      departureDate: payload.departureDate ?? payload.fecha_salida ?? trip?.fecha_salida_real ?? undefined,
      fecha_salida: payload.fecha_salida ?? payload.departureDate ?? trip?.fecha_salida_real ?? undefined,
      returnDate: payload.returnDate ?? payload.fecha_llegada ?? trip?.fecha_llegada_real ?? addDays(payload.departureDate ?? payload.fecha_salida ?? trip?.fecha_salida_real, trip?.duracion_dias) ?? undefined,
      fecha_llegada: payload.fecha_llegada ?? payload.returnDate ?? trip?.fecha_llegada_real ?? addDays(payload.departureDate ?? payload.fecha_salida ?? trip?.fecha_salida_real, trip?.duracion_dias) ?? undefined,
      suite: withResolvedSuitePrice({ suite: payload.suite, charges, type: null }),
      charges: {
        ...payload.charges,
        ...charges,
      },
      subtotal: charges.subtotal,
      monto_total: charges.total,
      total: charges.total,
    };
    const snapshot = JSON.stringify({ bookingDraft: payloadForSnapshot });
    const passengerCount = Array.isArray(payload.companions)
      ? Math.max(1, payload.companions.length + 1)
      : undefined;
    const petsEnabled = hasActivePetCare(payload.personalization) || Boolean(animalCompanion);

    const existingDraft = await findDraftReservation(idCliente);
    logBookingDraftStep("Draft existente", { reservationId: existingDraft?.id_reserva, estado: existingDraft?.estado_reserva });

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
    logBookingDraftStep("Reserva draft guardada", {
      reservationId: reservation.id_reserva,
      subtotal,
      estado: reservation.estado_reserva,
    });

    if (cabin) {
      logBookingDraftStep("Sincronizando asignacion de cabina", { reservationId: reservation.id_reserva, cabinId: cabin.id_habitacion });
      await prisma.aSIGNACION_CABINA.deleteMany({
        where: { id_reserva: reservation.id_reserva },
      });

      await prisma.aSIGNACION_CABINA.create({
        data: {
          id_reserva: reservation.id_reserva,
          id_habitacion: cabin.id_habitacion,
          fecha_asignacion: payloadForSnapshot.departureDate ? new Date(payloadForSnapshot.departureDate) : new Date(),
          fecha_hasta: payloadForSnapshot.returnDate ? new Date(payloadForSnapshot.returnDate) : null,
          precio_final: subtotal ?? cabin.price ?? 0,
          estado_asignacion: "activa",
        },
      });
    }

    if (Array.isArray(payload.companions)) {
      logBookingDraftStep("Sincronizando acompanantes", { reservationId: reservation.id_reserva, count: payload.companions.length });
      await syncCompanions(reservation.id_reserva, payload.companions);
    }

    logBookingDraftStep("Sincronizando dining request", { reservationId: reservation.id_reserva, hasPersonalization: Boolean(payload.personalization) });
    await syncDiningRequest(reservation.id_reserva, payload.personalization);

    if (payload.animalCompanion !== undefined) {
      logBookingDraftStep("Sincronizando companero animal", { reservationId: reservation.id_reserva, hasAnimal: Boolean(animalCompanion) });
      await syncAnimalCompanion(reservation.id_reserva, animalCompanion);
    }

    if (Array.isArray(payload.activities)) {
      logBookingDraftStep("Sincronizando experiencias", { reservationId: reservation.id_reserva, count: payload.activities.length });
      await syncExperiences(reservation.id_reserva, payload.activities);
    }

    const updatedDraft = await prisma.rESERVA.findUnique({
      where: { id_reserva: reservation.id_reserva },
      include: includeDraftRelations,
    });

    logBookingDraftStep("Draft actualizado listo para respuesta", { reservationId: updatedDraft?.id_reserva });
    res.json({ ok: true, data: normalizeDraft(serialize(updatedDraft)) });
  } catch (error) {
    logBookingDraftError("PUT draft actual", error);
    next(error);
  }
};
