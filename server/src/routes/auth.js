import { Router } from "express";
import rateLimit from "express-rate-limit";
import { hashPassword, comparePassword } from "../auth/password.js";
import { signToken } from "../auth/jwt.js";
import { requireAuth } from "../auth/middleware.js";
import {
  validateUsername, validateEmail, validatePassword,
  normalizeUsername, normalizeEmail,
} from "../auth/validators.js";
import { findUserById, findUserAuthByLogin, createUser, guestUsername, getUserWithStats } from "../db/users.js";
import { createResetToken, consumeResetToken } from "../db/passwordResets.js";
import { sendResetEmail, mailConfigured } from "../auth/mailer.js";
import { dbConfigured } from "../db/pool.js";

export const authRouter = Router();
authRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));
// Límite más estricto para recuperación (anti-spam de emails).
const resetLimit = rateLimit({ windowMs: 60_000, max: 10 });

function needDb(res) {
  if (!dbConfigured) {
    res.status(503).json({ error: "Base de datos no configurada (falta DATABASE_URL). El modo vs máquina sigue disponible." });
    return true;
  }
  return false;
}

const publicUser = (u) => ({ id: u.id, username: u.username, email: u.email ?? null, is_guest: u.is_guest });

// POST /api/auth/register { username, email, password }
authRouter.post("/register", async (req, res) => {
  if (needDb(res)) return;
  const { username, email, password } = req.body ?? {};
  const err = validateUsername(username) ?? validateEmail(email) ?? validatePassword(password);
  if (err) return res.status(400).json({ error: err });
  try {
    const user = await createUser({
      username: normalizeUsername(username),
      email: normalizeEmail(email),
      passwordHash: await hashPassword(password),
      isGuest: false,
    });
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Ese usuario o email ya existe" });
    res.status(500).json({ error: "No se pudo registrar" });
  }
});

// POST /api/auth/login { login, password } (login = usuario o email)
authRouter.post("/login", async (req, res) => {
  if (needDb(res)) return;
  const { login, password } = req.body ?? {};
  if (!login || !password) return res.status(400).json({ error: "Usuario y contraseña requeridos" });
  try {
    const found = await findUserAuthByLogin(String(login).trim());
    if (!found || found.is_guest) return res.status(401).json({ error: "Credenciales inválidas" });
    if (!(await comparePassword(String(password), found.password_hash))) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }
    const user = await findUserById(found.id);
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch {
    res.status(500).json({ error: "No se pudo iniciar sesión" });
  }
});

// POST /api/auth/guest -> cuenta invitada sin contraseña
authRouter.post("/guest", async (_req, res) => {
  if (needDb(res)) return;
  try {
    const user = await createUser({ username: guestUsername(), email: null, passwordHash: null, isGuest: true });
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch {
    res.status(500).json({ error: "No se pudo crear el invitado" });
  }
});

// GET /api/auth/me (requiere Bearer)
authRouter.get("/me", requireAuth, async (req, res) => {
  if (needDb(res)) return;
  const full = await getUserWithStats(req.user.id);
  if (!full) return res.status(404).json({ error: "Usuario no encontrado" });
  res.json({ user: full });
});

// POST /api/auth/forgot { login } — siempre responde OK (no enumera usuarios)
authRouter.post("/forgot", resetLimit, async (req, res) => {
  if (needDb(res)) return;
  if (!mailConfigured) {
    return res.status(503).json({ error: "Recuperación por email no configurada todavía" });
  }
  const { login } = req.body ?? {};
  const done = { ok: true, message: "Si existe una cuenta con ese dato, enviamos un correo con el enlace (30 min)." };
  if (!login || typeof login !== "string") return res.json(done);
  try {
    const found = await findUserAuthByLogin(login.trim());
    // Solo registrados con email reciben correo (invitados no tienen).
    if (!found || found.is_guest || !found.email) return res.json(done);
    const token = await createResetToken(found.id);
    const base = (process.env.CLIENT_URL ?? "").split(",")[0].trim().replace(/\/$/, "");
    await sendResetEmail({
      to: found.email,
      username: found.username,
      link: `${base}/?reset=${token}`,
    });
  } catch (e) {
    console.error("[forgot]", e.message);
  }
  res.json(done);
});

// POST /api/auth/reset { token, password } — consume el enlace
authRouter.post("/reset", resetLimit, async (req, res) => {
  if (needDb(res)) return;
  const { token, password } = req.body ?? {};
  const err = validatePassword(password);
  if (err) return res.status(400).json({ error: err });
  try {
    const userId = await consumeResetToken(String(token ?? ""), await hashPassword(password));
    const user = await findUserById(userId);
    res.json({ ok: true, message: "Contraseña actualizada, ya puedes entrar", user: publicUser(user) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
