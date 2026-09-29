import { Router } from "express";
import { dbConfigured } from "../db/pool.js";
import { getRanking, getUserHistory } from "../db/stats.js";
import { getUserWithStats } from "../db/users.js";

export const statsRouter = Router();

function needDb(res) {
  if (!dbConfigured) {
    res.status(503).json({ error: "Base de datos no configurada (falta DATABASE_URL)" });
    return true;
  }
  return false;
}

// GET /api/ranking?limit=50
statsRouter.get("/ranking", async (req, res) => {
  if (needDb(res)) return;
  try {
    res.json({ ranking: await getRanking(req.query.limit) });
  } catch {
    res.status(500).json({ error: "No se pudo cargar el ranking" });
  }
});

// GET /api/users/:id (perfil público + stats)
statsRouter.get("/users/:id", async (req, res) => {
  if (needDb(res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "id inválido" });
  try {
    const full = await getUserWithStats(id);
    if (!full) return res.status(404).json({ error: "Usuario no encontrado" });
    // No exponer email ajeno: solo id/username/stats (+ email si es el propio, vía /me).
    const { email, ...pub } = full;
    res.json({ user: pub });
  } catch {
    res.status(500).json({ error: "No se pudo cargar el perfil" });
  }
});

// GET /api/users/:id/games?limit=20 (historial)
statsRouter.get("/users/:id/games", async (req, res) => {
  if (needDb(res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "id inválido" });
  try {
    res.json({ games: await getUserHistory(id, req.query.limit) });
  } catch {
    res.status(500).json({ error: "No se pudo cargar el historial" });
  }
});
