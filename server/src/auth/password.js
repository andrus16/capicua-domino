import bcrypt from "bcryptjs";

const ROUNDS = 10;

export function hashPassword(plain) {
  return bcrypt.hash(plain, ROUNDS);
}

export function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash ?? "");
}
