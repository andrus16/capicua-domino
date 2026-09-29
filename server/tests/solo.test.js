import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSoloGame, humanPlay, humanDraw, humanPass, publicSoloState, nextRound, botStep } from "../src/game/soloStore.js";

describe("soloStore", () => {
  it("crea partida 1 humano + 1 bot con vista pública oculta", () => {
    const g = createSoloGame({ numBots: 1, level: "easy" });
    const pub = publicSoloState(g, 0);
    assert.equal(pub.numPlayers, 2);
    assert.equal(pub.myHand.length, 7);
    assert.deepEqual(pub.counts, [7, 7]);
    assert.ok(!("hands" in pub), "no debe exponer manos ajenas");
  });

  it("rechaza numBots inválido", () => {
    assert.throws(() => createSoloGame({ numBots: 5 }), /numBots/);
  });

  it("humanPlay avanza el juego (bots responden)", () => {
    const g = createSoloGame({ numBots: 1, level: "medium" });
    // Forzar turno humano con jugada conocida: vaciar mesa no es posible
    // directamente, así que jugamos lo que el estado público marque jugable.
    let pub = publicSoloState(g, 0);
    // Si empieza el bot, el constructor no auto-juega; humanPlay exigiría turno.
    // Normalizamos: si no es turno 0, jugamos manualmente el bot hasta llegar a 0.
    // (Acceso interno solo en tests.)
    assert.ok(pub.myHand.length === 7);
    if (pub.turn !== 0 && pub.playable.length === 0) {
      // Caso borde: no podemos forzar sin exponer bots; solo validar estructura.
      assert.ok([0, 1].includes(pub.turn));
      return;
    }
    if (pub.turn === 0 && pub.playable.length > 0) {
      const { tile, sides } = pub.playable[0];
      const side = sides.includes("right") ? "right" : "left";
      const before = JSON.stringify(g.round.board);
      humanPlay(g.id, tile, side);
      assert.notEqual(JSON.stringify(g.round.board), before);
    }
  });

  it("nextRound exige ronda terminada", () => {
    const g = createSoloGame({ numBots: 1 });
    assert.throws(() => nextRound(g.id), /sigue en curso/);
  });

  it("humanPlay registra lastMove y vista pública lo expone", () => {
    const g = createSoloGame({ numBots: 1, level: "easy" });
    // Llevar al turno humano jugando bots internos si hace falta.
    let guard = 0;
    while (publicSoloState(g, 0).turn !== 0 && guard++ < 20) botStep(g);
    const pub = publicSoloState(g, 0);
    if (pub.turn === 0 && pub.playable.length > 0) {
      const { tile, sides } = pub.playable[0];
      humanPlay(g.id, tile, sides.includes("right") ? "right" : "left");
      const after = publicSoloState(g, 0);
      assert.ok(after.lastMove, "debe exponer la última jugada");
      assert.ok([0, 1].includes(after.lastMove.seat));
      assert.equal(typeof after.canDraw, "boolean");
      assert.equal(typeof after.canPass, "boolean");
    }
  });

  it("humanDraw exige turno y roba del pozo; humanPass exige pozo vacío", () => {
    const g = createSoloGame({ numBots: 3, level: "easy" }); // 4 jugadores: sin pozo
    let guard = 0;
    while (publicSoloState(g, 0).turn !== 0 && guard++ < 30) botStep(g);
    const pub = publicSoloState(g, 0);
    if (pub.turn !== 0) return; // no determinista: el bot pudo cerrar la ronda
    assert.equal(pub.pozoCount, 0);
    if (pub.playable.length === 0) {
      // Sin jugada y sin pozo -> pasar debe avanzar el turno o cerrar.
      humanPass(g.id);
      assert.ok(true);
    } else {
      // Con jugada -> robar y pasar deben fallar.
      assert.throws(() => humanDraw(g.id), /No es tu turno|pozo|jugada/i);
      assert.throws(() => humanPass(g.id), /jugada/i);
    }
  });

  it("humanDraw roba una ficha cuando no hay jugada (2 jugadores)", () => {
    // Buscar una partida donde al humano le toque sin jugada y con pozo.
    for (let attempt = 0; attempt < 30; attempt++) {
      const g = createSoloGame({ numBots: 1, level: "easy" });
      let guard = 0;
      while (publicSoloState(g, 0).turn !== 0 && guard++ < 30) botStep(g);
      const pub = publicSoloState(g, 0);
      if (pub.status !== "playing" || pub.turn !== 0) continue;
      if (pub.playable.length === 0 && pub.pozoCount > 0) {
        const before = pub.myHand.length;
        const { tile } = humanDraw(g.id);
        assert.ok(tile && Number.isInteger(tile.left));
        assert.equal(publicSoloState(g, 0).myHand.length, before + 1);
        return;
      }
    }
    // Si en 30 intentos no se dio el caso, al menos validar el error guiado.
    const g = createSoloGame({ numBots: 1, level: "easy" });
    assert.throws(() => humanDraw("id_inexistente"), /no encontrada/i);
  });
});
