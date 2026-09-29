/** Acceso a users / user_stats. Todo parametrizado. */
import { query } from "./pool.js";

export async function findUserById(id) {
  const { rows } = await query(
    `SELECT id, username, email, is_guest, created_at FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function findUserAuthByLogin(login) {
  const { rows } = await query(
    `SELECT id, username, email, password_hash, is_guest FROM users
     WHERE username = $1 OR email = $1 LIMIT 1`,
    [login]
  );
  return rows[0] ?? null;
}

export async function createUser({ username, email, passwordHash, isGuest = false }) {
  const { rows } = await query(
    `INSERT INTO users (username, email, password_hash, is_guest)
     VALUES ($1, $2, $3, $4)
     RETURNING id, username, email, is_guest, created_at`,
    [username, email, passwordHash, isGuest]
  );
  return rows[0];
}

export function guestUsername() {
  return `invitado_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export async function getUserWithStats(id) {
  const { rows } = await query(
    `SELECT u.id, u.username, u.email, u.is_guest, u.created_at,
            COALESCE(s.games_played, 0) AS games_played,
            COALESCE(s.games_won, 0) AS games_won,
            COALESCE(s.total_points, 0) AS total_points
     FROM users u LEFT JOIN user_stats s ON s.user_id = u.id
     WHERE u.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}
