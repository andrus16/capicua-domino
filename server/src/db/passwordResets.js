/**
 * Tokens de recuperación de contraseña (un solo uso, 30 min).
 * Se guarda SHA-256 del token; la comparación usa tiempo constante.
 */
import { createHash, timingSafeEqual, randomBytes } from "node:crypto";
import { query } from "./pool.js";

export const RESET_TTL_MS = 30 * 60_000;

export function newResetToken() {
  return randomBytes(32).toString("hex"); // 64 caracteres
}

export function hashResetToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

function safeEqual(a, b) {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Crea un token (invalida los anteriores del usuario). Retorna el token en claro (solo para el email). */
export async function createResetToken(userId, ttlMs = RESET_TTL_MS) {
  const token = newResetToken();
  const hash = hashResetToken(token);
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await query(`DELETE FROM password_resets WHERE user_id = $1`, [userId]);
  await query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hash, expiresAt]
  );
  return token;
}

/** Busca el reseteo válido para un token en claro (o null). */
export async function findValidReset(token) {
  if (typeof token !== "string" || token.length < 32) return null;
  const hash = hashResetToken(token);
  const { rows } = await query(
    `SELECT pr.id, pr.user_id, pr.token_hash, pr.expires_at, pr.used_at,
            u.username, u.email, u.is_guest
     FROM password_resets pr JOIN users u ON u.id = pr.user_id
     WHERE pr.used_at IS NULL AND pr.expires_at > now() AND pr.token_hash = $1
     LIMIT 1`,
    [hash]
  );
  const row = rows[0] ?? null;
  if (!row) return null;
  // Defensa extra en tiempo constante (el índice de Postgres cortocircuita).
  if (!safeEqual(hash, row.token_hash)) return null;
  return row;
}

/** Consume el token y cambia la contraseña. Retorna userId. */
export async function consumeResetToken(token, passwordHash) {
  const found = await findValidReset(token);
  if (!found) throw new Error("Enlace inválido o vencido (pide uno nuevo)");
  await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, found.user_id]);
  await query(`UPDATE password_resets SET used_at = now() WHERE id = $1`, [found.id]);
  await query(`DELETE FROM password_resets WHERE user_id = $1 AND id <> $2`, [found.user_id, found.id]);
  return found.user_id;
}
