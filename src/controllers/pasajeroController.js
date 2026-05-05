import prisma from "../../prismaClient.js";

const serialize = (data) =>
  JSON.parse(JSON.stringify(data, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  ));


const clienteSelect = {
  id_cliente:  true,
  nombre:      true,
  apellido:    true,
  email:       true,
  member_code: true,
  loyalty_tier: true,
  USUARIO: {
    select: { estado_cuenta: true },
    orderBy: { id_usuario: "asc" },
    take: 1,
  },
  PASAJERO: {
    where:  { es_titular: true },
    select: { documento_numero: true, documento_tipo: true },
    take:   1,
  },
  RESERVA: {
    select:  { fecha_reserva: true },
    orderBy: { id_reserva: "desc" },
    take:    1,
  },
};

const normalizePasajero = (c) => ({
  id:               String(c.id_cliente),
  nombre:           c.nombre   ?? null,
  apellido:         c.apellido ?? null,
  email:            c.email    ?? null,
  member_code:      c.member_code ?? null,
  documento_id:     c.PASAJERO?.[0]?.documento_numero ?? null,
  documento_tipo:   c.PASAJERO?.[0]?.documento_tipo   ?? null,
  loyalty_tier:     c.loyalty_tier ?? "Explorer",
  loyalty_tier_raw: c.loyalty_tier ?? "Explorer",
  ultimo_viaje:     c.RESERVA?.[0]?.fecha_reserva ?? null,
  activo:           (c.USUARIO?.[0]?.estado_cuenta ?? "activo") === "activo",
});

export const getPasajeros = async (req, res, next) => {
  try {
    const { search } = req.query;

    const where = {};

    if (search) {
      where.OR = [
        { nombre:   { contains: search, mode: "insensitive" } },
        { apellido: { contains: search, mode: "insensitive" } },
        { email:    { contains: search, mode: "insensitive" } },
        {
          PASAJERO: {
            some: { documento_numero: { contains: search, mode: "insensitive" } },
          },
        },
      ];
    }

    const clientes = await prisma.cLIENTE.findMany({
      where,
      select: clienteSelect,
      orderBy: { id_cliente: "asc" },
    });

    const data = serialize(clientes).map(normalizePasajero);
    res.json({ ok: true, data, total: data.length });
  } catch (error) {
    next(error);
  }
};

export const updatePasajero = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, message: "ID de pasajero inválido." });
    }

    const { nombre, apellido, loyalty_tier } = req.body;

    const existing = await prisma.cLIENTE.findFirst({ where: { id_cliente: id } });
    if (!existing) {
      return res.status(404).json({ ok: false, message: "Pasajero no encontrado." });
    }

    const updated = await prisma.cLIENTE.update({
      where: { id_cliente: id },
      data: {
        ...(nombre       !== undefined && { nombre }),
        ...(apellido     !== undefined && { apellido }),
        ...(loyalty_tier !== undefined && { loyalty_tier }),
      },
      select: clienteSelect,
    });

    res.json({ ok: true, data: normalizePasajero(serialize(updated)) });
  } catch (error) {
    next(error);
  }
};

export const inactivarPasajero = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, message: "ID de pasajero inválido." });
    }

    const existing = await prisma.cLIENTE.findFirst({ where: { id_cliente: id } });
    if (!existing) {
      return res.status(404).json({ ok: false, message: "Pasajero no encontrado." });
    }

    await prisma.uSUARIO.updateMany({
      where: { id_cliente: id },
      data:  { estado_cuenta: "inactivo" },
    });

    res.json({ ok: true, message: "Pasajero desactivado correctamente." });
  } catch (error) {
    next(error);
  }
};
