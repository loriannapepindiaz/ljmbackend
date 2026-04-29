import { verifyAuthToken } from "../utils/auth.js";
import { HttpError } from "../utils/httpError.js";

export const requireAuth = (req, _res, next) => {
  try {
    const header = req.headers.authorization;

    if (!header?.startsWith("Bearer ")) {
      throw new HttpError(401, "Token de autenticación requerido.");
    }

    req.auth = verifyAuthToken(header.slice(7));
    next();
  } catch {
    next(new HttpError(401, "Sesión inválida o expirada."));
  }
};
