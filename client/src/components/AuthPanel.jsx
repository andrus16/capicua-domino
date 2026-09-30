import { useEffect, useState } from "react";
import { api } from "../api.js";

/** Estado compartido de la cuenta (usuario + sesión + historial). */
function useAccount(onUser = null) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("domino_user") ?? "null"); } catch { return null; }
  });
  const [mode, setMode] = useState("login"); // login | register
  const [form, setForm] = useState({ username: "", email: "", login: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState(null);

  const save = (u) => {
    setUser(u);
    if (u) localStorage.setItem("domino_user", JSON.stringify(u));
    else localStorage.removeItem("domino_user");
    onUser?.(u);
  };

  useEffect(() => {
    // Si hay token guardado, valida la sesión.
    if (api.getToken()) {
      api.me().then((d) => save(d.user)).catch(() => { api.logout(); save(null); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (user?.id) {
      api.history(user.id, 5).then((d) => setHistory(d.games)).catch(() => setHistory([]));
    } else setHistory(null);
  }, [user?.id]);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const d = mode === "register"
        ? await api.register(form.username.trim(), form.email.trim(), form.password)
        : await api.login(form.login.trim(), form.password);
      save(d.user);
      setForm({ username: "", email: "", login: "", password: "" });
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const asGuest = async () => {
    setError(""); setLoading(true);
    try { save((await api.guest()).user); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const logout = () => { api.logout(); save(null); };

  return { user, mode, setMode, form, setForm, error, loading, history, submit, asGuest, logout };
}

/** Tarjeta de cuenta siempre visible: sesión o login/registro/invitado. */
export function AccountCard({ onUser = null }) {
  const { user, mode, setMode, form, setForm, error, loading, history, submit, asGuest, logout } = useAccount(onUser);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotLogin, setForgotLogin] = useState("");
  const [forgotMsg, setForgotMsg] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);

  const doForgot = async (e) => {
    e.preventDefault();
    setForgotMsg(""); setForgotBusy(true);
    try {
      const d = await api.forgot(forgotLogin.trim());
      setForgotMsg(d.message ?? "Revisa tu correo.");
    } catch (err) { setForgotMsg(err.message); }
    finally { setForgotBusy(false); }
  };

  return (
    <div className="rounded-2xl overflow-hidden border-2 border-amber-400 shadow-xl bg-white dark:bg-slate-900">
      <div className="shine-wrap px-4 py-2 bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 text-black">
        <h2 className="font-black tracking-wide text-sm">👤 CUENTA</h2>
      </div>
      <div className="p-4 text-sm">
        {user ? (
          <div className="shine-wrap rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white p-3 shadow-lg space-y-1.5">
            <p className="font-black text-base leading-tight">
              {user.is_guest ? "🎭 Sesión de invitado" : `👋 Hola, ${user.username}`}
            </p>
            <p className="text-sm font-semibold opacity-95">
              🏆 {user.games_won ?? 0}/{user.games_played ?? 0} ganadas · {user.total_points ?? 0} pts
            </p>
            {history?.length > 0 && (
              <ul className="text-xs opacity-90 list-disc pl-5">
                {history.map((g) => (
                  <li key={g.game_id}>Partida #{g.game_id} · {g.mode} · {g.my_score} pts</li>
                ))}
              </ul>
            )}
            <button onClick={logout} className="mt-1 px-3 py-1 rounded-lg bg-black/25 hover:bg-black/40 text-xs font-bold">Cerrar sesión</button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              {(["login", "register"]).map((m) => (
                <button key={m} onClick={() => { setMode(m); }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-bold ${mode === m ? "bg-amber-400 text-black" : "border dark:border-slate-700"}`}>
                  {m === "login" ? "Entrar" : "Registrarse"}
                </button>
              ))}
              <button onClick={asGuest} disabled={loading} className="ml-auto px-3 py-1.5 rounded-lg border dark:border-slate-700 text-sm">
                Probar como invitado
              </button>
            </div>
            <form onSubmit={submit} className="space-y-2">
              {mode === "register" ? (
                <>
                  <input placeholder="usuario (3-32, letras/_/-)" value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    className="w-full rounded border p-2 text-base md:text-sm dark:bg-slate-800 dark:border-slate-700" />
                  <input placeholder="email" type="email" value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full rounded border p-2 text-base md:text-sm dark:bg-slate-800 dark:border-slate-700" />
                </>
              ) : (
                <input placeholder="usuario o email" value={form.login}
                  onChange={(e) => setForm({ ...form, login: e.target.value })}
                  className="w-full rounded border p-2 text-base md:text-sm dark:bg-slate-800 dark:border-slate-700" />
              )}
              <input placeholder="contraseña (6+)" type="password" value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full rounded border p-2 text-base md:text-sm dark:bg-slate-800 dark:border-slate-700" />
              {error && <p className="text-red-600 text-xs">{error}</p>}
              <button disabled={loading} className="w-full py-2 rounded-xl bg-slate-900 dark:bg-slate-700 text-white font-bold disabled:opacity-50">
                {loading ? "…" : mode === "register" ? "Crear cuenta" : "Entrar"}
              </button>
              {mode === "login" && !showForgot && (
                <button type="button" onClick={() => setShowForgot(true)} className="text-xs underline opacity-70">
                  ¿Olvidaste tu contraseña?
                </button>
              )}
            </form>
            {showForgot && (
              <form onSubmit={doForgot} className="space-y-2 rounded-xl border border-amber-300 dark:border-amber-700 p-2">
                <p className="text-xs font-bold">📧 Te enviamos un enlace (vale 30 min)</p>
                <input placeholder="tu usuario o email" value={forgotLogin}
                  onChange={(e) => setForgotLogin(e.target.value)}
                  className="w-full rounded border p-2 text-base md:text-sm dark:bg-slate-800 dark:border-slate-700" />
                {forgotMsg && <p className="text-xs opacity-80">{forgotMsg}</p>}
                <div className="flex gap-2">
                  <button disabled={forgotBusy} className="flex-1 py-1.5 rounded-lg bg-amber-400 text-black text-sm font-bold disabled:opacity-50">
                    {forgotBusy ? "…" : "Enviar enlace"}
                  </button>
                  <button type="button" onClick={() => { setShowForgot(false); setForgotMsg(""); }}
                    className="px-3 py-1.5 rounded-lg border dark:border-slate-700 text-sm">✕</button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Tarjeta de ranking siempre visible, con podio top-3. */
export function RankingCard({ highlight = null }) {
  const [ranking, setRanking] = useState(null);

  const loadRanking = async () => {
    try { setRanking((await api.ranking(10)).ranking); }
    catch { setRanking([]); }
  };

  useEffect(() => { loadRanking(); }, []);

  return (
    <div className="rounded-2xl overflow-hidden border-2 border-yellow-400 shadow-xl">
      <div className="shine-wrap flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 text-black">
        <h2 className="font-black tracking-wide text-sm"><span className="trophy">🏆</span> RANKING</h2>
        <button onClick={loadRanking} className="ml-auto px-2 py-0.5 rounded-full bg-black/15 hover:bg-black/25 text-xs font-bold" title="Actualizar">↻</button>
      </div>
      <div className="p-3 bg-amber-50 dark:bg-slate-800">
        {ranking === null
          ? <p className="opacity-60 text-xs px-1">Cargando…</p>
          : ranking.length === 0
            ? <p className="opacity-60 text-xs px-1">Sin datos todavía — ¡juega y sé el primero!</p>
            : <ol className="space-y-1.5">
                {ranking.map((r, i) => {
                  const medal = i === 0 ? "medal-1" : i === 1 ? "medal-2" : i === 2 ? "medal-3" : "";
                  const face = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
                  const me = highlight && (r.id === highlight.id || r.username === highlight.username);
                  return (
                    <li key={r.id ?? i} style={{ animationDelay: `${i * 70}ms` }}
                      className={`rank-row flex items-center gap-2 px-2 py-1.5 rounded-lg text-slate-900 ${medal || "bg-white dark:bg-slate-900 dark:text-slate-100 border dark:border-slate-700"} ${me ? "ring-2 ring-emerald-500" : ""}`}>
                      <span className="w-7 text-center font-black">{face}</span>
                      <span className="flex-1 font-bold truncate">{r.username}{me ? " (tú)" : ""}</span>
                      <span className="text-xs font-semibold opacity-80 whitespace-nowrap">{r.games_won}V · {r.total_points}pts</span>
                    </li>
                  );
                })}
              </ol>}
      </div>
    </div>
  );
}
