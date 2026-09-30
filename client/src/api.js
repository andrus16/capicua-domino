const BASE = import.meta.env.VITE_API_URL ?? "";

const token = {
  get: () => localStorage.getItem("domino_token"),
  set: (t) => (t ? localStorage.setItem("domino_token", t) : localStorage.removeItem("domino_token")),
};

async function req(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers ?? {}) };
  const t = token.get();
  if (t) headers.Authorization = `Bearer ${t}`;
  const r = await fetch(BASE + path, { ...opts, headers });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `Error HTTP ${r.status}`);
  return data;
}

export const api = {
  startSolo: (cfg) => req("/api/solo", { method: "POST", body: JSON.stringify(cfg) }),
  getSolo: (id) => req(`/api/solo/${id}`),
  playSolo: (id, tile, side) => req(`/api/solo/${id}/play`, { method: "POST", body: JSON.stringify({ tile, side }) }),
  drawSolo: (id) => req(`/api/solo/${id}/draw`, { method: "POST" }),
  passSolo: (id) => req(`/api/solo/${id}/pass`, { method: "POST" }),
  nextRound: (id) => req(`/api/solo/${id}/next-round`, { method: "POST" }),
  health: () => req("/health"),
  // ---- Fase 3: cuentas + ranking ----
  register: async (username, email, password) => {
    const d = await req("/api/auth/register", { method: "POST", body: JSON.stringify({ username, email, password }) });
    token.set(d.token);
    return d;
  },
  login: async (login, password) => {
    const d = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ login, password }) });
    token.set(d.token);
    return d;
  },
  guest: async () => {
    const d = await req("/api/auth/guest", { method: "POST" });
    token.set(d.token);
    return d;
  },
  me: () => req("/api/auth/me"),
  forgot: (login) => req("/api/auth/forgot", { method: "POST", body: JSON.stringify({ login }) }),
  resetPassword: (token, password) => req("/api/auth/reset", { method: "POST", body: JSON.stringify({ token, password }) }),
  logout: () => token.set(null),
  getToken: token.get,
  ranking: (limit = 50) => req(`/api/ranking?limit=${limit}`),
  profile: (id) => req(`/api/users/${id}`),
  history: (id, limit = 20) => req(`/api/users/${id}/games?limit=${limit}`),
};
