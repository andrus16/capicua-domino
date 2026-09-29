/**
 * Guardado transaccional del resultado de una partida online (Fase 4 la usará;
 * queda lista y probada en Fase 3). Todo o nada: games + players + rounds +
 * moves + user_stats en una sola transacción.
 */
import { pool, dbConfigured } from "./pool.js";

export async function saveGameResult({
  roomId = null, mode = "online", winnerId = null, winnerSeat = null,
  players = [],   // [{ userId|null, seat, isBot, botLevel|null, finalScore }]
  rounds = [],    // [{ roundNumber, winnerSeat, pointsAwarded, endedByBlock, moves:[{seat,tileLeft|null,tileRight|null,side}] }]
}) {
  if (!dbConfigured) throw new Error("Base de datos no configurada (falta DATABASE_URL)");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [game] } = await client.query(
      `INSERT INTO games (room_id, mode, ended_at, winner_id, winner_seat)
       VALUES ($1, $2, now(), $3, $4) RETURNING id`,
      [roomId, mode, winnerId, winnerSeat]
    );
    for (const p of players) {
      await client.query(
        `INSERT INTO game_players (game_id, user_id, seat, final_score, is_bot, bot_level)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [game.id, p.userId, p.seat, p.finalScore ?? 0, p.isBot ?? false, p.botLevel ?? null]
      );
    }
    for (const r of rounds) {
      const { rows: [round] } = await client.query(
        `INSERT INTO rounds (game_id, round_number, winner_seat, points_awarded, ended_by_block)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [game.id, r.roundNumber, r.winnerSeat, r.pointsAwarded ?? 0, r.endedByBlock ?? false]
      );
      let n = 0;
      for (const m of r.moves ?? []) {
        n += 1;
        await client.query(
          `INSERT INTO moves (round_id, seat, tile_left, tile_right, side, move_number)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [round.id, m.seat, m.tileLeft ?? null, m.tileRight ?? null, m.side, n]
        );
      }
    }
    // Stats: +1 partida a cada humano, +1 victoria y puntos al ganador humano.
    for (const p of players) {
      if (p.isBot || !p.userId) continue;
      const won = winnerId != null && p.userId === winnerId ? 1 : 0;
      await client.query(
        `INSERT INTO user_stats (user_id, games_played, games_won, total_points)
         VALUES ($1, 1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET
           games_played = user_stats.games_played + 1,
           games_won = user_stats.games_won + $2,
           total_points = user_stats.total_points + $3,
           updated_at = now()`,
        [p.userId, won, won ? (rounds.reduce((s, r) => s + (r.pointsAwarded ?? 0), 0)) : 0]
      );
    }
    await client.query("COMMIT");
    return game.id;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
