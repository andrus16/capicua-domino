/** Partidas en solitario (humano + bots) en memoria. Fase 2. */
import {
  createRound, createMatch, applyRoundResult, playMove, drawTile, passTurn,
  getPlayableTiles, isBoardEmpty,
} from "@domino/engine";
import { chooseBotMove } from "./ai.js";

const games = new Map(); // gameId -> solo game
let seq = 1;

function uid() {
  return `solo_${Date.now().toString(36)}_${seq++}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function createSoloGame({ numBots = 1, level = "medium", targetScore = 50 } = {}) {
  if (![1, 2, 3].includes(numBots)) throw new Error("numBots debe ser 1-3");
  if (!["easy", "medium", "hard"].includes(level)) throw new Error("level inválido");
  const numPlayers = numBots + 1;
  const match = createMatch(numPlayers, targetScore);
  const round = createRound(numPlayers);
  const game = {
    id: uid(), numPlayers, level, match, round,
    createdAt: Date.now(),
    lastMove: null, // { seat, tile, side } última ficha jugada (para resaltarla)
    // Humano siempre asiento 0 en solitario
  };
  games.set(game.id, game);
  // Si empieza un bot, avanzar automáticamente (el cliente pedirá /step)
  return game;
}

export function getSoloGame(id) {
  return games.get(id) ?? null;
}

/** Vista pública: mano completa del humano (0), conteos del resto. */
export function publicSoloState(game, seat = 0) {
  const r = game.round;
  return {
    id: game.id,
    numPlayers: game.numPlayers,
    level: game.level,
    scores: game.match.scores,
    targetScore: game.match.targetScore,
    roundNumber: game.match.roundNumber + 1,
    board: r.board,
    leftEnd: r.leftEnd,
    rightEnd: r.rightEnd,
    pozoCount: r.pozo.length,
    turn: r.turn,
    mySeat: seat,
    myHand: r.hands[seat],
    counts: r.hands.map((h) => h.length),
    playable: getPlayableTiles(r.hands[seat], r.leftEnd, r.rightEnd, isBoardEmpty(r))
      .map((p) => ({ tile: p.tile, sides: p.sides })),
    lastMove: game.lastMove,
    canDraw: r.status === "playing" && r.turn === seat &&
      getPlayableTiles(r.hands[seat], r.leftEnd, r.rightEnd, isBoardEmpty(r)).length === 0 &&
      r.pozo.length > 0,
    canPass: r.status === "playing" && r.turn === seat &&
      getPlayableTiles(r.hands[seat], r.leftEnd, r.rightEnd, isBoardEmpty(r)).length === 0 &&
      r.pozo.length === 0,
    status: r.status,
    result: r.result,
    matchFinished: game.match.finished,
    matchWinner: game.match.winnerSeat,
  };
}

function maybeCloseRound(game) {
  const r = game.round;
  if (r.status === "finished" && r.result && !r.result.applied) {
    game.match = applyRoundResult(game.match, r.result);
    r.result.applied = true;
    return true;
  }
  return false;
}

/** Limpieza anti-DoS: borra partidas abandonadas hace más de maxAgeMs. */
export function cleanupSoloGames(maxAgeMs = 2 * 3600_000, now = Date.now()) {
  let removed = 0;
  for (const [id, g] of games) {
    if (now - g.createdAt > maxAgeMs) { games.delete(id); removed += 1; }
  }
  return removed;
}

export function humanPlay(gameId, tile, side) {
  const game = getSoloGame(gameId);
  if (!game) throw new Error("Partida no encontrada");
  if (game.round.turn !== 0) throw new Error("No es tu turno");
  game.round = playMove(game.round, 0, tile, side);
  game.lastMove = { seat: 0, tile: { ...tile }, side };
  const closed = maybeCloseRound(game);
  // Encadenar bots hasta que vuelva el turno al humano o termine la ronda.
  // (Sin delays aquí: el cliente anima con 1s entre fichas. El delay de
  // "pensamiento" 1-2s se simula en el frontend al revelar cada jugada bot.)
  let guard = 0;
  while (game.round.status === "playing" && game.round.turn !== 0 && guard++ < 50) {
    botStep(game);
  }
  maybeCloseRound(game);
  return game;
}

/** El humano roba UNA ficha del pozo (solo si no tiene jugada). */
export function humanDraw(gameId) {
  const game = getSoloGame(gameId);
  if (!game) throw new Error("Partida no encontrada");
  if (game.round.turn !== 0) throw new Error("No es tu turno");
  const { state, tile } = drawTile(game.round, 0);
  game.round = state;
  maybeCloseRound(game);
  return { game, tile };
}

/** El humano pasa (solo si no tiene jugada y el pozo está vacío). */
export function humanPass(gameId) {
  const game = getSoloGame(gameId);
  if (!game) throw new Error("Partida no encontrada");
  if (game.round.turn !== 0) throw new Error("No es tu turno");
  game.round = passTurn(game.round, 0);
  maybeCloseRound(game);
  let guard = 0;
  while (game.round.status === "playing" && game.round.turn !== 0 && guard++ < 50) {
    botStep(game);
  }
  maybeCloseRound(game);
  return game;
}

/** Ejecuta UN movimiento del bot de turno. Retorna descripción del movimiento. */
export function botStep(game) {
  const r = game.round;
  const seat = r.turn;
  const empty = isBoardEmpty(r);
  const decision = chooseBotMove({
    hand: r.hands[seat],
    leftEnd: r.leftEnd, rightEnd: r.rightEnd,
    boardEmpty: empty, seenTiles: r.board, level: game.level,
  });
  if (decision.type === "play") {
    game.round = playMove(r, seat, decision.tile, decision.side);
    game.lastMove = { seat, tile: { ...decision.tile }, side: decision.side };
    maybeCloseRound(game);
    return { seat, action: "play", tile: decision.tile, side: decision.side };
  }
  // Sin jugada: robar si hay pozo, si no pasar.
  if (r.pozo.length > 0) {
    const { state, tile } = drawTile(r, seat);
    game.round = state;
    // Tras robar, el bot intenta jugar inmediatamente si ya puede.
    const again = chooseBotMove({
      hand: game.round.hands[seat],
      leftEnd: game.round.leftEnd, rightEnd: game.round.rightEnd,
      boardEmpty: isBoardEmpty(game.round), seenTiles: game.round.board, level: game.level,
    });
    if (again.type === "play") {
      game.round = playMove(game.round, seat, again.tile, again.side);
      game.lastMove = { seat, tile: { ...again.tile }, side: again.side };
      maybeCloseRound(game);
      return { seat, action: "draw_play", tile: again.tile, side: again.side, drew: tile };
    }
    // Sigue sin poder jugar: si el pozo se vació, pasa; si no, el turno
    // sigue siendo suyo (el cliente pedirá otro step). Para simplificar el
    // bucle, robamos hasta poder jugar o vaciar el pozo.
    if (game.round.pozo.length === 0) {
      const playable = getPlayableTiles(game.round.hands[seat], game.round.leftEnd, game.round.rightEnd, isBoardEmpty(game.round));
      if (playable.length === 0) {
        game.round = passTurn(game.round, seat);
        maybeCloseRound(game);
        return { seat, action: "pass" };
      }
    }
    return { seat, action: "draw", tile: tile };
  }
  game.round = passTurn(r, seat);
  maybeCloseRound(game);
  return { seat, action: "pass" };
}

/** Nueva ronda tras fin de ronda (si el match no terminó). */
export function nextRound(gameId) {
  const game = getSoloGame(gameId);
  if (!game) throw new Error("Partida no encontrada");
  if (game.round.status !== "finished") throw new Error("La ronda sigue en curso");
  if (game.match.finished) throw new Error("La partida ya terminó");
  const { createRound: cr } = { createRound };
  game.round = cr(game.numPlayers);
  game.lastMove = null;
  let guard = 0;
  while (game.round.status === "playing" && game.round.turn !== 0 && guard++ < 50) {
    botStep(game);
  }
  return game;
}
