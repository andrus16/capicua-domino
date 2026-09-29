/**
 * Motor de reglas de dominó doble-seis (2-4 jugadores).
 * Módulo PURO: sin red, sin BD, sin timers, sin dependencias.
 * Toda aleatoriedad se inyecta vía `rng()` para que los tests sean deterministas.
 *
 * Convenciones:
 * - Tile = { left: 0..6, right: 0..6 }
 * - Board = array ordenado izquierda -> derecha, con fichas YA orientadas.
 * - leftEnd / rightEnd = valores abiertos de la mesa (null si mesa vacía).
 */

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

export class EngineError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Utilidades básicas
// ---------------------------------------------------------------------------

export function makeTile(left, right) {
  assertPip(left);
  assertPip(right);
  return { left, right };
}

function assertPip(v) {
  if (!Number.isInteger(v) || v < 0 || v > 6) {
    throw new EngineError("BAD_TILE", `Pip inválido: ${v} (debe ser 0-6)`);
  }
}

/** Igualdad insensible al orden: [2,5] == [5,2]. */
export function tilesEqual(a, b) {
  return (a.left === b.left && a.right === b.right) ||
         (a.left === b.right && a.right === b.left);
}

export function isDouble(t) {
  return t.left === t.right;
}

export function tilePoints(t) {
  return t.left + t.right;
}

export function handPoints(hand) {
  return hand.reduce((s, t) => s + tilePoints(t), 0);
}

export function allHandPoints(hands) {
  return hands.map(handPoints);
}

/** Las 28 fichas del doble-seis, ordenadas. */
export function createTiles() {
  const tiles = [];
  for (let a = 0; a <= 6; a++) {
    for (let b = a; b <= 6; b++) {
      tiles.push({ left: a, right: b });
    }
  }
  return tiles;
}

/** Fisher-Yates. No muta el input. `rng` debe devolver [0,1). */
export function shuffleTiles(tiles, rng = Math.random) {
  const arr = tiles.map((t) => ({ ...t }));
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Reparto
// ---------------------------------------------------------------------------

/**
 * Reparte 7 fichas por jugador.
 * - 2 jugadores: sobran 14 -> `pozo` (para robar).
 * - 3 jugadores: sobran 7 -> `unused` (fuera de juego).
 * - 4 jugadores: 28 exactas -> pozo y unused vacíos.
 */
export function dealTiles(numPlayers, rng = Math.random) {
  assertNumPlayers(numPlayers);
  const deck = shuffleTiles(createTiles(), rng);
  const hands = Array.from({ length: numPlayers }, () => []);
  for (let k = 0; k < 7; k++) {
    for (let s = 0; s < numPlayers; s++) {
      hands[s].push(deck.pop());
    }
  }
  const rest = deck; // lo que queda en el mazo
  if (numPlayers === 2) return { hands, pozo: rest, unused: [] };
  if (numPlayers === 3) return { hands, pozo: [], unused: rest };
  return { hands, pozo: [], unused: [] };
}

function assertNumPlayers(n) {
  if (![2, 3, 4].includes(n)) {
    throw new EngineError("BAD_PLAYERS", `numPlayers debe ser 2, 3 o 4 (recibido ${n})`);
  }
}

// ---------------------------------------------------------------------------
// Salida inicial
// ---------------------------------------------------------------------------

/**
 * Quién empieza: el doble más alto en mano; si no hay dobles, la ficha de
 * mayor suma (desempate: mayor pip individual, luego menor asiento).
 * @returns {{ seat: number, tile: {left,right} }}
 */
export function findStartingPlay(hands) {
  let bestDouble = null;
  for (let s = 0; s < hands.length; s++) {
    for (const t of hands[s]) {
      if (isDouble(t) && (!bestDouble || t.left > bestDouble.tile.left)) {
        bestDouble = { seat: s, tile: { ...t } };
      }
    }
  }
  if (bestDouble) return bestDouble;

  let best = null;
  const score = (t) => tilePoints(t) * 10 + Math.max(t.left, t.right);
  for (let s = 0; s < hands.length; s++) {
    for (const t of hands[s]) {
      if (!best || score(t) > score(best.tile)) {
        best = { seat: s, tile: { ...t } };
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Estado de ronda
// ---------------------------------------------------------------------------

/**
 * Crea el estado inicial de una ronda.
 * Acepta `hands`/`pozo`/`startingSeat` para tests deterministas.
 */
export function createRound(numPlayers, opts = {}) {
  assertNumPlayers(numPlayers);
  const rng = opts.rng ?? Math.random;
  let hands, pozo;
  if (opts.hands) {
    hands = opts.hands.map((h) => h.map((t) => ({ ...t })));
    pozo = (opts.pozo ?? []).map((t) => ({ ...t }));
  } else {
    const dealt = dealTiles(numPlayers, rng);
    hands = dealt.hands;
    pozo = dealt.pozo;
  }
  const startingSeat = opts.startingSeat ?? findStartingPlay(hands).seat;
  return {
    numPlayers,
    hands,
    board: [],
    leftEnd: null,
    rightEnd: null,
    pozo,
    turn: startingSeat,
    consecutivePasses: 0,
    moveNumber: 0,
    status: "playing",
    result: null,
  };
}

export function isBoardEmpty(state) {
  return state.board.length === 0;
}

// ---------------------------------------------------------------------------
// Jugadas válidas
// ---------------------------------------------------------------------------

/** ¿La ficha conecta con el extremo de valor `end`? */
export function connects(tile, end) {
  return tile.left === end || tile.right === end;
}

/**
 * Lados válidos para una ficha: subconjunto de ['left','right'].
 * Mesa vacía -> ['left','right'] (colocación libre).
 */
export function getValidSides(tile, leftEnd, rightEnd, boardEmpty) {
  if (boardEmpty) return ["left", "right"];
  const sides = [];
  if (connects(tile, leftEnd)) sides.push("left");
  if (connects(tile, rightEnd)) sides.push("right");
  return sides;
}

/** Fichas jugables de una mano con sus lados. */
export function getPlayableTiles(hand, leftEnd, rightEnd, boardEmpty) {
  const out = [];
  hand.forEach((tile, index) => {
    const sides = getValidSides(tile, leftEnd, rightEnd, boardEmpty);
    if (sides.length > 0) out.push({ tile: { ...tile }, index, sides });
  });
  return out;
}

export function hasPlayable(hand, leftEnd, rightEnd, boardEmpty) {
  return getPlayableTiles(hand, leftEnd, rightEnd, boardEmpty).length > 0;
}

/**
 * Orienta la ficha para que encaje:
 * - lado 'right': su `left` debe igualar rightEnd.
 * - lado 'left': su `right` debe igualar leftEnd.
 */
export function orientTileForSide(tile, side, endValue) {
  if (side === "right") {
    if (tile.left === endValue) return { left: tile.left, right: tile.right };
    if (tile.right === endValue) return { left: tile.right, right: tile.left };
  } else if (side === "left") {
    if (tile.right === endValue) return { left: tile.left, right: tile.right };
    if (tile.left === endValue) return { left: tile.right, right: tile.left };
  }
  throw new EngineError("ILLEGAL_MOVE", `La ficha [${tile.left}|${tile.right}] no encaja en ${side}=${endValue}`);
}

// ---------------------------------------------------------------------------
// Mutaciones (inmutables: devuelven un estado nuevo)
// ---------------------------------------------------------------------------

function cloneState(s) {
  return {
    numPlayers: s.numPlayers,
    hands: s.hands.map((h) => h.map((t) => ({ ...t }))),
    board: s.board.map((t) => ({ ...t })),
    leftEnd: s.leftEnd,
    rightEnd: s.rightEnd,
    pozo: s.pozo.map((t) => ({ ...t })),
    turn: s.turn,
    consecutivePasses: s.consecutivePasses,
    moveNumber: s.moveNumber,
    status: s.status,
    result: s.result ? { ...s.result, handPoints: [...s.result.handPoints] } : null,
  };
}

function removeOneTile(hand, tile) {
  const i = hand.findIndex((t) => tilesEqual(t, tile));
  if (i === -1) throw new EngineError("NOT_IN_HAND", `No tienes la ficha [${tile.left}|${tile.right}]`);
  const next = hand.slice();
  next.splice(i, 1);
  return next;
}

function finishWithWinner(state, winnerSeat, reason) {
  const hp = allHandPoints(state.hands);
  const pointsAwarded = hp.reduce((s, p, i) => (i === winnerSeat ? s : s + p), 0);
  state.status = "finished";
  state.result = { winnerSeat, reason, pointsAwarded, handPoints: hp };
  return state;
}

/**
 * Jugar una ficha por un extremo.
 * @param side 'left' | 'right' (en mesa vacía se ignora y se coloca tal cual)
 */
export function playMove(state, seat, tile, side) {
  if (state.status !== "playing") throw new EngineError("ROUND_OVER", "La ronda ya terminó");
  if (seat !== state.turn) throw new EngineError("NOT_YOUR_TURN", `Turno del asiento ${state.turn}, no del ${seat}`);
  if (side !== "left" && side !== "right") throw new EngineError("BAD_SIDE", "side debe ser 'left' o 'right'");

  const next = cloneState(state);
  const empty = isBoardEmpty(next);

  // Validar posesión antes de validar encaje (mejor mensaje de error).
  next.hands[seat] = removeOneTile(next.hands[seat], tile);

  if (empty) {
    const placed = { left: tile.left, right: tile.right };
    next.board.push(placed);
    next.leftEnd = placed.left;
    next.rightEnd = placed.right;
  } else {
    const end = side === "left" ? next.leftEnd : next.rightEnd;
    const sides = getValidSides(tile, next.leftEnd, next.rightEnd, false);
    if (!sides.includes(side)) {
      throw new EngineError("ILLEGAL_MOVE", `La ficha [${tile.left}|${tile.right}] no encaja por ${side} (${next.leftEnd}|${next.rightEnd})`);
    }
    const oriented = orientTileForSide(tile, side, end);
    if (side === "left") {
      next.board.unshift(oriented);
      next.leftEnd = oriented.left;
    } else {
      next.board.push(oriented);
      next.rightEnd = oriented.right;
    }
  }

  next.moveNumber += 1;
  next.consecutivePasses = 0;

  // ¿Dominó? (se quedó sin fichas)
  if (next.hands[seat].length === 0) {
    return finishWithWinner(next, seat, "domino");
  }
  next.turn = (seat + 1) % next.numPlayers;
  return next;
}

/**
 * Robar del pozo (solo 2 jugadores). No avanza el turno: el jugador debe
 * intentar jugar tras robar. Solo permitido si NO tiene jugada válida.
 * @returns {{ state, tile }}
 */
export function drawTile(state, seat) {
  if (state.status !== "playing") throw new EngineError("ROUND_OVER", "La ronda ya terminó");
  if (seat !== state.turn) throw new EngineError("NOT_YOUR_TURN", `Turno del asiento ${state.turn}`);
  if (state.pozo.length === 0) throw new EngineError("POZO_EMPTY", "El pozo está vacío: debes pasar");
  const empty = isBoardEmpty(state);
  if (hasPlayable(state.hands[seat], state.leftEnd, state.rightEnd, empty)) {
    throw new EngineError("HAS_PLAY", "Tienes jugada válida: no puedes robar");
  }
  const next = cloneState(state);
  const tile = next.pozo.pop();
  next.hands[seat].push(tile);
  next.moveNumber += 1;
  return { state: next, tile: { ...tile } };
}

/**
 * Pasar el turno. Solo si no hay jugada válida y el pozo está vacío
 * (en 3-4 jugadores el pozo siempre está vacío).
 * Si pasan todos seguidos -> tranque: gana quien menos puntos tenga.
 */
export function passTurn(state, seat) {
  if (state.status !== "playing") throw new EngineError("ROUND_OVER", "La ronda ya terminó");
  if (seat !== state.turn) throw new EngineError("NOT_YOUR_TURN", `Turno del asiento ${state.turn}`);
  const empty = isBoardEmpty(state);
  if (hasPlayable(state.hands[seat], state.leftEnd, state.rightEnd, empty)) {
    throw new EngineError("HAS_PLAY", "Tienes jugada válida: no puedes pasar");
  }
  if (state.pozo.length > 0) {
    throw new EngineError("MUST_DRAW", `Quedan ${state.pozo.length} en el pozo: debes robar`);
  }
  const next = cloneState(state);
  next.consecutivePasses += 1;
  next.moveNumber += 1;
  if (next.consecutivePasses >= next.numPlayers) {
    // Tranque: menor puntuación gana (empate -> asiento más bajo).
    const hp = allHandPoints(next.hands);
    let winner = 0;
    for (let i = 1; i < hp.length; i++) if (hp[i] < hp[winner]) winner = i;
    return finishWithWinner(next, winner, "blocked");
  }
  next.turn = (seat + 1) % next.numPlayers;
  return next;
}

// ---------------------------------------------------------------------------
// Partida a X puntos (varias rondas)
// ---------------------------------------------------------------------------

export function createMatch(numPlayers, targetScore = 100) {
  assertNumPlayers(numPlayers);
  if (!Number.isInteger(targetScore) || targetScore <= 0) {
    throw new EngineError("BAD_TARGET", "targetScore debe ser un entero positivo");
  }
  return { numPlayers, targetScore, scores: Array(numPlayers).fill(0), roundNumber: 0, finished: false, winnerSeat: null };
}

/** Suma los puntos de la ronda al ganador. Devuelve un match nuevo. */
export function applyRoundResult(match, roundResult) {
  const next = {
    ...match,
    scores: [...match.scores],
    roundNumber: match.roundNumber + 1,
  };
  next.scores[roundResult.winnerSeat] += roundResult.pointsAwarded;
  const w = checkMatchWinner(next);
  if (w !== -1) {
    next.finished = true;
    next.winnerSeat = w;
  }
  return next;
}

/** Asiento ganador si alguien alcanzó targetScore, o -1. Empate -> menor asiento. */
export function checkMatchWinner(match) {
  let best = -1;
  for (let i = 0; i < match.numPlayers; i++) {
    if (match.scores[i] >= match.targetScore) {
      if (best === -1 || match.scores[i] > match.scores[best]) best = i;
    }
  }
  return best;
}

/**
 * Movimiento automático para timeouts (servidor): juega la primera ficha
 * válida, o roba si hay pozo, o pasa. Nunca lanza si la ronda sigue viva.
 * @returns {{ action: 'play'|'draw'|'pass', state, tile?, side? }}
 */
export function autoMove(state) {
  if (state.status !== "playing") throw new EngineError("ROUND_OVER", "La ronda ya terminó");
  const seat = state.turn;
  const empty = isBoardEmpty(state);
  const playable = getPlayableTiles(state.hands[seat], state.leftEnd, state.rightEnd, empty);
  if (playable.length > 0) {
    const { tile, sides } = playable[0];
    const side = sides.includes("right") ? "right" : "left";
    return { action: "play", state: playMove(state, seat, tile, side), tile, side };
  }
  if (state.pozo.length > 0) {
    const { state: s, tile } = drawTile(state, seat);
    return { action: "draw", state: s, tile };
  }
  return { action: "pass", state: passTurn(state, seat) };
}
