import { getUserById, loginClientUser, registerClientUser } from "../services/authService.js";
import { HttpError } from "../utils/httpError.js";

const isValidEmail = (email) => /\S+@\S+\.\S+/.test(email);

const validateRegisterBody = ({ fullName, email, password, confirmPassword }) => {
  if (!fullName?.trim()) {
    throw new HttpError(400, "El nombre completo es requerido.");
  }

  if (!email || !isValidEmail(email)) {
    throw new HttpError(400, "Ingrese un correo electrónico válido.");
  }

  if (!password || password.length < 8) {
    throw new HttpError(400, "La contraseña debe tener al menos 8 caracteres.");
  }

  if (confirmPassword !== undefined && password !== confirmPassword) {
    throw new HttpError(400, "Las contraseñas no coinciden.");
  }
};

const validateLoginBody = ({ username, password }) => {
  if (!username?.trim() || !password) {
    throw new HttpError(400, "Usuario y contraseña son requeridos.");
  }
};

export const register = async (req, res, next) => {
  try {
    validateRegisterBody(req.body);
    const result = await registerClientUser(req.body);
    res.status(201).json({
      ok: true,
      message: "Registro completado correctamente.",
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (req, res, next) => {
  try {
    validateLoginBody(req.body);
    const result = await loginClientUser(req.body);
    res.json({
      ok: true,
      message: "Inicio de sesión correcto.",
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

export const me = async (req, res, next) => {
  try {
    const user = await getUserById(req.auth.sub);
    res.json({ ok: true, user });
  } catch (error) {
    next(error);
  }
};
