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

const parseId = (value, message) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, message);
  }
  return BigInt(id);
};

const includeBooking = {
  CLIENTE: true,
  PASAJERO: true,
  VIAJE: {
    include: {
      destinos: true,
      CRUCERO: true,
      ITINERARIO: {
        include: {
          escala: {
            include: { PUERTO: true },
            orderBy: { orden_escala: "asc" },
          },
        },
      },
    },
  },
  ASIGNACION_CABINA: {
    include: {
      HABITACION: {
        include: {
          TIPO_HABITACION: true,
          MAYORDOMO_HABITACION: { include: { EMPLEADO: true } },
        },
      },
    },
  },
  dining_requests: true,
  reserva_experiencia: { include: { experiencias: true } },
  mascota_reserva: true,
  pago_reserva: {
    include: { MONEDA: true, METODO_PAGO: true },
    orderBy: { fecha_pago: "desc" },
  },
};

const findCurrentReservation = (clientId) =>
  prisma.rESERVA.findFirst({
    where: {
      id_cliente: clientId,
      OR: [
        {
          estado_reserva: { equals: "confirmada", mode: "insensitive" },
          pago_reserva: { some: { estado: { equals: "Pagado", mode: "insensitive" } } },
        },
        {
          estado_reserva: { equals: "pagada", mode: "insensitive" },
        },
      ],
    },
    include: includeBooking,
    orderBy: { fecha_reserva: "desc" },
  });

const findReservationForClient = async (clientId, reservationId) => {
  const reservation = reservationId
    ? await prisma.rESERVA.findFirst({
        where: { id_cliente: clientId, id_reserva: parseId(reservationId, "Reserva invalida.") },
        include: includeBooking,
      })
    : await findCurrentReservation(clientId);

  if (!reservation) {
    throw new HttpError(404, "No se encontro una reserva activa para gestionar.");
  }

  return reservation;
};

const formatCurrency = (value, currency = "USD") =>
  new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));

const parseCurrencyAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

const initialsFor = (name) =>
  String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "P";

const parseJsonNotes = (value) => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const activeServices = Array.isArray(parsed.services)
      ? parsed.services.filter((service) => service?.active).map((service) => service.label).filter(Boolean)
      : [];
    const pieces = [
      parsed.pillow?.label ? `Almohada: ${parsed.pillow.label}` : null,
      activeServices.length ? `Servicios: ${activeServices.join(", ")}` : null,
      parsed.additionalRequirements ? `Requisitos: ${parsed.additionalRequirements}` : null,
      parsed.specialRequest ? `Solicitud: ${parsed.specialRequest}` : null,
    ].filter(Boolean);

    return pieces.join(" | ") || null;
  } catch {
    return null;
  }
};

const parseReservationDraft = (observaciones) => {
  if (!observaciones) {
    return {};
  }

  try {
    return JSON.parse(observaciones)?.bookingDraft ?? {};
  } catch {
    return {};
  }
};

const parseCapacity = (value) => {
  const match = String(value ?? "").match(/\d+/);
  return match ? Number(match[0]) : undefined;
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

const reservationDate = (reservation, draft) =>
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

const reservationReturnDate = (reservation, draft) =>
  reservation?.VIAJE?.fecha_llegada_real ??
  draft.returnDate ??
  draft.fecha_llegada ??
  draft.fecha_regreso ??
  draft.fechaLlegada ??
  draft.fechaRegreso ??
  addDays(reservationDate(reservation, draft), getDurationDays(draft, reservation));

const includesButler = (...values) =>
  values
    .flat()
    .filter(Boolean)
    .some((value) => /mayordomo|butler|concierge/i.test(String(value)));

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

const destinationImage = (destination, draft) => {
  const title = destination?.titulo ?? draft.destination?.titulo;

  return firstText(
    draft.destination?.imagen_url,
    draft.destination?.imageUrl,
    draft.destination?.galeria_urls?.[0],
    destination?.imagen_url,
    destination?.galeria_urls?.[0],
    destinationImageFallbacks[normalizeImageKey(title)],
  );
};

const normalizeTablePreference = (value) => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const tableMap = {
    mesa_privada: "privada",
    privado: "privada",
    privada: "privada",
    private: "privada",
    ventana: "ventana",
    junto_a_ventana: "ventana",
    window: "ventana",
    terraza: "terraza",
    exterior: "terraza",
    compartida: "compartida",
    compartido: "compartida",
    shared: "compartida",
  };

  return tableMap[normalized] ?? "privada";
};

const buildManagePayload = (reservation) => {
  const draft = parseReservationDraft(reservation.observaciones);
  const destination = reservation.VIAJE?.destinos;
  const crucero = reservation.VIAJE?.CRUCERO;
  const itinerario = reservation.VIAJE?.ITINERARIO;
  const cabin = reservation.ASIGNACION_CABINA?.[0]?.HABITACION;
  const suite = cabin?.TIPO_HABITACION;
  const butlerAssignment = cabin?.MAYORDOMO_HABITACION?.[0];
  const payment = reservation.pago_reserva?.[0];
  const currency = payment?.MONEDA?.codigo ?? reservation.moneda ?? "USD";
  const total = Number(payment?.monto ?? reservation.monto_total ?? 0);
  const suiteName = suite?.nombre ?? draft.suite?.title ?? "Habitación asignada";
  const guestCount = reservation.PASAJERO?.length || reservation.pasajeros_adultos || 1;
  const animalCompanion = draft.animalCompanion ?? reservation.mascota_reserva?.[0] ?? null;

  const depDate = reservationDate(reservation, draft);
  const retDate = reservationReturnDate(reservation, draft);
  const now = new Date();

  const itineraryStops = (itinerario?.escala ?? []).map((stop, index) => {
    const portName = stop.PUERTO?.nombre_puerto ?? stop.PUERTO?.ciudad ?? `Puerto ${index + 1}`;
    const country = stop.PUERTO?.pais ?? "";
    const arrivalDate = stop.fecha_llegada ? new Date(stop.fecha_llegada).toISOString() : null;
    const departureDate = stop.fecha_salida ? new Date(stop.fecha_salida).toISOString() : null;
    let status = "upcoming";
    if (departureDate && new Date(departureDate) < now) status = "completed";
    else if (arrivalDate && new Date(arrivalDate) <= now) status = "current";
    return { port: portName, country, arrivalDate, departureDate, status, order: stop.orden_escala ?? index };
  });

  return {
    reservationId: reservation.id_reserva,
    reference: payment?.referencia_bancaria ?? reservation.codigo_reserva ?? reservation.id_reserva,
    status: reservation.estado_reserva ? `${reservation.estado_reserva[0].toUpperCase()}${reservation.estado_reserva.slice(1)}` : "Confirmada",
    destinationName: destination?.titulo ?? draft.destination?.titulo ?? "Reserva LJM Sealine",
    destinationImage: destinationImage(destination, draft),
    departureDate: depDate,
    returnDate: retDate,
    nights: getDurationDays(draft, reservation),
    route: [destination?.pais ?? draft.destination?.pais, destination?.puerto_principal ?? destination?.ubicacion ?? draft.destination?.puerto_principal ?? draft.destination?.ubicacion].filter(Boolean).join(" | ") || "Ruta por confirmar",
    suiteName,
    suiteCapacity: suite?.capacidad_max ?? parseCapacity(draft.suite?.capacity) ?? reservation.pasajeros_adultos ?? 1,
    cabinLabel: cabin?.numero_cabina ? `${suiteName} · Cabina ${cabin.numero_cabina}` : suiteName,
    cabinNumber: cabin?.numero_cabina ?? null,
    guestCount,
    cruiseName: crucero?.nombre ?? null,
    suiteImage: suite?.imagen_url ?? null,
    suiteDescription: suite?.descripcion ?? null,
    itineraryName: itinerario?.nombre_ruta ?? null,
    itineraryStops,
    butler: {
      included: Boolean(butlerAssignment) || includesButler(
        suite?.nombre, suite?.descripcion, draft.suite?.title, draft.suite?.description,
        draft.suite?.highlights, draft.suite?.amenities,
        destination?.incluye, destination?.highlights,
        draft.destination?.incluye, draft.destination?.highlights,
      ),
      name: [butlerAssignment?.EMPLEADO?.nombre, butlerAssignment?.EMPLEADO?.apellido].filter(Boolean).join(" "),
    },
    animalCompanion: animalCompanion
      ? {
          nombre: animalCompanion.nombre ?? animalCompanion.nombre_mascota ?? "",
          tipoAnimal: animalCompanion.tipoAnimal ?? animalCompanion.tipo_animal ?? "",
          raza: animalCompanion.raza ?? "",
          pesoKg: animalCompanion.pesoKg ?? animalCompanion.peso_kg ?? "",
          unidadPeso: animalCompanion.unidadPeso ?? "kg",
          cuidadosEspeciales: animalCompanion.cuidadosEspeciales ?? animalCompanion.cuidados_especiales ?? "",
          certificadoNombre: animalCompanion.certificadoNombre ?? animalCompanion.url_certificado ?? "",
        }
      : null,
    guests: (reservation.PASAJERO ?? []).map((passenger) => {
      const name = [passenger.nombre, passenger.apellido].filter(Boolean).join(" ");
      return {
        id: passenger.id_pasajero,
        initials: initialsFor(name),
        name,
        role: passenger.es_titular ? "Titular" : passenger.documento_numero ? `Pasaporte ${passenger.documento_numero}` : "Acompañante",
        isElite: passenger.es_titular,
      };
    }),
    diningRequests: (reservation.dining_requests ?? []).map((request) => ({
      id: request.id_dining,
      label: request.preferencia_mesa ? "Mesa" : "Solicitud",
      nombre: request.preferencia_mesa ?? request.ocasion_especial ?? request.dieta_especial ?? "Solicitud registrada",
      detalle: parseJsonNotes(request.notas) ?? request.notas ?? request.alergias_notas ?? request.turno_cena ?? "Pendiente",
    })),
    excursions: (reservation.reserva_experiencia ?? []).map((item) => ({
      id: item.id,
      imagen: item.experiencias?.imagen_url ?? "",
      nombre: item.experiencias?.nombre ?? "Experiencia",
      fecha: "Incluida en la reserva",
      puerto: destination?.puerto_principal ?? destination?.ubicacion ?? "Puerto por confirmar",
      estado: "Confirmada",
      precio: Number(item.precio_unitario ?? item.experiencias?.precio_base ?? 0),
    })),
    payments: [
      { label: "Estado", value: payment?.estado ?? "Pendiente", color: "text-green-400" },
      { label: "Método", value: payment?.METODO_PAGO?.tipo_nombre ?? "Registrado", color: "text-white" },
      { label: "Referencia", value: String(payment?.referencia_bancaria ?? payment?.id_pago ?? "Sin referencia"), color: "text-[#eacea9]" },
      { label: "Total", value: formatCurrency(total, currency), color: "text-[#eacea9]" },
    ],
    total: formatCurrency(total, currency),
    paymentStatus: payment?.estado ?? "Pendiente",
  };
};

const respondCurrent = async (req, res) => {
  const reservation = await findReservationForClient(getClientId(req), req.body?.reservationId ?? req.query?.reservationId);
  res.json({ ok: true, data: serialize(buildManagePayload(reservation)) });
};

export const getManageBooking = async (req, res, next) => {
  try {
    await respondCurrent(req, res);
  } catch (error) {
    next(error);
  }
};

export const getLatestManageBooking = async (_req, res, next) => {
  try {
    const reservation = await prisma.rESERVA.findFirst({
      where: {
        OR: [
          {
            estado_reserva: { equals: "confirmada", mode: "insensitive" },
            pago_reserva: { some: { estado: { equals: "Pagado", mode: "insensitive" } } },
          },
          {
            estado_reserva: { equals: "pagada", mode: "insensitive" },
          },
        ],
      },
      include: includeBooking,
      orderBy: { fecha_reserva: "desc" },
    });

    if (!reservation) {
      throw new HttpError(404, "No se encontro una reserva reciente para seguimiento.");
    }

    res.json({ ok: true, data: serialize(buildManagePayload(reservation)) });
  } catch (error) {
    next(error);
  }
};

export const addGuest = async (req, res, next) => {
  try {
    const reservation = await findReservationForClient(getClientId(req), req.body?.reservationId);
    const fullName = String(req.body?.fullName ?? "").trim();
    if (!fullName) throw new HttpError(400, "El nombre del huesped es requerido.");
    const [nombre, ...rest] = fullName.split(/\s+/);

    await prisma.pASAJERO.create({
      data: {
        id_reserva: reservation.id_reserva,
        nombre,
        apellido: rest.join(" "),
        documento_tipo: "Pasaporte",
        documento_numero: req.body?.document ?? "",
        fecha_nacimiento: req.body?.birthdate ? new Date(req.body.birthdate) : null,
        relacion_titular: "Acompañante",
        es_titular: false,
      },
    });

    await respondCurrent(req, res);
  } catch (error) {
    next(error);
  }
};

export const updateGuest = async (req, res, next) => {
  try {
    const reservation = await findReservationForClient(getClientId(req), req.body?.reservationId);
    const passengerId = parseId(req.params.id, "Huesped invalido.");
    const fullName = String(req.body?.fullName ?? "").trim();
    if (!fullName) throw new HttpError(400, "El nombre del huesped es requerido.");
    const [nombre, ...rest] = fullName.split(/\s+/);

    await prisma.pASAJERO.updateMany({
      where: { id_pasajero: passengerId, id_reserva: reservation.id_reserva },
      data: {
        nombre,
        apellido: rest.join(" "),
        documento_numero: req.body?.document ?? undefined,
      },
    });

    await respondCurrent(req, res);
  } catch (error) {
    next(error);
  }
};

export const deleteGuest = async (req, res, next) => {
  try {
    const reservation = await findReservationForClient(getClientId(req), req.body?.reservationId);
    const passengerId = parseId(req.params.id, "Huesped invalido.");

    await prisma.pASAJERO.deleteMany({
      where: { id_pasajero: passengerId, id_reserva: reservation.id_reserva, es_titular: false },
    });

    await respondCurrent(req, res);
  } catch (error) {
    next(error);
  }
};

export const addDiningRequest = async (req, res, next) => {
  try {
    const reservation = await findReservationForClient(getClientId(req), req.body?.reservationId);
    await prisma.dining_requests.create({
      data: {
        id_reserva: reservation.id_reserva,
        turno_cena: req.body?.turno ?? "flexible",
        dieta_especial: req.body?.nombre ?? null,
        alergias_notas: req.body?.detalle ?? null,
        notas: req.body?.detalle ?? null,
        estado: "pendiente",
      },
    });

    await respondCurrent(req, res);
  } catch (error) {
    next(error);
  }
};

export const reserveTable = async (req, res, next) => {
  try {
    const reservation = await findReservationForClient(getClientId(req), req.body?.reservationId);
    await prisma.dining_requests.create({
      data: {
        id_reserva: reservation.id_reserva,
        turno_cena: req.body?.turno ?? "cena",
        preferencia_mesa: normalizeTablePreference(req.body?.tablePreference),
        tamano_mesa: Number(req.body?.size ?? reservation.pasajeros_adultos ?? 2),
        ocasion_especial: req.body?.occasion ?? null,
        notas: req.body?.notes ?? "Reserva de mesa solicitada desde gestion de reserva",
        estado: "pendiente",
      },
    });

    await respondCurrent(req, res);
  } catch (error) {
    next(error);
  }
};

export const addExcursion = async (req, res, next) => {
  try {
    const reservation = await findReservationForClient(getClientId(req), req.body?.reservationId);
    const name = String(req.body?.name ?? "").trim();
    if (!name) throw new HttpError(400, "El nombre de la excursion es requerido.");
    const price = Math.max(0, parseCurrencyAmount(req.body?.price));

    const existingExperience = await prisma.experiencias.findFirst({
      where: { nombre: { equals: name, mode: "insensitive" } },
    });
    const experience = existingExperience ?? await prisma.experiencias.create({
      data: {
        nombre: name,
        descripcion: "Agregada desde gestion de reserva",
        categoria: "personalizada",
        precio_base: Number.isFinite(price) ? price : 0,
        activa: true,
        incluye: [],
        galeria: [],
      },
    });

    const unitPrice = price || parseCurrencyAmount(experience.precio_base);

    await prisma.$transaction(async (tx) => {
      await tx.reserva_experiencia.upsert({
        where: {
          id_reserva_id_experiencia: {
            id_reserva: reservation.id_reserva,
            id_experiencia: experience.id,
          },
        },
        update: {
          cantidad: { increment: 1 },
          precio_unitario: unitPrice,
        },
        create: {
          id_reserva: reservation.id_reserva,
          id_experiencia: experience.id,
          cantidad: 1,
          precio_unitario: unitPrice,
        },
      });

      await tx.rESERVA.update({
        where: { id_reserva: reservation.id_reserva },
        data: {
          subtotal: { increment: unitPrice },
          monto_total: { increment: unitPrice },
        },
      });

      const lastPayment = reservation.pago_reserva?.[0];
      if (lastPayment) {
        await tx.pago_reserva.update({
          where: { id_pago: lastPayment.id_pago },
          data: {
            monto: { increment: unitPrice },
            notas: JSON.stringify({
              source: "gestion_reserva",
              lastExtraCharge: {
                type: "excursion",
                name,
                amount: unitPrice,
                paidAt: new Date().toISOString(),
              },
            }),
          },
        });
      }
    });

    await respondCurrent(req, res);
  } catch (error) {
    next(error);
  }
};


