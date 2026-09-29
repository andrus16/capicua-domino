import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createServer } from "http";
import { Server } from "socket.io";
import { createSoloGame, getSoloGame, humanPlay, humanDraw, humanPass, publicSoloState, nextRound, botStep } from "./game/soloStore.js";
import {
  createStore, getRoom, findRoomOf, seatOf, createRoom, joinRoom, leaveRoom,
  markDisconnected, startGame, playTile, drawTileRoom, passTurnRoom,
  autoPlay, nextRound as nextOnlineRound, publicStateFor, lobbyRooms, gameResultData,
  cleanupRooms,
} from "./game/rooms.js";
import { cleanupSoloGames } from "./game/soloStore.js";
import { verifyToken } from "./auth/jwt.js";
import { authRouter } from "./routes/auth.js";
import { statsRouter } from "./routes/stats.js";
import { dbConfigured, pool } from "./db/pool.js";

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

const app = express();
app.set("trust proxy", 1); // Render/CDN: IP real para el rate-limit
app.use(helmet({ contentSecurityPolicy: false })); // cabeceras seguras (sin CSP: la app es SPA simple)
app.use(cors({ origin: CLIENT_URL.split(",").map((s) => s.trim()), credentials: true }));
app.use(express.json({ limit: "64kb" }));
app.use(rateLimit({ windowMs: 60_000, max: 300 }));

app.get("/health", async (_req, res) => {
  let db = "unconfigured";
  if (dbConfigured) {
    try { await pool.query("SELECT 1"); db = "ok"; }
    catch { db = "down"; }
  }
  res.json({ ok: true, service: "domino-server", db, time: new Date().toISOString() });
});

app.use("/api/auth", authRouter);
app.use("/api", statsRouter);

// ---------- Solo vs máquina (Fase 2) ----------
app.post("/api/solo", (req, res) => {
  try {
    const { numBots = 1, level = "medium", targetScore = 100 } = req.body ?? {};
    const game = createSoloGame({ numBots: Number(numBots), level, targetScore: Number(targetScore) });
    // Si empieza un bot, que juegue hasta el humano (pensamiento simulado en cliente).
    let guard = 0;
    while (game.round.status === "playing" && game.round.turn !== 0 && guard++ < 10) {
      botStep(game);
    }
    res.json(publicSoloState(game, 0));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/solo/:id", (req, res) => {
  const g = getSoloGame(req.params.id);
  if (!g) return res.status(404).json({ error: "Partida no encontrada" });
  res.json(publicSoloState(g, 0));
});

app.post("/api/solo/:id/play", (req, res) => {
  try {
    const { tile, side } = req.body ?? {};
    if (!tile || typeof tile.left !== "number" || typeof tile.right !== "number") {
      return res.status(400).json({ error: "tile {left,right} requerido" });
    }
    if (side !== "left" && side !== "right") return res.status(400).json({ error: "side debe ser left|right" });
    if (tile.left < 0 || tile.left > 6 || tile.right < 0 || tile.right > 6) {
      return res.status(400).json({ error: "Ficha fuera de rango 0-6" });
    }
    const game = humanPlay(req.params.id, { left: tile.left, right: tile.right }, side);
    res.json(publicSoloState(game, 0));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/solo/:id/next-round", (req, res) => {
  try {
    const game = nextRound(req.params.id);
    res.json(publicSoloState(game, 0));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/solo/:id/draw", (req, res) => {
  try {
    const { game, tile } = humanDraw(req.params.id);
    res.json({ ...publicSoloState(game, 0), drew: tile });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/solo/:id/pass", (req, res) => {
  try {
    const game = humanPass(req.params.id);
    res.json(publicSoloState(game, 0));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- Socket.IO: multijugador en línea (Fase 4) ----------
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CLIENT_URL.split(",").map((s) => s.trim()), methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
});

const lobby = createStore(); // salas + presencia
const turnTimers = new Map(); // roomCode -> timeout (auto-jugada a desconectados)

function meOf(socket) {
  return lobby.users.get(socket.id) ?? null;
}

/** Foto del lobby: salas abiertas + conectados. */
function lobbySnapshot() {
  return {
    rooms: lobbyRooms(lobby),
    users: [...lobby.users.entries()].map(([socketId, u]) => ({
      socketId,
      username: u.username,
      guest: u.guest,
      inRoom: Boolean(findRoomOf(lobby, socketId)),
    })),
  };
}

function broadcastLobby() {
  io.emit("lobby:update", lobbySnapshot());
}

/** Envía a cada jugador conectado su vista personal de la sala. */
function emitRoom(room) {
  for (let seat = 0; seat < room.players.length; seat++) {
    const p = room.players[seat];
    if (p.connected && p.socketId) {
      io.to(p.socketId).emit("room:state", publicStateFor(room, seat));
    }
  }
  broadcastLobby();
}

function clearTurnTimer(code) {
  const t = turnTimers.get(code);
  if (t) { clearTimeout(t); turnTimers.delete(code); }
}

/** Si el turno es de un desconectado, programa su auto-jugada (30s). */
function armTurnTimer(room) {
  clearTurnTimer(room.code);
  if (room.status !== "playing" || !room.round || room.round.status !== "playing") return;
  const p = room.players[room.round.turn];
  if (p && !p.connected) {
    turnTimers.set(room.code, setTimeout(() => {
      turnTimers.delete(room.code);
      const res = autoPlay(lobby, room.code);
      const r = getRoom(lobby, room.code);
      if (!r) return;
      if (res && r.match.finished) void persistOnlineResult(r);
      if (r) { emitRoom(r); armTurnTimer(r); }
    }, 30_000));
  }
}

/** Guarda el resultado online en BD (si hay); nunca rompe el juego. */
async function persistOnlineResult(room) {
  try {
    const { dbConfigured } = await import("./db/pool.js");
    if (!dbConfigured) return;
    const { saveGameResult } = await import("./db/results.js");
    const data = gameResultData(room);
    if (data && room.match.finished) await saveGameResult(data);
  } catch (e) {
    console.error("[online] no se pudo persistir:", e.message);
  }
}

function guestName() {
  return `Invitado-${Math.floor(1000 + Math.random() * 9000)}`;
}

io.on("connection", (socket) => {
  // Identidad: token JWT (opcional) o invitado anónimo.
  let identity = { userId: `anon_${socket.id.slice(0, 8)}`, username: guestName(), guest: true };
  const raw = socket.handshake.auth?.token;
  if (raw) {
    try {
      const p = verifyToken(raw);
      identity = { userId: p.sub, username: p.username, guest: Boolean(p.guest) };
    } catch { /* invitado */ }
  }
  lobby.users.set(socket.id, identity);
  socket.emit("bienvenida", { socketId: socket.id, you: identity });
  broadcastLobby();

  socket.on("ping_sala", (cb) => cb?.({ ok: true, time: Date.now() }));

  // ---- Invitaciones directas ----
  socket.on("invite:send", ({ to, code }, cb) => {
    try {
      const room = getRoom(lobby, code);
      if (!room) throw new Error("Sala no encontrada");
      const target = lobby.users.get(to);
      if (!target) throw new Error("Ese jugador ya no está conectado");
      io.to(to).emit("invite:received", { from: meOf(socket), code: room.code });
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: e.message }); }
  });

  // ---- Salas ----
  socket.on("room:create", ({ maxPlayers, targetScore }, cb) => {
    try {
      const room = createRoom(lobby, { socketId: socket.id, user: meOf(socket), maxPlayers, targetScore });
      emitRoom(room);
      cb?.({ ok: true, code: room.code });
    } catch (e) { cb?.({ ok: false, error: e.message }); }
  });

  socket.on("room:join", ({ code }, cb) => {
    try {
      const { room, seat } = joinRoom(lobby, code, { socketId: socket.id, user: meOf(socket) });
      emitRoom(room);
      cb?.({ ok: true, code: room.code, seat });
    } catch (e) { cb?.({ ok: false, error: e.message }); }
  });

  socket.on("room:leave", (_payload, cb) => {
    try {
      const out = leaveRoom(lobby, socket.id);
      if (out) {
        if (out.dissolved) { clearTurnTimer(out.room.code); broadcastLobby(); }
        else emitRoom(out.room);
      } else broadcastLobby();
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: e.message }); }
  });

  socket.on("room:start", (_payload, cb) => {
    try {
      const room = findRoomOf(lobby, socket.id);
      if (!room) throw new Error("No estás en ninguna sala");
      startGame(lobby, room.code, socket.id);
      emitRoom(room);
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: e.message }); }
  });

  socket.on("room:next", (_payload, cb) => {
    try {
      const room = findRoomOf(lobby, socket.id);
      if (!room) throw new Error("No estás en ninguna sala");
      nextOnlineRound(lobby, room.code, socket.id);
      emitRoom(room);
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: e.message }); }
  });

  // ---- Jugadas ----
  const afterMove = (room) => {
    if (room.match.finished) {
      clearTurnTimer(room.code);
      void persistOnlineResult(room);
    }
    emitRoom(room);
    const r = getRoom(lobby, room.code);
    if (r) armTurnTimer(r);
  };

  socket.on("game:play", ({ tile, side }, cb) => {
    try {
      const room = findRoomOf(lobby, socket.id);
      if (!room) throw new Error("No estás en ninguna sala");
      playTile(lobby, room.code, socket.id, tile, side);
      afterMove(room);
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: e.message }); }
  });

  socket.on("game:draw", (_payload, cb) => {
    try {
      const room = findRoomOf(lobby, socket.id);
      if (!room) throw new Error("No estás en ninguna sala");
      const { tile } = drawTileRoom(lobby, room.code, socket.id);
      afterMove(room);
      cb?.({ ok: true, drew: tile });
    } catch (e) { cb?.({ ok: false, error: e.message }); }
  });

  socket.on("game:pass", (_payload, cb) => {
    try {
      const room = findRoomOf(lobby, socket.id);
      if (!room) throw new Error("No estás en ninguna sala");
      passTurnRoom(lobby, room.code, socket.id);
      afterMove(room);
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: e.message }); }
  });

  socket.on("disconnect", () => {
    const room = findRoomOf(lobby, socket.id);
    lobby.users.delete(socket.id);
    if (room) {
      const out = markDisconnected(lobby, socket.id);
      if (!out) { broadcastLobby(); return; }
      if (out.dissolved) {
        clearTurnTimer(out.room.code);
        broadcastLobby();
      } else {
        emitRoom(out.room);
        armTurnTimer(out.room);
      }
    } else {
      broadcastLobby();
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`[domino-server] escuchando en :${PORT} (CLIENT_URL=${CLIENT_URL})`);
});

// Limpieza periódica anti-DoS (partidas solo y salas lobby abandonadas).
setInterval(() => {
  try {
    const a = cleanupSoloGames();
    const b = cleanupRooms(lobby);
    for (const code of [...turnTimers.keys()]) {
      if (!lobby.rooms.has(code)) clearTurnTimer(code);
    }
    if (a + b > 0) console.log(`[limpieza] ${a} solo + ${b} salas eliminadas`);
  } catch (e) {
    console.error("[limpieza]", e.message);
  }
}, 15 * 60_000);
