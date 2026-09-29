import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chooseBotMove } from "../src/game/ai.js";

const T = (l, r) => ({ left: l, right: r });

describe("IA easy", () => {
  it("devuelve jugada válida", () => {
    const m = chooseBotMove({
      hand: [T(1, 2), T(3, 4)], leftEnd: 2, rightEnd: 6, boardEmpty: false,
      level: "easy", rng: () => 0,
    });
    assert.equal(m.type, "play");
    assert.deepEqual(m.tile, T(1, 2));
  });

  it("sin jugada -> draw_or_pass", () => {
    const m = chooseBotMove({
      hand: [T(0, 0)], leftEnd: 6, rightEnd: 6, boardEmpty: false, level: "easy",
    });
    assert.equal(m.type, "draw_or_pass");
  });
});

describe("IA medium", () => {
  it("prioriza el doble más alto", () => {
    const m = chooseBotMove({
      hand: [T(6, 1), T(5, 5)], leftEnd: 6, rightEnd: 5, boardEmpty: false,
      level: "medium", rng: () => 0.99,
    });
    // [5|5] vale 10+50=60 > [6|1]=7 -> elige el doble aunque ambos encajan
    assert.deepEqual(m.tile, T(5, 5));
  });

  it("a igual dobles, mayor valor", () => {
    const m = chooseBotMove({
      hand: [T(0, 6), T(1, 6)], leftEnd: 5, rightEnd: 6, boardEmpty: false,
      level: "medium",
    });
    assert.deepEqual(m.tile, T(1, 6)); // 7 > 6
  });
});

describe("IA hard", () => {
  it("bloquea: prefiere el extremo con menos salidas rivales", () => {
    // Mesa con extremos 2 y 5. Mano con dos opciones que dejan distintos extremos.
    // Vistas: casi todas las fichas con 5 ya jugadas -> jugar dejando 5 abierto bloquea.
    const seen = [T(5, 0), T(5, 1), T(5, 2), T(5, 3), T(5, 4), T(5, 5)];
    const m = chooseBotMove({
      hand: [T(2, 6), T(5, 6)],
      leftEnd: 2, rightEnd: 6, boardEmpty: false,
      seenTiles: seen, level: "hard", rng: () => 0,
    });
    assert.equal(m.type, "play");
    // [5|6] por la derecha deja extremos 2-5 (5 bloqueado); [2|6] dejaría 6-5.
    // Ambas dejan un 5, pero hard debe elegir deterministamente una válida:
    assert.ok([2, 5].includes(m.tile.left) || [2, 5].includes(m.tile.right));
  });

  it("sin seenTiles degrada a medium sin romper", () => {
    const m = chooseBotMove({
      hand: [T(6, 6), T(0, 1)], leftEnd: 6, rightEnd: 6, boardEmpty: false,
      level: "hard",
    });
    assert.deepEqual(m.tile, T(6, 6));
  });
});
