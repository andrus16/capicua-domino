import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api.js";
import { Tile, TileBack } from "./components/Tile.jsx";
import { Board } from "./components/Board.jsx";
import { AccountCard, RankingCard } from "./components/AuthPanel.jsx";
import { AnimatedBackdrop } from "./components/Backdrop.jsx";
import { Logo } from "./components/Logo.jsx";
import Online from "./online/Online.jsx";
import { sndPlace, sndWin, sndTurn, sndSelect, sndDraw, sndPass, startMusic, isMuted, toggleMute } from "./sound.js";

const TURN_SECS = 30;

function useDark() {
  const [dark, setDark] = useState(() => localStorage.getItem("domino_theme") === "dark");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("domino_theme", dark ? "dark" : "light");
  }, [dark]);
  return [dark, () => setDark((d) => !d)];
}

function sameTile(a, b) {
  return (a.left === b.left && a.right === b.right) || (a.left === b.right && a.right === b.left);
}

export default function App() {
  const [dark, toggleDark] = useDark();
  const [muted, setMuted] = useState(isMuted());
  const [screen, setScreen] = useState("inicio"); // inicio | mesa | online
  const [cfg, setCfg] = useState({ numBots: 1, level: "medium", targetScore: 100 });
  const [game, setGame] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [secs, setSecs] = useState(TURN_SECS);
  const [notice, setNotice] = useState(""); // toast temporal (robos, pases…)
  const [accountUser, setAccountUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("domino_user") ?? "null"); } catch { return null; }
  });
  const timerRef = useRef(null);
  const noticeRef = useRef(null);

  const myTurn = game && game.status === "playing" && game.turn === 0;
  const iWon = game && (game.matchFinished ? game.matchWinner === 0 : game.result?.winnerSeat === 0);

  const flash = (msg) => {
    setNotice(msg);
    clearTimeout(noticeRef.current);
    noticeRef.current = setTimeout(() => setNotice(""), 2600);
  };

  const onMuteToggle = () => {
    const m = toggleMute();
    setMuted(m);
    if (!m && screen === "mesa") startMusic(); // reanudar melodía al activar sonido
  };

  // Confeti determinista para el modal de victoria (sin parpadeos por re-render).
  const confetti = useMemo(() => (
    Array.from({ length: 28 }, (_, i) => ({
      left: `${(i * 37) % 100}%`,
      delay: `${((i * 13) % 20) / 10}s`,
      dur: `${2 + ((i * 7) % 20) / 10}s`,
      bg: ["#fbbf24", "#34d399", "#60a5fa", "#f472b6", "#f8fafc"][i % 5],
      w: 6 + (i % 3) * 3,
    }))
  ), []);

  const start = async () => {
    setLoading(true); setError("");
    try {
      const g = await api.startSolo(cfg);
      setGame(g); setSelected(null); setScreen("mesa");
      setSecs(TURN_SECS);
      startMusic(); // gesto del usuario: ya se puede reproducir audio
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const refresh = useCallback(async (id) => {
    try { setGame(await api.getSolo(id)); } catch (e) { setError(e.message); }
  }, []);

  // Temporizador de turno: al agotarse, juega la primera ficha válida;
  // si no hay jugada, roba del pozo o pasa automáticamente.
  useEffect(() => {
    clearInterval(timerRef.current);
    if (!game || screen !== "mesa" || !myTurn || game.status !== "playing") return;
    setSecs(TURN_SECS);
    sndTurn();
    timerRef.current = setInterval(() => {
      setSecs((s) => {
        if (s <= 1) {
          clearInterval(timerRef.current);
          const p = game.playable?.[0];
          if (p) doPlay(p.tile, p.sides.includes("right") ? "right" : "left");
          else if (game.pozoCount > 0) doDraw();
          else doPass();
          return TURN_SECS;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.board?.length, game?.turn, screen]);

  const doPlay = async (tile, side) => {
    if (!game || !myTurn) return;
    setError(""); setThinking(true);
    try {
      const g = await api.playSolo(game.id, tile, side);
      // Simula el "pensamiento" de los bots 1-2s antes de revelar la mesa.
      await new Promise((r) => setTimeout(r, 900));
      setGame(g); setSelected(null); setSecs(TURN_SECS);
      sndPlace();
      if (g.status === "finished") sndWin();
    } catch (e) { setError(e.message); }
    finally { setThinking(false); }
  };

  const doNextRound = async () => {
    setLoading(true); setError("");
    try {
      const g = await api.nextRound(game.id);
      setGame(g); setSelected(null); setSecs(TURN_SECS);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const doDraw = async () => {
    if (!game || !myTurn) return;
    setError(""); setThinking(true);
    try {
      const g = await api.drawSolo(game.id);
      setGame(g); setSecs(TURN_SECS);
      if (g.drew) flash(`🎣 Robaste [${g.drew.left}|${g.drew.right}] — ${g.playable?.length ? "¡esa te sirve!" : "sigue sin jugada"}`);
      else flash("🎣 Robaste una ficha");
      sndDraw();
    } catch (e) { setError(e.message); }
    finally { setThinking(false); }
  };

  const doPass = async () => {
    if (!game || !myTurn) return;
    setError(""); setThinking(true);
    try {
      await new Promise((r) => setTimeout(r, 500));
      const g = await api.passSolo(game.id);
      setGame(g); setSecs(TURN_SECS);
      flash("⏭ Pasaste — turno de los bots");
      sndPass();
      if (g.status === "finished") sndWin();
    } catch (e) { setError(e.message); }
    finally { setThinking(false); }
  };

  const playableSides = (tile) => game?.playable?.find((p) => sameTile(p.tile, tile))?.sides ?? [];

  if (screen === "online") {
    return <Online dark={dark} onExit={() => setScreen("inicio")} />;
  }

  if (screen === "inicio") {
    return (
      <div className="min-h-screen bg-emerald-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 relative overflow-hidden">
        <AnimatedBackdrop dark={dark} />
        <div className="max-w-md mx-auto px-4 py-6 relative z-10">
          {/* Barra superior: logo a la izquierda, tema/sonido a la derecha */}
          <div className="flex items-center justify-between gap-2">
            <Logo />
            <div className="flex items-center gap-1.5">
              <button onClick={toggleDark} title="Modo claro/oscuro"
                className="px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 backdrop-blur text-sm">
                {dark ? "☀️" : "🌙"}
              </button>
              <button onClick={onMuteToggle} title="Sonido"
                className="px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 backdrop-blur text-sm">
                {muted ? "🔇" : "🔊"}
              </button>
            </div>
          </div>

          <p className="text-center mt-3 opacity-80">Doble-seis · 2-4 jugadores · Contra la máquina</p>
          <p className="text-center mt-1 text-xs opacity-70">Sin jugada: <b>roba del pozo</b> (2 jugadores) o <b>pasa</b> (pozo vacío).</p>

          {/* Cuenta siempre visible */}
          <div className="mt-4">
            <AccountCard onUser={setAccountUser} />
          </div>

          {/* Tarjeta de modo de juego */}
          <div className="mt-5 space-y-4 bg-white dark:bg-slate-900 rounded-2xl p-5 shadow-xl border-t-4 border-emerald-500">
            <h2 className="font-black text-emerald-700 dark:text-emerald-300 tracking-wide">🎮 MODO DE JUEGO</h2>
            <label className="block">
              <span className="text-sm font-semibold">Rivales (bots)</span>
              <select value={cfg.numBots} onChange={(e) => setCfg({ ...cfg, numBots: Number(e.target.value) })}
                className="mt-1 w-full rounded border p-2 text-base md:text-sm dark:bg-slate-800 dark:border-slate-700">
                <option value={1}>1 bot (2 jugadores + pozo)</option>
                <option value={2}>2 bots (3 jugadores)</option>
                <option value={3}>3 bots (4 jugadores)</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Dificultad</span>
              <select value={cfg.level} onChange={(e) => setCfg({ ...cfg, level: e.target.value })}
                className="mt-1 w-full rounded border p-2 text-base md:text-sm dark:bg-slate-800 dark:border-slate-700">
                <option value="easy">Fácil — juega al azar</option>
                <option value="medium">Media — suelta dobles y altas</option>
                <option value="hard">Difícil — cuenta fichas y bloquea</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Puntos para ganar la partida</span>
              <input type="number" min={10} max={500} step={10} value={cfg.targetScore}
                onChange={(e) => setCfg({ ...cfg, targetScore: Number(e.target.value) || 100 })}
                className="mt-1 w-full rounded border p-2 text-base md:text-sm dark:bg-slate-800 dark:border-slate-700" />
            </label>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button onClick={start} disabled={loading}
              className="touch-manipulation active:scale-95 transition w-full py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-50">
              {loading ? "Repartiendo…" : "▶ Jugar"}
            </button>
            <button onClick={() => { startMusic(); setScreen("online"); }}
              className="touch-manipulation active:scale-95 transition w-full py-3 rounded-xl bg-sky-600 text-white font-bold hover:bg-sky-500">
              🌐 Jugar en línea
            </button>
            <p className="text-xs opacity-70">Servidor: {import.meta.env.VITE_API_URL ?? "(proxy /api)"} · Empieza el doble más alto · Sin jugada: roba (2j) o pasa (3-4j).</p>
          </div>

          {/* Ranking siempre visible debajo */}
          <div className="mt-4 pb-8">
            <RankingCard highlight={accountUser} />
          </div>
        </div>
      </div>
    );
  }

  // ---- Mesa ----
  const rivals = game ? Array.from({ length: game.numPlayers - 1 }, (_, i) => i + 1) : [];
  return (
    <div className="min-h-screen bg-emerald-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      <header className="flex items-center gap-2 px-3 py-2 bg-emerald-800 text-white text-sm flex-wrap">
        <button onClick={() => setScreen("inicio")} className="px-2 py-1 rounded bg-emerald-900 touch-manipulation">‹ Inicio</button>
        <span className="text-white"><Logo compact /></span>
        <span className="font-bold">Ronda {game?.roundNumber}</span>
        <span className="opacity-80">· Meta {game?.targetScore}</span>
        <span className="ml-auto" />
        <button onClick={toggleDark} className="px-2 py-1 rounded bg-emerald-800 touch-manipulation">{dark ? "☀️" : "🌙"}</button>
        <button onClick={onMuteToggle} className="px-2 py-1 rounded bg-emerald-800 touch-manipulation">{muted ? "🔇" : "🔊"}</button>
        <button onClick={() => refresh(game.id)} className="px-2 py-1 rounded bg-emerald-800 touch-manipulation">↻</button>
      </header>

      {/* Marcador */}
      <div className="flex gap-2 px-3 py-2 text-xs sm:text-sm flex-wrap">
        {(game?.scores ?? []).map((pts, i) => (
          <span key={i} className={`px-2 py-1 rounded font-semibold ${game.turn === i && game.status === "playing" ? "bg-amber-300 text-black turn-chip" : "bg-white dark:bg-slate-900 border dark:border-slate-700"}`}>
            {i === 0 ? "🧑 Tú" : `🤖 Bot${i}`} · {pts} pts · {game.counts[i]} fichas
            {game.turn === i && game.status === "playing" ? " ●" : ""}
          </span>
        ))}
        <span className="px-2 py-1 rounded bg-white dark:bg-slate-900 border dark:border-slate-700">Pozo: {game?.pozoCount}</span>
        {myTurn && <span className={`px-2 py-1 rounded font-bold ${secs <= 10 ? "bg-red-500 text-white" : "bg-sky-200 text-sky-900"}`}>⏱ {secs}s</span>}
        {thinking && <span className="px-2 py-1 rounded bg-slate-200 dark:bg-slate-800 animate-pulse">🤖 bots pensando<span className="think-dot">.</span><span className="think-dot">.</span><span className="think-dot">.</span></span>}
      </div>

      {/* Rivales */}
      <div className="flex justify-center gap-4 sm:gap-6 px-3 py-1 flex-wrap">
        {rivals.map((seat) => (
          <div key={seat} className="text-center">
            <div className="text-xs mb-1 opacity-80">Bot{seat} {game.turn === seat ? "● turno" : ""}</div>
            <div className="flex gap-0.5 justify-center">
              {Array.from({ length: game.counts[seat] }, (_, k) => <TileBack key={k} dark={dark} />)}
            </div>
          </div>
        ))}
      </div>

      {/* Mesa */}
      <main className={`flex-1 mx-3 my-2 rounded-xl p-3 min-h-[30vh] relative overflow-hidden ${dark ? "felt-dark" : "felt"}`}>
        <div className="flex items-center justify-between text-white text-sm mb-2">
          <span className="font-bold">◀ {game?.leftEnd ?? "—"}</span>
          <span className="opacity-80">{game?.board?.length ?? 0} en mesa</span>
          <span className="font-bold">{game?.rightEnd ?? "—"} ▶</span>
        </div>
        <Board board={game?.board ?? []} lastMove={game?.lastMove} dark={dark} />
        {notice && <p className="mt-2 text-center text-sm font-bold text-amber-200 bg-black/40 rounded px-2 py-1 tile-pop">{notice}</p>}
        {error && <p className="mt-2 text-amber-200 bg-red-800/70 rounded px-2 py-1 text-sm">{error}</p>}
      </main>

      {/* Sin jugada: robar o pasar */}
      {myTurn && (game?.playable?.length ?? 0) === 0 && (
        <div className="px-3 pb-1 flex flex-col items-center gap-2">
          <p className="text-sm font-semibold opacity-80">😅 Sin jugada posible {game.lastMove ? `para ${game.lastMove.side === "left" ? game.leftEnd : game.rightEnd}` : ""}</p>
          {game.pozoCount > 0 ? (
            <button onClick={doDraw} disabled={thinking}
              className="draw-pulse touch-manipulation active:scale-95 transition px-6 py-2.5 rounded-xl bg-amber-400 text-black font-black text-base disabled:opacity-50">
              🎣 Robar del pozo ({game.pozoCount})
            </button>
          ) : (
            <button onClick={doPass} disabled={thinking}
              className="touch-manipulation active:scale-95 transition px-6 py-2.5 rounded-xl bg-sky-500 text-white font-black text-base disabled:opacity-50">
              ⏭ Pasar turno
            </button>
          )}
        </div>
      )}

      {/* Selector de extremo */}
      {selected && myTurn && (
        <div className="px-3 pb-1 flex gap-2 justify-center flex-wrap">
          {["left", "right"].map((side) => {
            const ok = playableSides(selected).includes(side);
            const label = side === "left" ? `◀ Jugar por ${game.leftEnd}` : `Jugar por ${game.rightEnd} ▶`;
            return (
              <button key={side} disabled={!ok} onClick={() => doPlay(selected, side)}
                className={`touch-manipulation active:scale-95 transition px-4 py-2.5 rounded-xl font-bold ${ok ? "bg-amber-400 text-black hover:bg-amber-300" : "bg-slate-300 dark:bg-slate-800 opacity-40"}`}>
                {label}
              </button>
            );
          })}
          <button onClick={() => setSelected(null)} className="touch-manipulation px-4 py-2.5 rounded-xl border dark:border-slate-700">Cancelar</button>
        </div>
      )}

      {/* Mi mano */}
      <footer className="px-3 pb-6">
        <div className="text-xs mb-1 opacity-80">Tu mano — toca una ficha resaltada en verde y elige extremo:</div>
        <div className="flex flex-wrap gap-2 justify-center">
          {(game?.myHand ?? []).map((t, i) => {
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

      {/* Fin de ronda / partida */}
      {game?.status === "finished" && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4">
          <div className="modal-pop bg-white dark:bg-slate-900 rounded-2xl p-6 max-w-sm w-full text-center relative overflow-hidden">
            {iWon && confetti.map((c, i) => (
              <span key={i} className="confetti" style={{
                left: c.left, animationDelay: c.delay, animationDuration: c.dur,
                background: c.bg, width: c.w, height: c.w * 0.6,
              }} />
            ))}
            <h2 className="text-2xl font-black">
              {game.matchFinished
                ? (game.matchWinner === 0 ? "🏆 ¡Ganaste la partida!" : `🤖 Bot${game.matchWinner} gana la partida`)
                : (game.result?.winnerSeat === 0 ? "🎉 ¡Ganaste la ronda!" : `Ronda para Bot${game.result?.winnerSeat}`)}
            </h2>
            <p className="mt-2 text-sm opacity-80">
              {game.result?.reason === "blocked" ? "Cierre por tranque. " : "Dominó. "}
              +{game.result?.pointsAwarded} pts · Puntos en mano: {(game.result?.handPoints ?? []).join(" / ")}
            </p>
            <p className="mt-1 text-sm font-semibold">Marcador: {(game.scores ?? []).join(" – ")} (meta {game.targetScore})</p>
            <div className="mt-4 flex gap-2">
              {!game.matchFinished && (
                <button onClick={doNextRound} disabled={loading}
                  className="flex-1 py-2 rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-50">
                  {loading ? "…" : "Siguiente ronda"}
                </button>
              )}
              <button onClick={() => { setScreen("inicio"); setGame(null); }}
                className="flex-1 py-2 rounded-xl border dark:border-slate-700 font-bold">Nueva partida</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
