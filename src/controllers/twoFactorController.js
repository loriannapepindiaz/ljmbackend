import { sendOtpEmail } from "../utils/emailService.js";

// In-memory OTP store: email → { code, expiresAt }
const otpStore = new Map();

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

export const sendEmailOtp = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ ok: false, message: "Email requerido." });

    const code = generateOtp();
    otpStore.set(email, { code, expiresAt: Date.now() + 5 * 60 * 1000 });

    await sendOtpEmail(email, code);

    res.json({ ok: true, message: "Código enviado al correo." });
  } catch (error) {
    next(error);
  }
};

export const verifyEmailOtp = (req, res, next) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ ok: false, message: "Email y código requeridos." });

    const stored = otpStore.get(email);
    if (!stored) return res.status(400).json({ ok: false, message: "No hay código activo para este correo." });
    if (Date.now() > stored.expiresAt) {
      otpStore.delete(email);
      return res.status(400).json({ ok: false, message: "El código expiró. Solicita uno nuevo." });
    }
    if (stored.code !== String(code).trim()) {
      return res.status(400).json({ ok: false, message: "Código incorrecto." });
    }

    otpStore.delete(email);
    res.json({ ok: true, message: "Código verificado correctamente." });
  } catch (error) {
    next(error);
  }
};
