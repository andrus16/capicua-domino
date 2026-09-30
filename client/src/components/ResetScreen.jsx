import { useState } from "react";
import { api } from "../api.js";
import { Logo } from "./Logo.jsx";

/** Pantalla de nueva contraseña (se abre desde el enlace del email ?reset=TOKEN). */
export function ResetScreen({ token, onDone }) {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setMsg("");
    if (pw1 !== pw2) { setMsg("Las contraseñas no coinciden"); return; }
    setBusy(true);
    try {
      const d = await api.resetPassword(token, pw1);
      setOk(true);
      setMsg(d.message ?? "Lista. Ya puedes entrar.");
    } catch (err) { setMsg(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-emerald-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <div className="max-w-md mx-auto px-4 py-10">
        <div className="flex justify-center"><Logo /></div>
        <div className="mt-6 rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-xl border-t-4 border-amber-400">
          <h2 className="font-black">🔑 Nueva contraseña</h2>
          {ok ? (
            <div className="mt-3 space-y-3 text-sm">
              <p className="text-emerald-700 dark:text-emerald-300 font-bold">{msg}</p>
              <button onClick={onDone} className="w-full py-2 rounded-xl bg-emerald-600 text-white font-bold">
                Ir a entrar
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-3 space-y-2">
              <input type="password" placeholder="nueva contraseña (6+)" value={pw1}
                onChange={(e) => setPw1(e.target.value)}
                className="w-full rounded border p-2 text-base md:text-sm dark:bg-slate-800 dark:border-slate-700" />
              <input type="password" placeholder="repite la contraseña" value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                className="w-full rounded border p-2 text-base md:text-sm dark:bg-slate-800 dark:border-slate-700" />
              {msg && <p className="text-red-600 text-xs">{msg}</p>}
              <button disabled={busy} className="w-full py-2 rounded-xl bg-amber-400 text-black font-bold disabled:opacity-50">
                {busy ? "…" : "Guardar contraseña"}
              </button>
              <button type="button" onClick={onDone} className="w-full text-xs underline opacity-70">Volver</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
