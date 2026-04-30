import prisma from "../../prismaClient.js";
import { comparePassword, createAuthToken, hashPassword } from "../utils/auth.js";
import { HttpError } from "../utils/httpError.js";

const normalizeEmail = (email) => email.trim().toLowerCase();

const normalizeLogin = (value) => value.trim().replace(/\s+/g, " ").toLowerCase();

const splitFullName = (fullName) => {
  const parts = fullName.trim().split(/\s+/);
  const nombre = parts.shift() ?? "";
  const apellido = parts.join(" ") || null;
  return { nombre, apellido };
};

const sanitizeUser = (user) => ({
  id: user.id_usuario,
  username: user.username,
  email: user.email,
  estadoCuenta: user.estado_cuenta,
  esCliente: user.es_cliente,
  idCliente: user.id_cliente,
  rol: user.ROL?.nombre_rol ?? null,
  cliente: user.CLIENTE
    ? {
        id: user.CLIENTE.id_cliente,
        nombre: user.CLIENTE.nombre,
        apellido: user.CLIENTE.apellido,
        email: user.CLIENTE.email,
        memberCode: user.CLIENTE.member_code,
        loyaltyTier: user.CLIENTE.loyalty_tier,
      }
    : null,
});

const ADMIN_ROLE_NAMES = new Set([
  "admin",
  "admins",
  "administrador",
  "administradora",
  "super admin",
  "superadmin",
  "administrator",
]);

const isAdminRole = (roleName) => {
  if (!roleName) {
    return false;
  }

  const role = normalizeLogin(roleName);

  return ADMIN_ROLE_NAMES.has(role) || role.includes("admin");
};

const getClientRoleId = async () => {
  const role = await prisma.rOL.findFirst({
    where: {
      OR: [
        { nombre_rol: { equals: "cliente", mode: "insensitive" } },
        { nombre_rol: { equals: "usuario", mode: "insensitive" } },
        { nombre_rol: { equals: "user", mode: "insensitive" } },
        { nombre_rol: { contains: "client", mode: "insensitive" } },
      ],
    },
    select: { id_rol: true },
  });

  return role?.id_rol ?? null;
};

export const registerClientUser = async ({ fullName, email, password }) => {
  const cleanEmail = normalizeEmail(email);
  const cleanUsername = normalizeLogin(fullName);
  const { nombre, apellido } = splitFullName(fullName);

  const existingUser = await prisma.uSUARIO.findFirst({
    where: {
      OR: [{ email: cleanEmail }, { username: cleanUsername }],
    },
    select: { id_usuario: true },
  });

  if (existingUser) {
    throw new HttpError(409, "Ya existe una cuenta con ese correo electrónico.");
  }

  const existingClient = await prisma.cLIENTE.findUnique({
    where: { email: cleanEmail },
    select: { id_cliente: true },
  });

  if (existingClient) {
    throw new HttpError(409, "Ya existe un cliente registrado con ese correo electrónico.");
  }

  const [passwordHash, clientRoleId] = await Promise.all([
    hashPassword(password),
    getClientRoleId(),
  ]);

  const user = await prisma.$transaction(async (tx) => {
    const client = await tx.cLIENTE.create({
      data: {
        nombre,
        apellido,
        email: cleanEmail,
      },
    });

    return tx.uSUARIO.create({
      data: {
        username: cleanUsername,
        email: cleanEmail,
        password_hash: passwordHash,
        es_cliente: true,
        CLIENTE: {
          connect: { id_cliente: client.id_cliente },
        },
        ...(clientRoleId
          ? {
              ROL: {
                connect: { id_rol: clientRoleId },
              },
            }
          : {}),
        estado_cuenta: "activo",
      },
      include: {
        CLIENTE: true,
        ROL: true,
      },
    });
  });

  const token = createAuthToken(user);

  return {
    token,
    user: sanitizeUser(user),
  };
};

export const loginClientUser = async ({ username, password }) => {
  const login = normalizeLogin(username);
  const { nombre, apellido } = splitFullName(login);

  const clientNameFilter = apellido
    ? {
        CLIENTE: {
          is: {
            nombre: { equals: nombre, mode: "insensitive" },
            apellido: { equals: apellido, mode: "insensitive" },
          },
        },
      }
    : {
        CLIENTE: {
          is: {
            nombre: { equals: nombre, mode: "insensitive" },
          },
        },
      };

  const user = await prisma.uSUARIO.findFirst({
    where: {
      OR: [{ username: login }, clientNameFilter],
      es_cliente: true,
    },
    include: {
      CLIENTE: true,
      ROL: true,
    },
  });

  if (!user || !user.password_hash) {
    throw new HttpError(401, "Credenciales incorrectas.");
  }

  if (user.estado_cuenta !== "activo") {
    throw new HttpError(403, "Esta cuenta no está activa.");
  }

  const isValidPassword = await comparePassword(password, user.password_hash);

  if (!isValidPassword) {
    throw new HttpError(401, "Credenciales incorrectas.");
  }

  const updatedUser = await prisma.uSUARIO.update({
    where: { id_usuario: user.id_usuario },
    data: {
      ultimo_login_at: new Date(),
      intentos_fallidos: 0,
    },
    include: {
      CLIENTE: true,
      ROL: true,
    },
  });

  return {
    token: createAuthToken(updatedUser),
    user: sanitizeUser(updatedUser),
  };
};

export const loginAdminUser = async ({ username, password }) => {
  const login = normalizeLogin(username);
  const loginAsNumber = Number(login);
  const canSearchById = Number.isInteger(loginAsNumber) && loginAsNumber > 0;

  const user = await prisma.uSUARIO.findFirst({
    where: {
      OR: [
        { username: { equals: login, mode: "insensitive" } },
        { email: { equals: login, mode: "insensitive" } },
        ...(canSearchById ? [{ id_usuario: loginAsNumber }] : []),
      ],
    },
    include: {
      CLIENTE: true,
      ROL: true,
    },
  });

  if (!user || !user.password_hash || !isAdminRole(user.ROL?.nombre_rol)) {
    throw new HttpError(401, "Credenciales de administrador incorrectas.");
  }

  if (user.estado_cuenta !== "activo") {
    throw new HttpError(403, "Esta cuenta administrativa no estÃ¡ activa.");
  }

  const isValidPassword = await comparePassword(password, user.password_hash);

  if (!isValidPassword) {
    throw new HttpError(401, "Credenciales de administrador incorrectas.");
  }

  const updatedUser = await prisma.uSUARIO.update({
    where: { id_usuario: user.id_usuario },
    data: {
      ultimo_login_at: new Date(),
      intentos_fallidos: 0,
    },
    include: {
      CLIENTE: true,
      ROL: true,
    },
  });

  return {
    token: createAuthToken(updatedUser),
    user: sanitizeUser(updatedUser),
  };
};

export const getUserById = async (userId) => {
  const user = await prisma.uSUARIO.findUnique({
    where: { id_usuario: Number(userId) },
    include: {
      CLIENTE: true,
      ROL: true,
    },
  });

  if (!user) {
    throw new HttpError(404, "Usuario no encontrado.");
  }

  return sanitizeUser(user);
};
