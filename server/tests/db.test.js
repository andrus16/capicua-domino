/** Integración PG. Se omite si no hay DATABASE_URL (p. ej. CI sin BD). */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const hasDb = Boolean(process.env.DATABASE_URL);
let pool, saveGameResult;

before(async () => {
  if (!hasDb) { console.log("  (sin DATABASE_URL: tests de integración omitidos)"); return; }
  const pg = (await import("pg")).default;
  const url = process.env.DATABASE_URL;
  const isLocal = /localhost|127\.0\.0\.1|::1/.test(url) || process.env.PGSSLMODE === "disable";
  pool = new pg.Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });
  const here = dirname(fileURLToPath(import.meta.url));
  await pool.query(readFileSync(join(here, "..", "..", "database", "schema.sql"), "utf8"));
  await pool.query(readFileSync(join(here, "..", "..", "database", "seed.sql"), "utf8"));
  ({ saveGameResult } = await import("../src/db/results.js"));
});

describe("integración PostgreSQL", () => {
  it("seed deja ranking con alba primera", { skip: !hasDb }, async () => {
    const { rows } = await pool.query("SELECT * FROM v_ranking");
    assert.ok(rows.length >= 2);
    assert.equal(rows[0].username, "alba");
    assert.equal(rows[0].games_won, 1);
  });

  it("saveGameResult guarda en transacción y actualiza stats", { skip: !hasDb }, async () => {
    const { rows: [bruno] } = await pool.query("SELECT id FROM users WHERE username = 'bruno'");
    const gameId = await saveGameResult({
      roomId: null, mode: "solo", winnerId: bruno.id, winnerSeat: 0,
      players: [
        { userId: bruno.id, seat: 0, isBot: false, finalScore: 30 },
        { userId: null, seat: 1, isBot: true, botLevel: "easy", finalScore: 0 },
      ],
      rounds: [{ roundNumber: 1, winnerSeat: 0, pointsAwarded: 12, endedByBlock: false, moves: [] }],
    });
    assert.ok(gameId > 0);
    const { rows: [st] } = await pool.query("SELECT games_played, games_won FROM user_stats WHERE user_id = $1", [bruno.id]);
    assert.equal(st.games_played, 1);
    assert.equal(st.games_won, 1);
    await pool.query("DELETE FROM games WHERE id = $1", [gameId]); // limpieza (cascada)
  });
});
