/** Validaciones de entradas de auth (también usadas en tests). */

export function validateUsername(username) {
  if (typeof username !== "string") return "Usuario requerido";
  const u = username.trim();
  if (u.length < 3 || u.length > 32) return "El usuario debe tener 3-32 caracteres";
  if (!/^[A-Za-z0-9_-]+$/.test(u)) return "Solo letras, números, _ y -";
  return null;
}

export function validateEmail(email) {
  if (typeof email !== "string") return "Email requerido";
  const e = email.trim().toLowerCase();
  if (e.length > 255) return "Email demasiado largo";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return "Email inválido";
  return null;
}

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 6) return "La contraseña debe tener 6+ caracteres";
  if (password.length > 128) return "Contraseña demasiado larga";
  return null;
}

export const normalizeUsername = (u) => u.trim();
export const normalizeEmail = (e) => e.trim().toLowerCase();
