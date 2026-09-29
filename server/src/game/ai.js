/**
 * IA de bots (pura, sin red ni BD). Niveles:
 * - easy: jugada válida aleatoria.
 * - medium: prioriza dobles y fichas de mayor valor.
 * - hard: como medium + bloquea al rival (minimiza sus salidas probables)
 *   usando conteo de fichas vistas (mesa + mano propia).
 *
 * Entrada: { hand, leftEnd, rightEnd, boardEmpty, seenTiles?, rng? }
 * - seenTiles: fichas ya vistas (mesa). Si se omite, hard degrada a medium.
 * Salida: { type:'play', tile, side } | { type:'draw' } | { type:'pass' }
 * Nota: 'draw'/'pass' lo decide el llamador según pozo; aquí solo se
 * devuelve cuando NO hay jugada válida (el servidor elige draw vs pass).
 */
import { getPlayableTiles, isDouble, tilePoints, createTiles, tilesEqual } from "@domino/engine";

export const BOT_LEVELS = ["easy", "medium", "hard"];

function pickRandom(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

function scoreMedium(tile) {
  return (isDouble(tile) ? 50 : 0) + tilePoints(tile);
}

/**
 * Estima, para cada valor 0-6, cuántas fichas NO vistas podrían tener los
 * rivales que conecten con ese valor. Menos = mejor para bloquear.
 */
function unseenConnectingCount(endValue, hand, seenTiles) {
  const all = createTiles();
  let count = 0;
  for (const t of all) {
    if (t.left !== endValue && t.right !== endValue) continue;
    if (hand.some((h) => tilesEqual(h, t))) continue; // la tengo yo
    if ((seenTiles ?? []).some((s) => tilesEqual(s, t))) continue; // ya vista
    count++;
  }
  return count;
}

function resultingEnds(tile, side, leftEnd, rightEnd, boardEmpty) {
  if (boardEmpty) return [tile.left, tile.right];
  if (side === "left") {
    const newLeft = tile.left === leftEnd ? tile.right : tile.left;
    // orientTileForSide garantiza que uno de los dos iguala; el otro queda abierto
    const open = tile.right === leftEnd ? tile.left : tile.right;
    void newLeft;
    return [open, rightEnd];
  }
  const open = tile.left === rightEnd ? tile.right : tile.left;
  return [leftEnd, open];
}

export function chooseBotMove({ hand, leftEnd, rightEnd, boardEmpty, seenTiles = [], level = "medium", rng = Math.random }) {
  const playable = getPlayableTiles(hand, leftEnd, rightEnd, boardEmpty);
  if (playable.length === 0) return { type: "draw_or_pass" };

  if (level === "easy") {
    const p = pickRandom(playable, rng);
    const side = p.sides.length === 1 ? p.sides[0] : pickRandom(p.sides, rng);
    return { type: "play", tile: p.tile, side };
  }

  // medium + hard: ordenar por valor (dobles primero)
  const sorted = [...playable].sort((a, b) => scoreMedium(b.tile) - scoreMedium(a.tile));

  if (level === "medium" || seenTiles.length === 0) {
    const best = sorted[0];
    const side = best.sides.includes("right") ? "right" : "left";
    return { type: "play", tile: best.tile, side };
  }

  // hard: de las 3 mejores candidatas, elegir la que deje menos salidas al rival
  // y más variedad propia. Desempate determinista por valor.
  const candidates = sorted.slice(0, 3);
  let bestMove = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const sides = c.sides.length === 2 ? ["left", "right"] : c.sides;
    for (const side of sides) {
      const [nl, nr] = resultingEnds(c.tile, side, leftEnd, rightEnd, boardEmpty);
      const oppOptions = unseenConnectingCount(nl, hand, seenTiles) + unseenConnectingCount(nr, hand, seenTiles);
      // Queremos: valor alto propio (+) y pocas opciones rivales (-).
      // Peso del bloqueo mayor que el del valor para que se note la diferencia con medium.
      const score = scoreMedium(c.tile) * 1.0 - oppOptions * 4.0;
      if (score > bestScore) {
        bestScore = score;
        bestMove = { type: "play", tile: c.tile, side };
      }
    }
  }
  return bestMove;
}
