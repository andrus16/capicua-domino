/** Migración / seed contra DATABASE_URL (local o Render). Uso:
 *   npm run db:migrate   -> aplica database/schema.sql
 *   npm run db:seed      -> aplica database/seed.sql (requiere schema)
 *
 * Lee variables de database/.env, .env o entorno. SSL automático salvo
 * host local o PGSSLMODE=disable (imprescindible para Render).
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] === "seed" ? "seed.sql" : "schema.sql";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL. Cópiala de .env.example a .env o expórtala en el entorno.");
  process.exit(1);
}

const isLocal = /localhost|127\.0\.0\.1|::1/.test(url) || process.env.PGSSLMODE === "disable";
const pool = new pg.Pool({
  connectionString: url,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

try {
  const sql = readFileSync(join(here, target), "utf8");
  console.log(`Aplicando ${target}...`);
  await pool.query(sql);
  console.log(`OK: ${target} aplicado.`);
} catch (e) {
  console.error(`Error aplicando ${target}:`, e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
