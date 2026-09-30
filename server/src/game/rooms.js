/**
 * Salas multijugador en memoria (Fase 4).
 * Lógica pura de estado (sin sockets ni timers): el cableado Socket.IO
 * vive en index.js y los tests ejercitan este módulo directamente.
 *
 * Sala: { code, hostUserId, maxPlayers, targetScore, status,
 *         players: [{ socketId, userId, username, guest, connected }],
 *         match, round, lastMove, roundMoves, history, createdAt }
 * - seat = índice en players. Solo humanos (sin bots).
 * - roundMoves: jugadas de la ronda actual para persistir el resultado.
 * - history: rondas cerradas [{ roundNumber, winnerSeat, pointsAwarded,
 *   endedByBlock, moves: [{ seat, tileLeft, tileRight, side }] }].
 */
import {
  createRound, createMatch, applyRoundResult, playMove, drawTile, passTurn,
  getPlayableTiles, isBoardEmpty, autoMove,
} from "@domino/engine";

export function createStore() {
  return { rooms: new Map(), users: new Map() }; // users: socketId -> { userId, username, guest }
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O/1/I confusos
const MAX_ROOMS = 500; // anti-DoS: tope de salas en memoria
export function makeCode(rng = Math.random) {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(rng() * CODE_CHARS.length)];
  return s;
}

export function getRoom(store, code) {
  return store.rooms.get(String(code ?? "").toUpperCase()) ?? null;
}

export function findRoomOf(store, socketId) {
  for (const room of store.rooms.values()) {
    if (room.players.some((p) => p.socketId === socketId)) return room;
  }
  return null;
}

function takeSeat(room, seat) {
  const p = room.players[seat];
  if (!p) throw new Error("Asiento inválido");
  return p;
}

export function seatOf(room, socketId) {
  return room.players.findIndex((p) => p.socketId === socketId);
}

export function createRoom(store, { socketId, user, maxPlayers = 4, targetScore = 50 }) {
  if (findRoomOf(store, socketId)) throw new Error("Ya estás en una sala (sal antes de crear otra)");
  if (store.rooms.size >= MAX_ROOMS) throw new Error("Hay demasiadas salas abiertas, intenta en unos minutos");
  const n = Number(maxPlayers);
  if (![2, 3, 4].includes(n)) throw new Error("La sala debe ser de 2-4 jugadores");
  const t = Number(targetScore);
  if (!Number.isInteger(t) || t <= 0) throw new Error("Meta de puntos inválida");
  let code = makeCode();
  let guard = 0;
  while (store.rooms.has(code) && guard++ < 20) code = makeCode();
  const room = {
    code, hostUserId: user.userId, maxPlayers: n, targetScore: t,
    status: "lobby",
    players: [{ socketId, userId: user.userId, username: user.username, guest: user.guest, connected: true }],
    match: null, round: null, lastMove: null, roundMoves: [], history: [],
    createdAt: Date.now(),
  };
  store.rooms.set(code, room);
  return room;
}

export function joinRoom(store, code, { socketId, user }) {
  const room = getRoom(store, code);
  if (!room) throw new Error("Sala no encontrada (revisa el código)");
  if (room.status !== "lobby") throw new Error("La partida ya empezó");
  // Reconexión por userId: reatacha el socket nuevo al mismo asiento.
  const re = room.players.findIndex((p) => p.userId === user.userId);
  if (re !== -1) {
    room.players[re].socketId = socketId;
    room.players[re].connected = true;
    room.players[re].username = user.username;
    return { room, seat: re, reconnected: true };
  }
  if (room.players.length >= room.maxPlayers) throw new Error("Sala llena");
  if (room.players.some((p) => p.socketId === socketId)) throw new Error("Ya estás en esta sala");
  room.players.push({ socketId, userId: user.userId, username: user.username, guest: user.guest, connected: true });
  return { room, seat: room.players.length - 1, reconnected: false };
}

/** Salir (lobby) o desconectarse (en partida: queda el asiento para volver). */
export function leaveRoom(store, socketId) {
  const room = findRoomOf(store, socketId);
  if (!room) return null;
  const seat = seatOf(room, socketId);
  if (room.status === "lobby") {
    room.players.splice(seat, 1);
    if (room.players.length === 0) {
      store.rooms.delete(room.code);
      return { room, dissolved: true };
    }
    if (room.hostUserId === room.players[seat]?.userId || true) {
      // Si salió el host (o cualquiera), el host pasa al primer jugador.
      room.hostUserId = room.players[0].userId;
    }
    return { room, dissolved: false };
  }
  // En partida: marcar desconectado, conservar asiento/juego.
  room.players[seat].connected = false;
  room.players[seat].socketId = null;
  if (room.players.every((p) => !p.connected)) {
    store.rooms.delete(room.code);
    return { room, dissolved: true };
  }
  return { room, dissolved: false, seat };
}

export function markDisconnected(store, socketId) {
  const room = findRoomOf(store, socketId);
  if (!room) return null;
  const seat = seatOf(room, socketId);
  room.players[seat].connected = false;
  if (room.status === "lobby") {
    room.players.splice(seat, 1);
    if (room.players.length === 0) {
      store.rooms.delete(room.code);
      return { room, dissolved: true };
    }
    room.hostUserId = room.players[0].userId;
    return { room, dissolved: false };
  }
  if (room.players.every((p) => !p.connected)) {
    store.rooms.delete(room.code);
    return { room, dissolved: true };
  }
  return { room, dissolved: false, seat };
}

function maybeCloseRound(room) {
  const r = room.round;
  if (r.status === "finished" && r.result && !r.result.applied) {
    room.match = applyRoundResult(room.match, r.result);
    r.result.applied = true;
    room.history.push({
      roundNumber: room.match.roundNumber,
      winnerSeat: r.result.winnerSeat,
      pointsAwarded: r.result.pointsAwarded,
      endedByBlock: r.result.reason === "blocked",
      moves: room.roundMoves,
    });
    room.roundMoves = [];
    return true;
  }
  return false;
}

export function startGame(store, code, socketId) {
  const room = getRoom(store, code);
  if (!room) throw new Error("Sala no encontrada");
  const seat = seatOf(room, socketId);
  if (seat === -1) throw new Error("No estás en esta sala");
  if (room.players[seat].userId !== room.hostUserId) throw new Error("Solo el anfitrión puede iniciar");
  if (room.status !== "lobby") throw new Error("La partida ya empezó");
  if (room.players.length < 2) throw new Error("Se necesitan al menos 2 jugadores");
  room.match = createMatch(room.players.length, room.targetScore);
  room.round = createRound(room.players.length);
  room.lastMove = null;
  room.roundMoves = [];
  room.status = "playing";
  return room;
}

export function playTile(store, code, socketId, tile, side) {
  const room = getRoom(store, code);
  if (!room) throw new Error("Sala no encontrada");
  if (room.status !== "playing" || !room.round || room.round.status !== "playing") {
    throw new Error("No hay ronda en curso");
  }
  const seat = seatOf(room, socketId);
  if (seat === -1) throw new Error("No estás en esta sala");
  if (!tile || typeof tile.left !== "number" || typeof tile.right !== "number") {
    throw new Error("Ficha {left,right} requerida");
  }
  room.round = playMove(room.round, seat, { left: tile.left, right: tile.right }, side);
  room.lastMove = { seat, tile: { left: tile.left, right: tile.right }, side };
  room.roundMoves.push({ seat, tileLeft: tile.left, tileRight: tile.right, side });
  maybeCloseRound(room);
  return room;
}

export function drawTileRoom(store, code, socketId) {
  const room = getRoom(store, code);
  if (!room) throw new Error("Sala no encontrada");
  if (room.status !== "playing" || !room.round || room.round.status !== "playing") {
    throw new Error("No hay ronda en curso");
  }
  const seat = seatOf(room, socketId);
  if (seat === -1) throw new Error("No estás en esta sala");
  const { state, tile } = drawTile(room.round, seat);
  room.round = state;
  room.roundMoves.push({ seat, tileLeft: null, tileRight: null, side: "draw" });
  maybeCloseRound(room);
  return { room, tile };
}

export function passTurnRoom(store, code, socketId) {
  const room = getRoom(store, code);
  if (!room) throw new Error("Sala no encontrada");
  if (room.status !== "playing" || !room.round || room.round.status !== "playing") {
    throw new Error("No hay ronda en curso");
  }
  const seat = seatOf(room, socketId);
  if (seat === -1) throw new Error("No estás en esta sala");
  room.round = passTurn(room.round, seat);
  room.roundMoves.push({ seat, tileLeft: null, tileRight: null, side: "pass" });
  maybeCloseRound(room);
  return room;
}

/** Movimiento automático para el jugador desconectado en turno (timeout). */
export function autoPlay(store, code) {
  const room = getRoom(store, code);
  if (!room || room.status !== "playing" || !room.round || room.round.status !== "playing") return null;
  const seat = room.round.turn;
  const p = room.players[seat];
  if (p.connected) return null; // solo sustituye a desconectados
  const res = autoMove(room.round);
  room.round = res.state;
  if (res.action === "play") {
    room.lastMove = { seat, tile: { ...res.tile }, side: res.side };
    room.roundMoves.push({ seat, tileLeft: res.tile.left, tileRight: res.tile.right, side: res.side });
  } else {
    room.roundMoves.push({ seat, tileLeft: res.tile ? res.tile.left : null, tileRight: res.tile ? res.tile.right : null, side: res.action === "draw" ? "draw" : "pass" });
  }
  maybeCloseRound(room);
  return { room, seat, action: res.action };
}

export function nextRound(store, code, socketId) {
  const room = getRoom(store, code);
  if (!room) throw new Error("Sala no encontrada");
  if (seatOf(room, socketId) === -1) throw new Error("No estás en esta sala");
  if (!room.round || room.round.status !== "finished") throw new Error("La ronda sigue en curso");
  if (room.match.finished) throw new Error("La partida ya terminó");
  room.round = createRound(room.players.length);
  room.lastMove = null;
  room.roundMoves = [];
  return room;
}

/** Vista pública personalizada por asiento (nunca manos ajenas). */
export function publicStateFor(room, seat) {
  const r = room.round;
  const empty = !r || isBoardEmpty(r);
  const playable = r && r.status === "playing"
    ? getPlayableTiles(r.hands[seat] ?? [], r.leftEnd, r.rightEnd, empty).map((p) => ({ tile: p.tile, sides: p.sides }))
    : [];
  return {
    code: room.code,
    status: room.status,
    mySeat: seat,
    players: room.players.map((p, i) => ({ seat: i, username: p.username, guest: p.guest, connected: p.connected })),
    hostUserId: room.hostUserId,
    maxPlayers: room.maxPlayers,
    targetScore: room.targetScore,
    scores: room.match ? room.match.scores : room.players.map(() => 0),
    roundNumber: room.match ? room.match.roundNumber + 1 : 1,
    board: r ? r.board : [],
    leftEnd: r ? r.leftEnd : null,
    rightEnd: r ? r.rightEnd : null,
    pozoCount: r ? r.pozo.length : 0,
    turn: r ? r.turn : 0,
    myHand: r ? (r.hands[seat] ?? []) : [],
    counts: r ? r.hands.map((h) => h.length) : room.players.map(() => 0),
    playable,
    lastMove: room.lastMove,
    canDraw: Boolean(r && r.status === "playing" && r.turn === seat && playable.length === 0 && r.pozo.length > 0),
    canPass: Boolean(r && r.status === "playing" && r.turn === seat && playable.length === 0 && r.pozo.length === 0),
    roundStatus: r ? r.status : null,
    result: r ? r.result : null,
    matchFinished: room.match ? room.match.finished : false,
    matchWinner: room.match ? room.match.winnerSeat : null,
  };
}

/** Resumen de salas abiertas para el lobby. */
export function lobbyRooms(store) {
  return [...store.rooms.values()]
    .filter((r) => r.status === "lobby")
    .map((r) => ({
      code: r.code, host: r.players[0]?.username ?? "?",
      count: r.players.length, maxPlayers: r.maxPlayers,
      targetScore: r.targetScore,
      players: r.players.map((p) => p.username),
    }));
}

/** Limpieza anti-DoS: disuelve salas en lobby abandonadas hace más de maxAgeMs. */
export function cleanupRooms(store, maxAgeMs = 2 * 3600_000, now = Date.now()) {
  let removed = 0;
  for (const [code, room] of store.rooms) {
    if (room.status === "lobby" && now - room.createdAt > maxAgeMs) {
      store.rooms.delete(code);
      removed += 1;
    }
  }
  return removed;
}

/** Datos para persistir el resultado (saveGameResult). */
export function gameResultData(room) {
  if (!room.match) return null;
  return {
    roomId: null, mode: "online",
    winnerId: room.match.winnerSeat != null ? room.players[room.match.winnerSeat]?.userId ?? null : null,
    winnerSeat: room.match.winnerSeat,
    players: room.players.map((p, seat) => ({
      userId: p.guest ? null : p.userId, seat,
      isBot: false, botLevel: null,
      finalScore: room.match.scores[seat] ?? 0,
    })).filter((p) => p.userId != null || true),
    rounds: room.history,
  };
}

// Re-export para tests de integración de flujo.
export { takeSeat };
