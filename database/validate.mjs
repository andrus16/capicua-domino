import { readFileSync } from "node:fs";
import { newDb, DataType } from "pg-mem";

const db = newDb();
// pg-mem no trae char_length; en PostgreSQL real sí existe.
db.public.registerFunction({
  name: "char_length",
  args: [DataType.text],
  returns: DataType.integer,
  implementation: (x) => (x == null ? null : String(x).length),
});
let schema = readFileSync("database/schema.sql", "utf8");
// pg-mem aún no soporta OVER (RANK() en v_ranking) ni subselects
// escalares en INSERT...SELECT del seed. En PostgreSQL real se aplica
// schema.sql / seed.sql tal cual; aquí se usan variantes compatibles.
const compatView = `CREATE OR REPLACE VIEW v_ranking AS
SELECT
  u.id,
  u.username,
  u.is_guest,
  COALESCE(s.games_played, 0) AS games_played,
  COALESCE(s.games_won, 0)    AS games_won,
  COALESCE(s.total_points, 0) AS total_points,
  1 AS rank
FROM users u
LEFT JOIN user_stats s ON s.user_id = u.id
WHERE COALESCE(s.games_played, 0) > 0;`;
schema = schema.replace(/CREATE OR REPLACE VIEW v_ranking AS[\s\S]*?ORDER BY rank, u\.username;/, compatView);
db.public.none(schema);
console.log("SCHEMA OK");

// Seed equivalente al de seed.sql pero con IDs resueltos en JS
// (pg-mem infiere mal el tipo de los subselects escalares).
const H = "$2b$10$3o5BqAWorI1BWki/wgO44O8pWm/aUiJGguXMB9/qByt8G6UzDZWAK";
for (const [u, e, g] of [["alba", "alba@example.com", false], ["bruno", "bruno@example.com", false], ["carla", "carla@example.com", false]]) {
  db.public.none(`INSERT INTO users (username, email, password_hash, is_guest) VALUES ('${u}', '${e}', '${H}', FALSE) ON CONFLICT (username) DO NOTHING`);
}
db.public.none(`INSERT INTO users (username, email, password_hash, is_guest) VALUES ('invitado_demo', NULL, NULL, TRUE) ON CONFLICT (username) DO NOTHING`);
const alba = db.public.one("SELECT id FROM users WHERE username='alba'").id;
const bruno = db.public.one("SELECT id FROM users WHERE username='bruno'").id;
const carla = db.public.one("SELECT id FROM users WHERE username='carla'").id;
db.public.none(`INSERT INTO rooms (code, host_id, is_private, max_players, target_score, status) VALUES ('ABIERT', ${alba}, FALSE, 4, 100, 'lobby') ON CONFLICT DO NOTHING`);
db.public.none(`INSERT INTO rooms (code, host_id, is_private, max_players, target_score, status) VALUES ('AMIGOS', ${bruno}, TRUE, 2, 50, 'lobby') ON CONFLICT DO NOTHING`);
const roomId = db.public.one("SELECT id FROM rooms WHERE code='ABIERT'").id;
let gameId;
try {
  gameId = db.public.one(`INSERT INTO games (room_id, mode, started_at, ended_at, winner_id, winner_seat) VALUES (${roomId}, 'online', now() - interval '2 hours', now() - interval '1 hour', ${alba}, 0) RETURNING id`).id;
} catch {
  gameId = db.public.one(`SELECT id FROM games WHERE room_id=${roomId} LIMIT 1`).id;
}
db.public.none(`INSERT INTO game_players (game_id, user_id, seat, final_score, is_bot, bot_level) VALUES (${gameId}, ${alba}, 0, 45, FALSE, NULL) ON CONFLICT DO NOTHING`);
db.public.none(`INSERT INTO game_players (game_id, user_id, seat, final_score, is_bot, bot_level) VALUES (${gameId}, ${carla}, 1, 20, FALSE, NULL) ON CONFLICT DO NOTHING`);
db.public.none(`INSERT INTO game_players (game_id, user_id, seat, final_score, is_bot, bot_level) VALUES (${gameId}, NULL, 2, 0, TRUE, 'medium') ON CONFLICT DO NOTHING`);
db.public.none(`INSERT INTO game_players (game_id, user_id, seat, final_score, is_bot, bot_level) VALUES (${gameId}, NULL, 3, 0, TRUE, 'medium') ON CONFLICT DO NOTHING`);
db.public.none(`INSERT INTO rounds (game_id, round_number, winner_seat, points_awarded, ended_by_block) VALUES (${gameId}, 1, 0, 25, FALSE) ON CONFLICT DO NOTHING`);
db.public.none(`INSERT INTO rounds (game_id, round_number, winner_seat, points_awarded, ended_by_block) VALUES (${gameId}, 2, 0, 20, TRUE) ON CONFLICT DO NOTHING`);
const r1 = db.public.one(`SELECT id FROM rounds WHERE game_id=${gameId} AND round_number=1`).id;
db.public.none(`INSERT INTO moves (round_id, seat, tile_left, tile_right, side, move_number) VALUES (${r1}, 0, 6, 6, 'right', 1) ON CONFLICT DO NOTHING`);
db.public.none(`INSERT INTO moves (round_id, seat, tile_left, tile_right, side, move_number) VALUES (${r1}, 1, 6, 4, 'right', 2) ON CONFLICT DO NOTHING`);
db.public.none(`INSERT INTO moves (round_id, seat, tile_left, tile_right, side, move_number) VALUES (${r1}, 2, NULL, NULL, 'pass', 3) ON CONFLICT DO NOTHING`);
db.public.none(`INSERT INTO user_stats (user_id, games_played, games_won, total_points) VALUES (${alba}, 1, 1, 45) ON CONFLICT (user_id) DO UPDATE SET games_played=1, games_won=1, total_points=45, updated_at=now()`);
db.public.none(`INSERT INTO user_stats (user_id, games_played, games_won, total_points) VALUES (${carla}, 1, 0, 20) ON CONFLICT (user_id) DO UPDATE SET games_played=1, games_won=0, total_points=20, updated_at=now()`);
db.public.none(`INSERT INTO user_stats (user_id, games_played, games_won, total_points) VALUES (${bruno}, 0, 0, 0) ON CONFLICT (user_id) DO NOTHING`);
console.log("SEED OK");
// Orden equivalente al ranking real: victorias DESC, puntos DESC.
const ranking = db.public.many("SELECT username, games_won, total_points FROM v_ranking ORDER BY games_won DESC, total_points DESC, username");
console.log("RANKING:", JSON.stringify(ranking));
const hist = db.public.many(
  "SELECT g.id, g.mode FROM games g " +
  "JOIN game_players gp ON gp.game_id = g.id " +
  "JOIN users u ON u.id = gp.user_id WHERE u.username = 'alba'"
);
console.log("HISTORIAL alba:", JSON.stringify(hist));
const rooms = db.public.many(
  "SELECT r.code, COUNT(g.id) AS partidas FROM rooms r " +
  "LEFT JOIN games g ON g.room_id = r.id GROUP BY r.code ORDER BY r.code"
);
console.log("PARTIDAS POR SALA:", JSON.stringify(rooms));
// CHECKs: invitado con email debe fallar, duplicado debe fallar
try {
  db.public.none("INSERT INTO users (username, email, password_hash, is_guest) VALUES ('x', 'x@x.co', NULL, TRUE)");
  console.log("CHECK guest: NO SALTÓ (revisar)");
} catch { console.log("CHECK guest OK (rechaza invitado con email)"); }
try {
  db.public.none("INSERT INTO users (username, email, password_hash, is_guest) VALUES ('alba', 'otro@x.co', 'h', FALSE)");
  console.log("UNIQUE username: NO SALTÓ (revisar)");
} catch { console.log("UNIQUE username OK"); }
