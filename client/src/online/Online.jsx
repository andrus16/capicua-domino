import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tile, TileBack } from "../components/Tile.jsx";
import { Board } from "../components/Board.jsx";
import { Logo } from "../components/Logo.jsx";
import { getSocket, closeSocket, emitAck } from "./socket.js";
import { sndPlace, sndWin, sndTurn, sndSelect, sndDraw, sndPass } from "../sound.js";

const TURN_SECS = 30;

function sameTile(a, b) {
  return (a.left === b.left && a.right === b.right) || (a.left === b.right && a.right === b.left);
}

/** Jugar en línea: lobby (salas + conectados + invitaciones) y mesa compartida. */
export default function Online({ dark, onExit }) {
  const [you, setYou] = useState(null);
  const [connected, setConnected] = useState(false);
  const [lobby, setLobby] = useState({ rooms: [], users: [] });
  const [room, setRoom] = useState(null);
  const [invites, setInvites] = useState([]);
  const [code, setCode] = useState("");
  const [cfg, setCfg] = useState({ maxPlayers: 2, targetScore: 100 });
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [thinking, setThinking] = useState(false);
  const [secs, setSecs] = useState(TURN_SECS);
  const timerRef = useRef(null);
  const noticeRef = useRef(null);
  const sockRef = useRef(null);

  const myTurn = room && room.roundStatus === "playing" && room.turn === room.mySeat;
  const iWon = room && (room.matchFinished
    ? room.matchWinner === room.mySeat
    : room.result?.winnerSeat === room.mySeat);

  const flash = (msg) => {
    setNotice(msg);
    clearTimeout(noticeRef.current);
    noticeRef.current = setTimeout(() => setNotice(""), 2600);
  };

  const confetti = useMemo(() => (
    Array.from({ length: 28 }, (_, i) => ({
      left: `${(i * 37) % 100}%`,
      delay: `${((i * 13) % 20) / 10}s`,
      dur: `${2 + ((i * 7) % 20) / 10}s`,
      bg: ["#fbbf24", "#34d399", "#60a5fa", "#f472b6", "#f8fafc"][i % 5],
      w: 6 + (i % 3) * 3,
    }))
  ), []);

  useEffect(() => {
    const s = getSocket();
    sockRef.current = s;
    const onBienvenida = ({ socketId, you }) => {
      setYou({ socketId, ...you });
      setConnected(true);
    };
    const onLobby = (snap) => setLobby(snap);
    const onState = (st) => {
      setRoom((prev) => {
        if (prev && st.code === prev.code && prev.board?.length !== st.board?.length) sndPlace();
        return st;
      });
      setSelected(null);
      setSecs(TURN_SECS);
    };
    const onInvite = (inv) => {
      setInvites((list) => [...list, inv]);
      sndTurn();
    };
    const onDisc = () => setConnected(false);
    s.on("bienvenida", onBienvenida);
    s.on("lobby:update", onLobby);
    s.on("room:state", onState);
    s.on("invite:received", onInvite);
    s.on("disconnect", onDisc);
    return () => {
      s.off("bienvenida", onBienvenida);
      s.off("lobby:update", onLobby);
      s.off("room:state", onState);
      s.off("invite:received", onInvite);
      s.off("disconnect", onDisc);
      clearInterval(timerRef.current);
    };
  }, []);

  // Auto-jugada al agotarse el tiempo (igual que vs máquina).
  useEffect(() => {
    clearInterval(timerRef.current);
    if (!room || room.status !== "playing" || !myTurn || room.roundStatus !== "playing") return;
    setSecs(TURN_SECS);
    sndTurn();
    timerRef.current = setInterval(() => {
      setSecs((t) => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          const p = room.playable?.[0];
          if (p) doPlay(p.tile, p.sides.includes("right") ? "right" : "left");
          else if (room.pozoCount > 0) doDraw();
          else doPass();
          return TURN_SECS;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.board?.length, room?.turn, room?.code]);

  const run = async (fn) => {
    setError(""); setThinking(true);
    try { await fn(); }
    catch (e) { setError(e.message); }
    finally { setThinking(false); }
  };

  const doCreate = () => run(() => emitAck(sockRef.current, "room:create", cfg));
  const doJoin = (c) => run(() => emitAck(sockRef.current, "room:join", { code: (c ?? code).trim().toUpperCase() }));
  const doLeave = () => run(async () => {
    await emitAck(sockRef.current, "room:leave");
    setRoom(null);
  });
  const doStart = () => run(() => emitAck(sockRef.current, "room:start"));
  const doNext = () => run(() => emitAck(sockRef.current, "room:next"));
  const doPlay = (tile, side) => {
    if (!myTurn) return;
    run(() => emitAck(sockRef.current, "game:play", { tile, side }));
  };
  const doDraw = () => {
    if (!myTurn) return;
    run(async () => {
      const r = await emitAck(sockRef.current, "game:draw");
      if (r.drew) flash(`🎣 Robaste [${r.drew.left}|${r.drew.right}]`);
      sndDraw();
    });
  };
  const doPass = () => {
    if (!myTurn) return;
    run(async () => {
      await emitAck(sockRef.current, "game:pass");
      flash("⏭ Pasaste");
      sndPass();
    });
  };
  const doInvite = (to, roomCode) => run(async () => {
    await emitAck(sockRef.current, "invite:send", { to, code: roomCode });
    flash("✉️ Invitación enviada");
  });
  const acceptInvite = (inv) => {
    setInvites((l) => l.filter((x) => x !== inv));
    doJoin(inv.code);
  };

  const exit = () => {
    if (room) emitAck(sockRef.current, "room:leave").catch(() => {});
    closeSocket();
    onExit();
  };

  const playableSides = (tile) => room?.playable?.find((p) => sameTile(p.tile, tile))?.sides ?? [];
  const myName = (seat) => room?.players?.[seat]?.username ?? `J${seat}`;
  // ---------- Lobby ----------
  if (!room) {
    const others = lobby.users.filter((u) => u.socketId !== you?.socketId);
    return (
      <div className="min-h-screen bg-emerald-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
        <header className="flex items-center gap-2 px-3 py-2 bg-emerald-800 text-white text-sm flex-wrap">
          <button onClick={exit} className="px-2 py-1 rounded bg-emerald-900 touch-manipulation">‹ Inicio</button>
          <span className="text-white"><Logo compact /></span>
          <span className="font-black">🌐 JUGAR EN LÍNEA</span>
          <span className="ml-auto" />
          <span className={`px-2 py-1 rounded text-xs font-bold ${connected ? "bg-emerald-500" : "bg-red-500"}`}>
            {connected ? `● ${you?.username ?? "…"}` : "○ conectando…"}
          </span>
        </header>

        <div className="w-full max-w-md mx-auto px-4 py-4 space-y-4 pb-10">
          {error && <p className="text-amber-200 bg-red-800/70 rounded px-2 py-1 text-sm">{error}</p>}
          {notice && <p className="text-center text-sm font-bold text-amber-700 dark:text-amber-300">{notice}</p>}

          {invites.length > 0 && (
            <div className="rounded-2xl border-2 border-sky-400 bg-sky-50 dark:bg-slate-900 p-4 space-y-2">
              <h2 className="font-black text-sky-700 dark:text-sky-300">✉️ INVITACIONES ({invites.length})</h2>
              {invites.map((inv, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="flex-1"><b>{inv.from?.username}</b> te invita a la sala <b>{inv.code}</b></span>
                  <button onClick={() => acceptInvite(inv)} className="touch-manipulation px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold">Aceptar</button>
                  <button onClick={() => setInvites((l) => l.filter((x) => x !== inv))} className="touch-manipulation px-2 py-1.5 rounded-lg border dark:border-slate-700">✕</button>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-xl border-t-4 border-emerald-500 space-y-3">
            <h2 className="font-black text-emerald-700 dark:text-emerald-300">➕ CREAR SALA</h2>
            <div className="flex gap-2">
              <label className="flex-1 text-sm">Jugadores
                <select value={cfg.maxPlayers} onChange={(e) => setCfg({ ...cfg, maxPlayers: Number(e.target.value) })}
                  className="mt-1 w-full rounded border p-2 text-base md:text-sm dark:bg-slate-800 dark:border-slate-700">
                  <option value={2}>2</option><option value={3}>3</option><option value={4}>4</option>
                </select>
              </label>
              <label className="flex-1 text-sm">Meta
                <input type="number" min={10} max={500} step={10} value={cfg.targetScore}
                  onChange={(e) => setCfg({ ...cfg, targetScore: Number(e.target.value) || 100 })}
                  className="mt-1 w-full rounded border p-2 text-base md:text-sm dark:bg-slate-800 dark:border-slate-700" />
              </label>
            </div>
            <button onClick={doCreate} disabled={thinking || !connected}
              className="touch-manipulation active:scale-95 transition w-full py-3 rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-50">
              Crear y esperar rivales
            </button>
            <div className="flex gap-2">
              <input placeholder="Código, ej. KX7Q2M" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="flex-1 rounded border p-2 text-base md:text-sm uppercase dark:bg-slate-800 dark:border-slate-700" />
              <button onClick={() => doJoin()} disabled={thinking || !connected}
                className="touch-manipulation px-4 rounded-xl bg-amber-400 text-black font-bold disabled:opacity-50">Unirse</button>
            </div>
          </div>

          <div className="rounded-2xl border-2 border-sky-400 overflow-hidden">
            <div className="px-4 py-2 bg-sky-500 text-white font-black text-sm">🏠 SALAS ABIERTAS ({lobby.rooms.length})</div>
            <div className="p-3 bg-sky-50 dark:bg-slate-800 space-y-1.5 text-sm">
              {lobby.rooms.length === 0 && <p className="opacity-60 text-xs">No hay salas — crea una o comparte tu código.</p>}
              {lobby.rooms.map((r) => (
                <div key={r.code} className="flex items-center gap-2 bg-white dark:bg-slate-900 border dark:border-slate-700 rounded-lg px-2 py-1.5">
                  <span className="font-black tracking-widest">{r.code}</span>
                  <span className="flex-1 opacity-80 truncate">{r.players.join(", ")}</span>
                  <span className="text-xs opacity-70">{r.count}/{r.maxPlayers}</span>
                  <button onClick={() => doJoin(r.code)} disabled={thinking}
                    className="touch-manipulation px-3 py-1 rounded-lg bg-emerald-600 text-white font-bold text-xs">Entrar</button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border-2 border-violet-400 overflow-hidden">
            <div className="px-4 py-2 bg-violet-500 text-white font-black text-sm">👥 CONECTADOS ({others.length})</div>
            <div className="p-3 bg-violet-50 dark:bg-slate-800 space-y-1.5 text-sm">
              {others.length === 0 && <p className="opacity-60 text-xs">Nadie más por aquí todavía.</p>}
              {others.map((u) => (
                <div key={u.socketId} className="flex items-center gap-2 bg-white dark:bg-slate-900 border dark:border-slate-700 rounded-lg px-2 py-1.5">
                  <span className={`w-2 h-2 rounded-full ${u.inRoom ? "bg-amber-400" : "bg-emerald-500"}`} />
                  <span className="flex-1 font-bold truncate">{u.username}{u.guest ? " (invitado)" : ""}</span>
                  <span className="text-xs opacity-60">{u.inRoom ? "en sala" : "libre"}</span>
                </div>
              ))}
              <p className="text-xs opacity-60">💡 Para invitar: crea una sala primero y comparte el código por fuera (WhatsApp, etc.).</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Sala / mesa ----------
  const inLobby = room.status === "lobby";
  const amHost = Boolean(you && room.hostUserId === you.userId);

  return (
    <div className="min-h-screen bg-emerald-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      <header className="flex items-center gap-2 px-3 py-2 bg-emerald-800 text-white text-sm flex-wrap">
        <button onClick={doLeave} className="px-2 py-1 rounded bg-emerald-900 touch-manipulation">‹ Salas</button>
        <span className="font-black tracking-widest bg-black/30 px-2 py-0.5 rounded">🔑 {room.code}</span>
        <span className="ml-auto" />
        <button onClick={exit} className="px-2 py-1 rounded bg-emerald-900 touch-manipulation">✕ Salir</button>
      </header>

      {error && <p className="mx-3 mt-2 text-amber-200 bg-red-800/70 rounded px-2 py-1 text-sm">{error}</p>}

      {inLobby ? (
        <div className="w-full max-w-md mx-auto px-4 py-6 space-y-3">
          <div className="rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-xl border-t-4 border-emerald-500">
            <h2 className="font-black">Sala {room.code} · {room.players.length}/{room.maxPlayers}</h2>
            <p className="text-xs opacity-70 mt-1">Comparte el código con tus amigos para que se unan. Meta: {room.targetScore} pts.</p>
            <ul className="mt-3 space-y-1.5">
              {room.players.map((p) => (
                <li key={p.seat} className="flex items-center gap-2 text-sm bg-emerald-50 dark:bg-slate-800 rounded-lg px-2 py-1.5">
                  <span className={`w-2 h-2 rounded-full ${p.connected ? "bg-emerald-500" : "bg-red-500"}`} />
                  <span className="font-bold">{p.username}{p.seat === room.mySeat ? " (tú)" : ""}</span>
                  {room.players[0]?.seat === p.seat ? <span className="text-xs opacity-60" title="Anfitrión">👑</span> : null}
                </li>
              ))}
            </ul>
            {amHost ? (
              <button onClick={doStart} disabled={thinking || room.players.length < 2}
                className="touch-manipulation active:scale-95 transition mt-4 w-full py-3 rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-50">
                {room.players.length < 2 ? "Esperando rivales…" : "▶ Empezar partida"}
              </button>
            ) : (
              <p className="mt-4 text-center text-sm font-bold bg-amber-100 dark:bg-slate-800 rounded-xl py-3">
                Esperando a que el anfitrión empiece…
              </p>
            )}
          </div>

          {lobby.users.filter((u) => u.socketId !== you?.socketId && !u.inRoom).length > 0 && (
            <div className="rounded-2xl border-2 border-violet-400 overflow-hidden">
              <div className="px-4 py-2 bg-violet-500 text-white font-black text-sm">✉️ INVITAR CONECTADOS</div>
              <div className="p-3 bg-violet-50 dark:bg-slate-800 space-y-1.5 text-sm">
                {lobby.users.filter((u) => u.socketId !== you?.socketId && !u.inRoom).map((u) => (
                  <div key={u.socketId} className="flex items-center gap-2">
                    <span className="flex-1 font-bold truncate">{u.username}</span>
                    <button onClick={() => doInvite(u.socketId, room.code)}
                      className="touch-manipulation px-3 py-1 rounded-lg bg-violet-600 text-white font-bold text-xs">Invitar</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex gap-2 px-3 py-2 text-xs sm:text-sm flex-wrap">
            {room.scores.map((pts, i) => (
              <span key={i} className={`px-2 py-1 rounded font-semibold ${room.turn === i && room.roundStatus === "playing" ? "bg-amber-300 text-black turn-chip" : "bg-white dark:bg-slate-900 border dark:border-slate-700"}`}>
                {i === room.mySeat ? "🧑 Tú" : `👤 ${myName(i)}`} · {pts} pts · {room.counts[i]} fichas
                {!room.players[i]?.connected ? " (desc.)" : ""}{room.turn === i && room.roundStatus === "playing" ? " ●" : ""}
              </span>
            ))}
            <span className="px-2 py-1 rounded bg-white dark:bg-slate-900 border dark:border-slate-700">Pozo: {room.pozoCount}</span>
            {myTurn && <span className={`px-2 py-1 rounded font-bold ${secs <= 10 ? "bg-red-500 text-white" : "bg-sky-200 text-sky-900"}`}>⏱ {secs}s</span>}
            {thinking && <span className="px-2 py-1 rounded bg-slate-200 dark:bg-slate-800 animate-pulse">…</span>}
          </div>

          <main className={`flex-1 mx-3 my-2 rounded-xl p-3 min-h-[30vh] relative overflow-hidden ${dark ? "felt-dark" : "felt"}`}>
            <div className="flex items-center justify-between text-white text-sm mb-2">
              <span className="font-bold">◀ {room.leftEnd ?? "—"}</span>
              <span className="opacity-80">Ronda {room.roundNumber} · {room.board?.length ?? 0} en mesa</span>
              <span className="font-bold">{room.rightEnd ?? "—"} ▶</span>
            </div>
            <Board board={room?.board ?? []} lastMove={room?.lastMove} dark={dark} />
            {notice && <p className="mt-2 text-center text-sm font-bold text-amber-200 bg-black/40 rounded px-2 py-1 tile-pop">{notice}</p>}
          </main>

          {myTurn && (room.playable?.length ?? 0) === 0 && (
            <div className="px-3 pb-1 flex flex-col items-center gap-2">
              <p className="text-sm font-semibold opacity-80">😅 Sin jugada posible</p>
              {room.pozoCount > 0 ? (
                <button onClick={doDraw} disabled={thinking}
                  className="draw-pulse touch-manipulation active:scale-95 transition px-6 py-2.5 rounded-xl bg-amber-400 text-black font-black text-base disabled:opacity-50">
                  🎣 Robar del pozo ({room.pozoCount})
                </button>
              ) : (
                <button onClick={doPass} disabled={thinking}
                  className="touch-manipulation active:scale-95 transition px-6 py-2.5 rounded-xl bg-sky-500 text-white font-black text-base disabled:opacity-50">
                  ⏭ Pasar turno
                </button>
              )}
            </div>
          )}

          {selected && myTurn && (
            <div className="px-3 pb-1 flex gap-2 justify-center flex-wrap">
              {["left", "right"].map((side) => {
                const ok = playableSides(selected).includes(side);
                return (
                  <button key={side} disabled={!ok} onClick={() => doPlay(selected, side)}
                    className={`touch-manipulation active:scale-95 transition px-4 py-2.5 rounded-xl font-bold ${ok ? "bg-amber-400 text-black" : "bg-slate-300 dark:bg-slate-800 opacity-40"}`}>
                    {side === "left" ? `◀ Por ${room.leftEnd}` : `Por ${room.rightEnd} ▶`}
                  </button>
                );
              })}
              <button onClick={() => setSelected(null)} className="touch-manipulation px-4 py-2.5 rounded-xl border dark:border-slate-700">Cancelar</button>
            </div>
          )}

          <footer className="px-3 pb-6">
            <div className="text-xs mb-1 opacity-80">Tu mano ({myName(room.mySeat)}):</div>
            <div className="flex flex-wrap gap-2 justify-center">
              {(room.myHand ?? []).map((t, i) => {
                const sides = playableSides(t);
                return (
                  <Tile key={i} tile={t} dir="v" dark={dark}
                    playable={myTurn && sides.length > 0}
                    selected={selected && sameTile(selected, t)}
                    onClick={() => { if (myTurn && sides.length > 0) { setSelected(t); sndSelect(); } }} />
                );
              })}
            </div>
          </footer>

          {room.roundStatus === "finished" && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4">
              <div className="modal-pop bg-white dark:bg-slate-900 rounded-2xl p-6 max-w-sm w-full text-center relative overflow-hidden">
                {iWon && confetti.map((c, i) => (
                  <span key={i} className="confetti" style={{
                    left: c.left, animationDelay: c.delay, animationDuration: c.dur,
                    background: c.bg, width: c.w, height: c.w * 0.6,
                  }} />
                ))}
                <h2 className="text-2xl font-black">
                  {room.matchFinished
                    ? (iWon ? "🏆 ¡Ganaste la partida!" : `👤 ${myName(room.matchWinner)} gana la partida`)
                    : (iWon ? "🎉 ¡Ganaste la ronda!" : `Ronda para ${myName(room.result?.winnerSeat)}`)}
                </h2>
                <p className="mt-2 text-sm opacity-80">
                  {room.result?.reason === "blocked" ? "Cierre por tranque. " : "Dominó. "}
                  +{room.result?.pointsAwarded} pts
                </p>
                <p className="mt-1 text-sm font-semibold">Marcador: {(room.scores ?? []).join(" – ")} (meta {room.targetScore})</p>
                <div className="mt-4 flex gap-2">
                  {!room.matchFinished && (
                    <button onClick={doNext} disabled={thinking}
                      className="touch-manipulation flex-1 py-2 rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-50">
                      Siguiente ronda
                    </button>
                  )}
                  <button onClick={doLeave} className="touch-manipulation flex-1 py-2 rounded-xl border dark:border-slate-700 font-bold">A la sala</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
