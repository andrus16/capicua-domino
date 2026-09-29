import { io } from "socket.io-client";

let socket = null;

/** Socket único. En producción usa VITE_API_URL (backend); en dev, mismo origen (proxy). */
export function getSocket() {
  if (socket?.connected) return socket;
  if (socket) { socket.disconnect(); socket = null; }
  const token = localStorage.getItem("domino_token");
  const apiUrl = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
  socket = io(apiUrl || undefined, { auth: token ? { token } : {}, transports: ["websocket", "polling"] });
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
}

/** Emite con ack -> promesa ({ok} o lanza Error). */
export function emitAck(sock, ev, payload = {}) {
  return new Promise((resolve, reject) => {
    sock.emit(ev, payload, (res) => {
      if (res?.ok) resolve(res);
      else reject(new Error(res?.error ?? "Error de red"));
    });
  });
}
