/**
 * Envío de emails (recuperación de contraseña).
 * Requiere SMTP_* en el entorno (ej. Brevo gratis). Sin configurar,
 * las rutas responden 503 con mensaje claro (igual que sin DATABASE_URL).
 */
import nodemailer from "nodemailer";

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

export const mailConfigured = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT ?? 587),
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

export async function sendResetEmail({ to, username, link }) {
  if (!mailConfigured) throw new Error("Email no configurado (faltan variables SMTP_*)");
  const from = SMTP_FROM ?? SMTP_USER;
  await getTransporter().sendMail({
    from: `"Capicúa Dominó" <${from}>`,
    to,
    subject: "Recupera tu contraseña de Capicúa 🁫",
    text:
      `Hola ${username}:\n\n` +
      `Pide cambiar tu contraseña aquí (vale 30 minutos, un solo uso):\n${link}\n\n` +
      `Si no fuiste tú, ignora este correo.\n— Capicúa Dominó`,
    html:
      `<p>Hola <b>${escapeHtml(username)}</b>:</p>` +
      `<p><a href="${link}">Toca aquí para poner una contraseña nueva</a> (vale 30 minutos, un solo uso).</p>` +
      `<p>Si no fuiste tú, ignora este correo.<br>— Capicúa Dominó</p>`,
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
