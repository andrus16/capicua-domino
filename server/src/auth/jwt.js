import jwt from "jsonwebtoken";

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s && process.env.NODE_ENV === "production") {
    throw new Error("Falta JWT_SECRET en producción");
  }
  return s ?? "dev-secret-solo-local";
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, guest: Boolean(user.is_guest) },
    secret(),
    { expiresIn: "7d" }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, secret());
}
