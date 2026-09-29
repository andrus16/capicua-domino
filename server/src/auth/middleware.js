import { verifyToken } from "./jwt.js";

function fromHeader(req) {
  const h = req.headers.authorization ?? "";
  const m = h.match(/^Bearer (.+)$/);
  return m ? m[1] : null;
}

/** 401 si falta token o es inválido. Adjunta req.user = { id, username, guest }. */
export function requireAuth(req, res, next) {
  const token = fromHeader(req);
  if (!token) return res.status(401).json({ error: "Falta token (inicia sesión)" });
  try {
    const p = verifyToken(token);
    req.user = { id: p.sub, username: p.username, guest: p.guest };
    next();
  } catch {
    return res.status(401).json({ error: "Sesión inválida o caducada" });
  }
}

/** Opcional: adjunta req.user si hay token válido, si no sigue anónimo. */
export function optionalAuth(req, _res, next) {
  const token = fromHeader(req);
  if (token) {
    try {
      const p = verifyToken(token);
      req.user = { id: p.sub, username: p.username, guest: p.guest };
    } catch { /* anónimo */ }
  }
  next();
}
