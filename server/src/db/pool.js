/** Pool pg. Sin DATABASE_URL el servidor arranca igual (solo vs máquina). */
import pg from "pg";

const url = process.env.DATABASE_URL;

const isLocal = !url || /localhost|127\.0\.0\.1|::1/.test(url) || process.env.PGSSLMODE === "disable";

export const dbConfigured = Boolean(url);

export const pool = new pg.Pool({
  connectionString: url ?? "postgres://localhost:5432/domino_offline",
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on("error", (e) => console.error("[db] error en pool:", e.message));

/** Consulta parametrizada. Nunca concatenar valores: usar $1, $2... */
export function query(text, params = []) {
  if (!dbConfigured) throw new Error("Base de datos no configurada (falta DATABASE_URL)");
  return pool.query(text, params);
}
