import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendOtpEmail = async (to, code) => {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("Configura RESEND_API_KEY en el archivo .env del backend.");
  }

  await resend.emails.send({
    from: process.env.EMAIL_FROM ?? "onboarding@resend.dev",
    to,
    subject: "Tu código de verificación — LJM Sealine",
    html: `
      <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:32px 24px;background:#f6f7f8;border-radius:16px">
        <div style="background:#0e1a34;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
          <h1 style="color:#eacea9;margin:0;font-size:22px;letter-spacing:1px">LJM SEALINE</h1>
          <p style="color:#eacea9aa;margin:6px 0 0;font-size:12px">Panel Administrativo</p>
        </div>
        <h2 style="color:#0e1a34;font-size:18px;margin:0 0 8px">Verificación de dos factores</h2>
        <p style="color:#555;font-size:14px;margin:0 0 24px">
          Usa este código para completar la configuración. Expira en <strong>5 minutos</strong>.
        </p>
        <div style="background:#0e1a34;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px">
          <span style="font-size:38px;font-weight:bold;letter-spacing:12px;color:#eacea9;font-family:monospace">${code}</span>
        </div>
        <p style="color:#999;font-size:12px;text-align:center;margin:0">
          Si no solicitaste este código, ignora este mensaje.
        </p>
      </div>
    `,
  });
};
