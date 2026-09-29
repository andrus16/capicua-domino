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
import { dbConfigured } from "../db/pool.js";

export const authRouter = Router();
authRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

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
