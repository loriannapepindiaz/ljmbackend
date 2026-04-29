import { HttpError } from "../utils/httpError.js";

export const notFoundHandler = (req, _res, next) => {
  next(new HttpError(404, `Ruta no encontrada: ${req.method} ${req.originalUrl}`));
};

export const errorHandler = (error, _req, res, _next) => {
  const statusCode = error.statusCode ?? 500;

  if (statusCode >= 500) {
    console.error(error);
  }

  res.status(statusCode).json({
    ok: false,
    message: error.message || "Error interno del servidor.",
    details: error.details ?? undefined,
  });
};
