/** Consultas de ranking / perfil / historial. Todo parametrizado. */
import { query } from "./pool.js";

export async function getRanking(limit = 50) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const { rows } = await query(
    `SELECT * FROM v_ranking LIMIT $1`,
    [n]
  );
  return rows;
}

export async function getUserHistory(userId, limit = 20) {
  const n = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const { rows } = await query(
    `SELECT g.id AS game_id, g.mode, g.started_at, g.ended_at,
            g.winner_id, g.winner_seat, gp.seat AS my_seat,
            gp.final_score AS my_score,
            (SELECT json_agg(json_build_object('seat', p.seat, 'score', p.final_score, 'isBot', p.is_bot)
                             ORDER BY p.seat)
               FROM game_players p WHERE p.game_id = g.id) AS players,
            (SELECT COALESCE(SUM(r.points_awarded), 0) FROM rounds r WHERE r.game_id = g.id) AS total_points
     FROM games g
     JOIN game_players gp ON gp.game_id = g.id AND gp.user_id = $1
     ORDER BY g.started_at DESC
     LIMIT $2`,
    [userId, n]
  );
  return rows;
}
