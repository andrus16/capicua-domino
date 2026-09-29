import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EngineError,
  makeTile,
  tilesEqual,
  isDouble,
  tilePoints,
  handPoints,
  createTiles,
  shuffleTiles,
  dealTiles,
  findStartingPlay,
  createRound,
  connects,
  getValidSides,
  getPlayableTiles,
  orientTileForSide,
  playMove,
  drawTile,
  passTurn,
  createMatch,
  applyRoundResult,
  checkMatchWinner,
  autoMove,
} from "../src/engine.js";

const T = (l, r) => ({ left: l, right: r });
const rngZero = () => 0; // determinista

describe("tiles", () => {
  it("createTiles genera 28 fichas únicas", () => {
    const tiles = createTiles();
    assert.equal(tiles.length, 28);
    const keys = new Set(tiles.map((t) => `${Math.min(t.left, t.right)}-${Math.max(t.left, t.right)}`));
    assert.equal(keys.size, 28);
  });

  it("makeTile valida pips 0-6", () => {
    assert.throws(() => makeTile(7, 0), EngineError);
    assert.throws(() => makeTile(-1, 0), EngineError);
    assert.deepEqual(makeTile(0, 0), { left: 0, right: 0 });
  });

  it("tilesEqual ignora el orden", () => {
    assert.equal(tilesEqual(T(2, 5), T(5, 2)), true);
    assert.equal(tilesEqual(T(2, 5), T(2, 6)), false);
  });

  it("isDouble y puntos", () => {
    assert.equal(isDouble(T(3, 3)), true);
    assert.equal(isDouble(T(3, 4)), false);
    assert.equal(tilePoints(T(6, 5)), 11);
    assert.equal(handPoints([T(1, 2), T(0, 0)]), 3);
  });

  it("shuffle no muta y conserva las 28", () => {
    const orig = createTiles();
    const snap = JSON.stringify(orig);
    const sh = shuffleTiles(orig, rngZero);
    assert.equal(sh.length, 28);
    assert.equal(JSON.stringify(orig), snap);
  });
});

describe("reparto", () => {
  it("2 jugadores: 7 cada uno + pozo de 14", () => {
    const { hands, pozo, unused } = dealTiles(2, rngZero);
    assert.equal(hands.length, 2);
    assert.equal(hands[0].length, 7);
    assert.equal(hands[1].length, 7);
    assert.equal(pozo.length, 14);
    assert.equal(unused.length, 0);
  });

  it("3 jugadores: 7 cada uno, sin pozo", () => {
    const { hands, pozo, unused } = dealTiles(3, rngZero);
    assert.equal(hands.flat().length, 21);
    assert.equal(pozo.length, 0);
    assert.equal(unused.length, 7);
  });

  it("4 jugadores: 7 cada uno, sin sobrantes", () => {
    const { hands, pozo, unused } = dealTiles(4, rngZero);
    assert.equal(hands.flat().length, 28);
    assert.equal(pozo.length, 0);
    assert.equal(unused.length, 0);
  });

  it("rechaza 5 jugadores", () => {
    assert.throws(() => dealTiles(5), EngineError);
  });
});

describe("salida inicial", () => {
  it("empieza el doble más alto", () => {
    const hands = [[T(5, 5), T(0, 1)], [T(6, 6), T(0, 2)]];
    assert.deepEqual(findStartingPlay(hands), { seat: 1, tile: T(6, 6) });
  });

  it("sin dobles: la ficha de mayor suma", () => {
    const hands = [[T(0, 1), T(2, 3)], [T(5, 6), T(1, 1)]]; // ojo: [1,1] es doble
    const handsNoDoubles = [[T(0, 1), T(2, 3)], [T(5, 6), T(0, 2)]];
    const r = findStartingPlay(handsNoDoubles);
    assert.equal(r.seat, 1);
    assert.deepEqual(r.tile, T(5, 6));
    void hands;
  });
});

describe("encaje y orientación", () => {
  it("connects y getValidSides", () => {
    assert.equal(connects(T(2, 5), 5), true);
    assert.equal(connects(T(2, 5), 3), false);
    assert.deepEqual(getValidSides(T(2, 5), 2, 6, false), ["left"]);
    assert.deepEqual(getValidSides(T(2, 5), 1, 5, false), ["right"]);
    assert.deepEqual(getValidSides(T(1, 1), 1, 1, false), ["left", "right"]);
    assert.deepEqual(getValidSides(T(1, 2), 3, 4, false), []);
    assert.deepEqual(getValidSides(T(1, 2), null, null, true), ["left", "right"]);
  });

  it("orientTileForSide coloca el valor de contacto", () => {
    // derecha: left debe igualar el extremo
    assert.deepEqual(orientTileForSide(T(5, 2), "right", 2), T(2, 5));
    assert.deepEqual(orientTileForSide(T(2, 5), "right", 2), T(2, 5));
    // izquierda: right debe igualar el extremo
    assert.deepEqual(orientTileForSide(T(2, 5), "left", 2), T(5, 2));
    assert.throws(() => orientTileForSide(T(1, 2), "right", 6), EngineError);
  });

  it("getPlayableTiles marca lados por ficha", () => {
    const res = getPlayableTiles([T(1, 2), T(3, 4)], 2, 6, false);
    assert.equal(res.length, 1);
    assert.deepEqual(res[0].sides, ["left"]);
  });
});

describe("playMove", () => {
  it("primera jugada coloca mesa y extremos", () => {
    const s = createRound(2, { hands: [[T(6, 6), T(0, 1)], [T(0, 2), T(1, 1)]], pozo: [], startingSeat: 0 });
    const n = playMove(s, 0, T(6, 6), "right");
    assert.equal(n.board.length, 1);
    assert.equal(n.leftEnd, 6);
    assert.equal(n.rightEnd, 6);
    assert.equal(n.turn, 1);
    assert.equal(n.hands[0].length, 1);
  });

  it("juega por izquierda y derecha orientando bien", () => {
    let s = createRound(2, { hands: [[T(6, 4), T(6, 5)], [T(4, 1), T(0, 0)]], pozo: [], startingSeat: 0 });
    s = playMove(s, 0, T(6, 4), "right"); // mesa [6|4], extremos 6-4
    assert.deepEqual([s.leftEnd, s.rightEnd], [6, 4]);
    s = playMove(s, 1, T(4, 1), "right"); // conecta 4 por la derecha -> [6|4][4|1]
    assert.deepEqual(s.board, [T(6, 4), T(4, 1)]);
    assert.equal(s.rightEnd, 1);
    // [6|5] solo encaja por la izquierda (6), no por la derecha (1)
    assert.throws(() => playMove(s, 0, T(6, 5), "right"), EngineError);
    s = playMove(s, 0, T(6, 5), "left"); // [5|6][6|4][4|1], extremo izq = 5
    assert.deepEqual(s.board, [T(5, 6), T(6, 4), T(4, 1)]);
    assert.equal(s.leftEnd, 5);
  });

  it("falla si no conecta", () => {
    let s = createRound(2, { hands: [[T(6, 4), T(0, 0)], [T(6, 2), T(4, 1)]], pozo: [], startingSeat: 0 });
    s = playMove(s, 0, T(6, 4), "right"); // extremos 6-4
    assert.throws(() => playMove(s, 1, T(6, 2), "right"), EngineError); // [6|2] no encaja en 4
    assert.throws(() => playMove(s, 1, T(0, 0), "left"), EngineError); // [0|0] no encaja en 6
  });

  it("valida turno, posesión y lado", () => {
    const s = createRound(2, { hands: [[T(1, 1)], [T(1, 2)]], pozo: [], startingSeat: 0 });
    assert.throws(() => playMove(s, 1, T(1, 2), "right"), /Turno/);
    assert.throws(() => playMove(s, 0, T(6, 6), "right"), /No tienes/);
    assert.throws(() => playMove(s, 0, T(1, 1), "middle"), /side/);
  });

  it("no muta el estado original", () => {
    const s = createRound(2, { hands: [[T(6, 6), T(0, 1)], [T(0, 2), T(1, 2)]], pozo: [], startingSeat: 0 });
    const snap = JSON.stringify(s);
    playMove(s, 0, T(6, 6), "left");
    assert.equal(JSON.stringify(s), snap);
  });

  it("gana por dominó y suma puntos rivales", () => {
    let s = createRound(2, { hands: [[T(1, 2)], [T(2, 3), T(4, 4)]], pozo: [], startingSeat: 0 });
    s = playMove(s, 0, T(1, 2), "left"); // mesa [1|2], mano vacía
    assert.equal(s.status, "finished");
    assert.equal(s.result.winnerSeat, 0);
    assert.equal(s.result.reason, "domino");
    assert.equal(s.result.pointsAwarded, 2 + 3 + 4 + 4); // 13
  });
});

describe("robar y pasar", () => {
  it("drawTile trae del pozo sin avanzar turno", () => {
    let s = createRound(2, {
      hands: [[T(0, 0)], [T(5, 5)]],
      pozo: [T(1, 1)],
      startingSeat: 0,
    });
    // Forzar mesa: jugamos primero algo compatible para el test
    s.board = [T(6, 6)];
    s.leftEnd = 6; s.rightEnd = 6; s.turn = 0;
    const { state: n, tile } = drawTile(s, 0);
    assert.deepEqual(tile, T(1, 1));
    assert.equal(n.hands[0].length, 2);
    assert.equal(n.pozo.length, 0);
    assert.equal(n.turn, 0); // sigue su turno
  });

  it("no permite robar si hay jugada", () => {
    let s = createRound(2, { hands: [[T(6, 1)], [T(0, 0)]], pozo: [T(2, 2)], startingSeat: 0 });
    s.board = [T(6, 6)]; s.leftEnd = 6; s.rightEnd = 6; s.turn = 0;
    assert.throws(() => drawTile(s, 0), /jugada válida/);
  });

  it("no permite pasar con pozo disponible", () => {
    let s = createRound(2, { hands: [[T(0, 0)], [T(0, 1)]], pozo: [T(2, 2)], startingSeat: 0 });
    s.board = [T(6, 6)]; s.leftEnd = 6; s.rightEnd = 6; s.turn = 0;
    assert.throws(() => passTurn(s, 0), /debes robar/);
  });

  it("tranque: pasan todos y gana el de menos puntos", () => {
    let s = createRound(2, {
      hands: [[T(0, 0)], [T(1, 2)]], // 0 vs 3 puntos, ninguno conecta con 6
      pozo: [],
      startingSeat: 0,
    });
    s.board = [T(6, 6)]; s.leftEnd = 6; s.rightEnd = 6; s.turn = 0;
    s = passTurn(s, 0);
    assert.equal(s.status, "playing");
    s = passTurn(s, 1);
    assert.equal(s.status, "finished");
    assert.equal(s.result.reason, "blocked");
    assert.equal(s.result.winnerSeat, 0);
    assert.equal(s.result.pointsAwarded, 3);
  });

  it("tranque con empate lo gana el asiento menor", () => {
    let s = createRound(2, { hands: [[T(1, 1)], [T(0, 2)]], pozo: [], startingSeat: 0 });
    s.board = [T(6, 6)]; s.leftEnd = 6; s.rightEnd = 6; s.turn = 0;
    s = passTurn(s, 0);
    s = passTurn(s, 1);
    assert.equal(s.result.winnerSeat, 0);
  });
});

describe("partida a X puntos", () => {
  it("createMatch y applyRoundResult acumulan y cierran", () => {
    let m = createMatch(2, 20);
    assert.deepEqual(m.scores, [0, 0]);
    m = applyRoundResult(m, { winnerSeat: 0, pointsAwarded: 13, reason: "domino", handPoints: [0, 13] });
    assert.deepEqual(m.scores, [13, 0]);
    assert.equal(m.finished, false);
    m = applyRoundResult(m, { winnerSeat: 0, pointsAwarded: 10, reason: "domino", handPoints: [0, 10] });
    assert.equal(m.finished, true);
    assert.equal(checkMatchWinner(m), 0);
  });

  it("rechaza target inválido", () => {
    assert.throws(() => createMatch(2, 0), EngineError);
  });
});

describe("autoMove (timeout servidor)", () => {
  it("juega si puede, roba si hay pozo, pasa si no", () => {
    let s = createRound(2, { hands: [[T(6, 1)], [T(0, 0)]], pozo: [], startingSeat: 0 });
    s.board = [T(6, 6)]; s.leftEnd = 6; s.rightEnd = 6; s.turn = 0;
    const r1 = autoMove(s);
    assert.equal(r1.action, "play");

    let s2 = createRound(2, { hands: [[T(0, 0)], [T(0, 1)]], pozo: [T(2, 2)], startingSeat: 0 });
    s2.board = [T(6, 6)]; s2.leftEnd = 6; s2.rightEnd = 6; s2.turn = 0;
    assert.equal(autoMove(s2).action, "draw");

    let s3 = createRound(2, { hands: [[T(0, 0)], [T(0, 1)]], pozo: [], startingSeat: 0 });
    s3.board = [T(6, 6)]; s3.leftEnd = 6; s3.rightEnd = 6; s3.turn = 0;
    assert.equal(autoMove(s3).action, "pass");
  });
});
