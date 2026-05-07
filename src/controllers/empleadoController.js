import prisma from "../../prismaClient.js";

const ACTIVE_STATUSES = ["activo", "activa"];
const LICENSE_STATUSES = ["licencia", "de licencia", "permiso"];

const serialize = (data) =>
  JSON.parse(
    JSON.stringify(data, (_key, value) => {
      if (typeof value === "bigint") return value.toString();
      return value;
    }),
  );

const normalizeStatus = (estado) => (estado ?? "").trim().toLowerCase();

const toNumber = (value) => (value == null ? null : Number(value));

const cleanString = (value) => {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).trim();
  return cleaned || null;
};

const parseDate = (value) => {
  const cleaned = cleanString(value);
  if (!cleaned) return null;
  const date = new Date(cleaned);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseJsonArray = (value) => {
  const cleaned = cleanString(value);
  if (!cleaned) return [];
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const parseEmergencyContact = (value) => {
  const cleaned = cleanString(value);
  if (!cleaned) return {};

  const [namePart, ...rest] = cleaned.split(/\s+-\s+|\s+-|-\s+/);
  const explicitPhone = rest.join(" - ").trim();
  const phoneMatch = cleaned.match(/(\+?\d[\d\s().-]{6,})$/);
  const phone = cleanString(explicitPhone || phoneMatch?.[1]);
  const name = cleanString(phoneMatch && !explicitPhone ? cleaned.replace(phoneMatch[1], "") : namePart);

  return {
    ...(name && { nombre: name.replace(/[-\s]+$/, "") }),
    ...(phone && { telefono: phone }),
  };
};

const fileUrl = (file) => (file?.filename ? `/uploads/empleados/${file.filename}` : null);

const splitFullName = (payload) => {
  const nombre = cleanString(payload.nombre);
  const apellido = cleanString(payload.apellido);
  if (nombre || apellido) return { nombre, apellido };

  const fullName = cleanString(payload.nombre_completo ?? payload.fullName);
  if (!fullName) return { nombre: null, apellido: null };

  const [firstName, ...lastNameParts] = fullName.split(/\s+/);
  return {
    nombre: firstName,
    apellido: lastNameParts.join(" ") || null,
  };
};

const findOrCreateCargo = async (nombreCargo) => {
  const nombre = cleanString(nombreCargo);
  if (!nombre) return null;

  const existing = await prisma.cARGO.findFirst({
    where: { nombre_cargo: { equals: nombre, mode: "insensitive" } },
    select: { id_cargo: true },
  });

  if (existing) return existing.id_cargo;

  try {
    const cargo = await prisma.cARGO.create({
      data: { nombre_cargo: nombre },
      select: { id_cargo: true },
    });
    return cargo.id_cargo;
  } catch {
    return null;
  }
};

const findOrCreateDepartamento = async (nombreDepartamento) => {
  const nombre = cleanString(nombreDepartamento);
  if (!nombre) return null;

  const existing = await prisma.dEPARTAMENTO.findFirst({
    where: { nombre: { equals: nombre, mode: "insensitive" } },
    select: { id_departamento: true },
  });

  if (existing) return existing.id_departamento;

  try {
    const departamento = await prisma.dEPARTAMENTO.create({
      data: { nombre },
      select: { id_departamento: true },
    });
    return departamento.id_departamento;
  } catch {
    return null;
  }
};

const findOrCreatePuerto = async (nombrePuerto) => {
  const nombre = cleanString(nombrePuerto);
  if (!nombre) return null;

  const existing = await prisma.pUERTO.findFirst({
    where: { nombre: { equals: nombre, mode: "insensitive" } },
    select: { id_puerto: true },
  });

  if (existing) return existing.id_puerto;

  try {
    const puerto = await prisma.pUERTO.create({
      data: { nombre },
      select: { id_puerto: true },
    });

    return puerto.id_puerto;
  } catch {
    return null;
  }
};

const empleadoSelect = {
  id_empleado: true,
  nombre: true,
  apellido: true,
  email: true,
  telefono: true,
  foto_url: true,
  estado_empleado: true,
  fecha_contrato: true,
  CARGO: {
    select: {
      id_cargo: true,
      nombre_cargo: true,
      nivel_responsabilidad: true,
    },
  },
  DEPARTAMENTO: {
    select: {
      id_departamento: true,
      nombre: true,
    },
  },
  PUERTO: {
    select: {
      id_puerto: true,
      nombre: true,
      codigo_puerto: true,
    },
  },
  rendimiento_empleado_rendimiento_empleado_id_empleadoToEMPLEADO: {
    select: {
      id_rendimiento: true,
      periodo: true,
      puntuacion: true,
      asistencia_pct: true,
      evaluaciones_count: true,
      notas: true,
    },
    orderBy: [{ periodo: "desc" }, { created_at: "desc" }],
    take: 1,
  },
};

const normalizeEmpleado = (empleado) => {
  const latestPerformance =
    empleado.rendimiento_empleado_rendimiento_empleado_id_empleadoToEMPLEADO?.[0] ?? null;
  const nombreCompleto = [empleado.nombre, empleado.apellido].filter(Boolean).join(" ").trim();
  const departamento = empleado.DEPARTAMENTO?.nombre ?? null;
  const barco = empleado.PUERTO?.nombre ?? empleado.PUERTO?.codigo_puerto ?? null;

  return {
    id: String(empleado.id_empleado),
    nombre: empleado.nombre ?? null,
    apellido: empleado.apellido ?? null,
    nombre_completo: nombreCompleto || "Sin nombre",
    email: empleado.email ?? null,
    telefono: empleado.telefono ?? null,
    foto_url: empleado.foto_url ?? null,
    cargo: empleado.CARGO?.nombre_cargo ?? null,
    cargo_id: empleado.CARGO?.id_cargo != null ? String(empleado.CARGO.id_cargo) : null,
    departamento,
    departamento_id:
      empleado.DEPARTAMENTO?.id_departamento != null ? String(empleado.DEPARTAMENTO.id_departamento) : null,
    puerto: barco,
    puerto_id: empleado.PUERTO?.id_puerto != null ? String(empleado.PUERTO.id_puerto) : null,
    departamento_barco: [departamento, barco].filter(Boolean).join(" / ") || "Sin asignar",
    estado: normalizeStatus(empleado.estado_empleado) || "sin_estado",
    estado_label: empleado.estado_empleado ?? "Sin estado",
    fecha_contrato: empleado.fecha_contrato ?? null,
    rendimiento: latestPerformance
      ? {
          id: String(latestPerformance.id_rendimiento),
          periodo: latestPerformance.periodo,
          puntuacion: toNumber(latestPerformance.puntuacion),
          asistencia_pct: toNumber(latestPerformance.asistencia_pct),
          evaluaciones_count: latestPerformance.evaluaciones_count ?? 0,
          notas: latestPerformance.notas ?? null,
        }
      : null,
    rendimiento_valor: toNumber(latestPerformance?.puntuacion) ?? 0,
  };
};

const buildMetrics = (empleados, vacantes) => {
  const metrics = empleados.reduce(
    (acc, empleado) => {
      const estado = normalizeStatus(empleado.estado_empleado);
      acc.total += 1;
      if (ACTIVE_STATUSES.includes(estado)) acc.activos += 1;
      if (LICENSE_STATUSES.includes(estado)) acc.licencia += 1;
      return acc;
    },
    { total: 0, activos: 0, licencia: 0, vacantes },
  );

  return metrics;
};

const getVacantes = async () => {
  const cargos = await prisma.cARGO.findMany({
    select: {
      id_cargo: true,
      _count: {
        select: { EMPLEADO: true },
      },
    },
  });

  return cargos.filter((cargo) => cargo._count.EMPLEADO === 0).length;
};

export const getEmpleadosDashboard = async (_req, res, next) => {
  try {
    const [empleadosRaw, vacantes] = await Promise.all([
      prisma.eMPLEADO.findMany({
        select: empleadoSelect,
        orderBy: [{ estado_empleado: "asc" }, { apellido: "asc" }, { nombre: "asc" }],
      }),
      getVacantes(),
    ]);

    const empleados = serialize(empleadosRaw).map(normalizeEmpleado);
    const metrics = buildMetrics(empleadosRaw, vacantes);

    res.json({
      ok: true,
      data: {
        empleados,
        metrics,
      },
      empleados,
      metrics,
    });
  } catch (error) {
    next(error);
  }
};

export const getEmpleadosCatalogos = async (_req, res, next) => {
  try {
    const [cargos, departamentos, puertos] = await Promise.all([
      prisma.cARGO.findMany({
        select: { id_cargo: true, nombre_cargo: true },
        orderBy: { nombre_cargo: "asc" },
      }),
      prisma.dEPARTAMENTO.findMany({
        select: { id_departamento: true, nombre: true },
        orderBy: { nombre: "asc" },
      }),
      prisma.pUERTO.findMany({
        select: { id_puerto: true, nombre: true },
        orderBy: { nombre: "asc" },
      }),
    ]);

    res.json({
      ok: true,
      data: {
        cargos: serialize(cargos).map((cargo) => ({
          id: String(cargo.id_cargo),
          nombre: cargo.nombre_cargo,
        })),
        departamentos: serialize(departamentos).map((departamento) => ({
          id: String(departamento.id_departamento),
          nombre: departamento.nombre,
        })),
        puertos: serialize(puertos).map((puerto) => ({
          id: String(puerto.id_puerto),
          nombre: puerto.nombre,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateEmpleado = async (req, res, next) => {
  try {
    const id = BigInt(req.params.id);

    const updates = {};

    if (req.body.nombre_completo !== undefined || req.body.nombre !== undefined) {
      const { nombre, apellido } = splitFullName(req.body);
      if (nombre) {
        updates.nombre = nombre;
        updates.apellido = apellido;
      }
    }

    if (req.body.email !== undefined) updates.email = cleanString(req.body.email);
    if (req.body.telefono !== undefined) updates.telefono = cleanString(req.body.telefono);
    if (req.body.estado_empleado !== undefined) {
      updates.estado_empleado = normalizeStatus(req.body.estado_empleado) || 'activo';
    }
    if (req.body.tipo_contrato !== undefined) updates.tipo_contrato = cleanString(req.body.tipo_contrato);
    if (req.body.turno_rotacion !== undefined) updates.turno_rotacion = cleanString(req.body.turno_rotacion);
    if (req.body.seguro_medico !== undefined) updates.seguro_medico = cleanString(req.body.seguro_medico);

    const [idCargo, idDepartamento] = await Promise.all([
      req.body.cargo !== undefined ? findOrCreateCargo(req.body.cargo) : Promise.resolve(undefined),
      req.body.departamento !== undefined ? findOrCreateDepartamento(req.body.departamento) : Promise.resolve(undefined),
    ]);

    if (idCargo !== undefined) updates.id_cargo = idCargo ?? undefined;
    if (idDepartamento !== undefined) updates.id_departamento = idDepartamento ?? undefined;

    const updated = await prisma.eMPLEADO.update({
      where: { id_empleado: id },
      data: updates,
      select: empleadoSelect,
    });

    res.json({
      ok: true,
      data: normalizeEmpleado(serialize(updated)),
    });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ ok: false, message: 'Empleado no encontrado.' });
    }
    next(error);
  }
};

export const createEmpleado = async (req, res, next) => {
  try {
    const { nombre, apellido } = splitFullName(req.body);

    if (!nombre) {
      return res.status(400).json({ ok: false, message: "El nombre del empleado es requerido." });
    }

    const [idCargo, idDepartamento, puertoBaseId] = await Promise.all([
      findOrCreateCargo(req.body.cargo ?? req.body.rol),
      findOrCreateDepartamento(req.body.departamento),
      findOrCreatePuerto(req.body.puerto ?? req.body.barco ?? req.body.homePort),
    ]);

    const emergencia = parseEmergencyContact(req.body.contacto_emergencia ?? req.body.contacto_emergencia_nombre);
    const emergenciaTelefono = cleanString(req.body.contacto_emergencia_telefono);
    const contactoEmergencia =
      Object.keys(emergencia).length > 0 || emergenciaTelefono
        ? {
            ...emergencia,
            ...(emergenciaTelefono && { telefono: emergenciaTelefono }),
          }
        : undefined;

    const salario = cleanString(req.body.salario_base);
    const foto = req.files?.find((file) => file.fieldname === "foto");
    const documentos = req.files?.filter((file) => file.fieldname === "documentos") ?? [];
    const certificaciones = parseJsonArray(req.body.certificaciones);

    const created = await prisma.$transaction(async (tx) => {
      const empleado = await tx.eMPLEADO.create({
        data: {
          nombre,
          apellido,
          email: cleanString(req.body.email),
          telefono: cleanString(req.body.telefono ?? req.body.phone),
          nacionalidad: cleanString(req.body.nacionalidad),
          numero_identificacion: cleanString(req.body.numero_identificacion ?? req.body.documento),
          fecha_nac: parseDate(req.body.fecha_nac ?? req.body.birthDate),
          fecha_contrato: parseDate(req.body.fecha_inicio ?? req.body.fecha_contrato ?? req.body.startDate) ?? new Date(),
          estado_empleado: normalizeStatus(req.body.estado_empleado ?? req.body.estado) || "activo",
          foto_url: fileUrl(foto) ?? undefined,
          tipo_contrato: cleanString(req.body.tipo_contrato),
          turno_rotacion: cleanString(req.body.turno_rotacion),
          seguro_medico: cleanString(req.body.seguro_medico),
          salario_base: salario ? Number(salario) : undefined,
          contacto_emergencia: {
            ...(contactoEmergencia ?? {}),
            ...(cleanString(req.body.direccion) && { direccion: cleanString(req.body.direccion) }),
            ...(documentos.length > 0 && {
              documentos: documentos.map((file) => ({
                nombre: file.originalname,
                tipo: file.mimetype,
                tamano: file.size,
                url: fileUrl(file),
                almacenamiento: "local",
              })),
            }),
          },
          ...(idCargo && { id_cargo: idCargo }),
          ...(idDepartamento && { id_departamento: idDepartamento }),
          ...(puertoBaseId && { puerto_base_id: puertoBaseId }),
        },
      });

      const certificationRows = certificaciones
        .map((certificacion) => ({
          id_empleado: empleado.id_empleado,
          nombre_cert: cleanString(certificacion.nombre),
          entidad_emisora: cleanString(certificacion.entidad_emisora),
          fecha_expiracion: parseDate(certificacion.fecha_expiracion),
        }))
        .filter((certificacion) => certificacion.nombre_cert);

      if (certificationRows.length > 0) {
        await tx.cERTIFICACION.createMany({ data: certificationRows });
      }

      return tx.eMPLEADO.findUnique({
        where: { id_empleado: empleado.id_empleado },
        select: empleadoSelect,
      });
    });

    res.status(201).json({
      ok: true,
      data: normalizeEmpleado(serialize(created)),
    });
  } catch (error) {
    next(error);
  }
};
