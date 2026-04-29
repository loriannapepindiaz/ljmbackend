import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

const SALT_ROUNDS = 12;

export const hashPassword = (password) => bcrypt.hash(password, SALT_ROUNDS);

export const comparePassword = (password, hash) => bcrypt.compare(password, hash);

export const createAuthToken = (user) => {
  return jwt.sign(
    {
      sub: user.id_usuario,
      username: user.username,
      email: user.email,
      role: user.ROL?.nombre_rol ?? null,
      isClient: user.es_cliente,
      clientId: user.id_cliente,
    },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn },
  );
};

export const verifyAuthToken = (token) => jwt.verify(token, env.jwtSecret);
