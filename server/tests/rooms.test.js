import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createStore, createRoom, joinRoom, leaveRoom, startGame,
  playTile, drawTileRoom, passTurnRoom, nextRound,
  publicStateFor, lobbyRooms, seatOf, autoPlay, gameResultData,
} from "../src/game/rooms.js";

const A = { userId: 1, username: "alba", guest: false };
const B = { userId: 2, username: "bruno", guest: false };
const C = { userId: 3, username: "carla", guest: false };

function twoPlayerRoom() {
  const s = createStore();
  const room = createRoom(s, { socketId: "sA", user: A, maxPlayers: 2, targetScore: 50 });
  joinRoom(s, room.code, { socketId: "sB", user: B });
  startGame(s, room.code, "sA");
  return { s, room };
}

describe("rooms lobby", () => {
  it("crea sala con código y valida cupo/meta", () => {
    const s = createStore();
    const r = createRoom(s, { socketId: "s1", user: A, maxPlayers: 4 });
    assert.equal(r.code.length, 6);
    assert.throws(() => createRoom(s, { socketId: "s1", user: A }), /Ya estás/);
    assert.throws(() => createRoom(createStore(), { socketId: "x", user: B, maxPlayers: 5 }), /2-4/);
  });

  it("join rechaza sala llena e inexistente; lobby lista abiertas", () => {
    const s = createStore();
    const r = createRoom(s, { socketId: "sA", user: A, maxPlayers: 2 });
    joinRoom(s, r.code, { socketId: "sB", user: B });
    assert.throws(() => joinRoom(s, r.code, { socketId: "sC", user: C }), /llena/);
    assert.throws(() => joinRoom(s, "ZZZZZZ", { socketId: "sC", user: C }), /no encontrada/);
    assert.equal(lobbyRooms(s).length, 1);
    assert.equal(lobbyRooms(s)[0].count, 2);
  });

  it("reconexión por userId reatacha el asiento", () => {
    const s = createStore();
    const r = createRoom(s, { socketId: "sA", user: A, maxPlayers: 3 });
    const { seat, reconnected } = joinRoom(s, r.code, { socketId: "sA2", user: A });
    assert.equal(seat, 0);
    assert.equal(reconnected, true);
    assert.equal(r.players[0].socketId, "sA2");
  });

  it("leave en lobby saca y disuelve si queda vacía; host rota", () => {
    const s = createStore();
    const r = createRoom(s, { socketId: "sA", user: A, maxPlayers: 3 });
    joinRoom(s, r.code, { socketId: "sB", user: B });
    leaveRoom(s, "sA");
    assert.equal(r.players.length, 1);
    assert.equal(r.hostUserId, B.userId);
    const out = leaveRoom(s, "sB");
    assert.equal(out.dissolved, true);
    assert.equal(s.rooms.size, 0);
  });
});

describe("rooms partida", () => {
  it("start exige host y mínimo 2; estado público oculta manos ajenas", () => {
    const s = createStore();
    const r = createRoom(s, { socketId: "sA", user: A });
    assert.throws(() => startGame(s, r.code, "sA"), /al menos 2/);
    joinRoom(s, r.code, { socketId: "sB", user: B });
    assert.throws(() => startGame(s, r.code, "sB"), /anfitrión/);
    startGame(s, r.code, "sA");
    const pub = publicStateFor(r, 0);
    assert.equal(pub.myHand.length, 7);
    assert.ok(!("hands" in pub));
    assert.equal(typeof pub.canDraw, "boolean");
  });

  it("flujo completo: jugar hasta cerrar ronda y persistir datos", () => {
    const { s, room } = twoPlayerRoom();
    let guard = 0;
    while (room.round.status === "playing" && guard++ < 200) {
      const seat = room.round.turn;
      const sock = room.players[seat].socketId;
      const pub = publicStateFor(room, seat);
      if (pub.playable.length > 0) {
        const p = pub.playable[0];
        playTile(s, room.code, sock, p.tile, p.sides.includes("right") ? "right" : "left");
      } else if (pub.pozoCount > 0) {
        drawTileRoom(s, room.code, sock);
      } else {
        passTurnRoom(s, room.code, sock);
      }
    }
    assert.equal(room.round.status, "finished");
    assert.ok(room.history.length >= 1);
    assert.ok(room.match.roundNumber >= 1);
    const data = gameResultData(room);
    assert.equal(data.mode, "online");
    assert.ok(Array.isArray(data.rounds));
    if (!room.match.finished) {
      nextRound(s, room.code, "sA");
      assert.equal(room.round.status, "playing");
    }
  });

  it("jugar fuera de turno o ficha ajena falla", () => {
    const { s, room } = twoPlayerRoom();
    const turn = room.round.turn;
    const other = room.players[1 - turn].socketId;
    const pub = publicStateFor(room, turn);
    if (pub.playable.length > 0) {
      const p = pub.playable[0];
      assert.throws(() => playTile(s, room.code, other, p.tile, "right"), /Turno/);
    }
  });

  it("autoPlay solo mueve a desconectados", () => {
    const { s, room } = twoPlayerRoom();
    assert.equal(autoPlay(s, room.code), null); // todos conectados
    const seat = room.round.turn;
    room.players[seat].connected = false;
    const res = autoPlay(s, room.code);
    assert.ok(res && res.seat === seat);
  });

  it("seatOf ubica sockets", () => {
    const { room } = twoPlayerRoom();
    assert.equal(seatOf(room, "sA"), 0);
    assert.equal(seatOf(room, "sB"), 1);
    assert.equal(seatOf(room, "nadie"), -1);
  });
});
