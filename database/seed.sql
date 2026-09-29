-- =============================================================
-- Dominó — datos de prueba (Fase 3)
-- Requiere schema.sql aplicado. Password de los demos: demo1234
-- Re-ejecutable: usa ON CONFLICT DO NOTHING + subselects por username.
-- =============================================================

-- Usuarios demo (hash bcrypt de 'demo1234') + 1 invitado
INSERT INTO users (username, email, password_hash, is_guest) VALUES
  ('alba',   'alba@example.com',   '$2b$10$3o5BqAWorI1BWki/wgO44O8pWm/aUiJGguXMB9/qByt8G6UzDZWAK', FALSE),
  ('bruno',  'bruno@example.com',  '$2b$10$3o5BqAWorI1BWki/wgO44O8pWm/aUiJGguXMB9/qByt8G6UzDZWAK', FALSE),
  ('carla',  'carla@example.com',  '$2b$10$3o5BqAWorI1BWki/wgO44O8pWm/aUiJGguXMB9/qByt8G6UzDZWAK', FALSE),
  ('invitado_demo', NULL, NULL, TRUE)
ON CONFLICT (username) DO NOTHING;

-- Salas: 1 pública + 1 privada (código AMIGOS para compartir por link)
INSERT INTO rooms (code, host_id, is_private, max_players, target_score, status)
SELECT 'ABIERT', (SELECT id FROM users WHERE username = 'alba'), FALSE, 4, 100, 'lobby'
WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE code = 'ABIERT');

INSERT INTO rooms (code, host_id, is_private, max_players, target_score, status)
SELECT 'AMIGOS', (SELECT id FROM users WHERE username = 'bruno'), TRUE, 2, 50, 'lobby'
WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE code = 'AMIGOS');

-- Partida online terminada en la sala pública (alba gana)
INSERT INTO games (room_id, mode, started_at, ended_at, winner_id, winner_seat)
SELECT (SELECT id FROM rooms WHERE code = 'ABIERT'), 'online',
       now() - interval '2 hours', now() - interval '1 hour',
       (SELECT id FROM users WHERE username = 'alba'), 0
WHERE NOT EXISTS (
  SELECT 1 FROM games g JOIN rooms r ON r.id = g.room_id WHERE r.code = 'ABIERT'
);

-- Jugadores de esa partida (carla humana + 2 bots)
INSERT INTO game_players (game_id, user_id, seat, final_score, is_bot, bot_level)
SELECT g.id, u.id, 0, 45, FALSE, NULL FROM games g, users u
WHERE g.room_id = (SELECT id FROM rooms WHERE code = 'ABIERT')
  AND u.username = 'alba'
ON CONFLICT DO NOTHING;

INSERT INTO game_players (game_id, user_id, seat, final_score, is_bot, bot_level)
SELECT g.id, u.id, 1, 20, FALSE, NULL FROM games g, users u
WHERE g.room_id = (SELECT id FROM rooms WHERE code = 'ABIERT')
  AND u.username = 'carla'
ON CONFLICT DO NOTHING;

INSERT INTO game_players (game_id, user_id, seat, final_score, is_bot, bot_level)
SELECT g.id, NULL, s.seat, 0, TRUE, 'medium' FROM games g
CROSS JOIN (VALUES (2), (3)) AS s(seat)
WHERE g.room_id = (SELECT id FROM rooms WHERE code = 'ABIERT')
ON CONFLICT DO NOTHING;

-- Rondas de esa partida
INSERT INTO rounds (game_id, round_number, winner_seat, points_awarded, ended_by_block)
SELECT g.id, 1, 0, 25, FALSE FROM games g
WHERE g.room_id = (SELECT id FROM rooms WHERE code = 'ABIERT')
ON CONFLICT DO NOTHING;

INSERT INTO rounds (game_id, round_number, winner_seat, points_awarded, ended_by_block)
SELECT g.id, 2, 0, 20, TRUE FROM games g
WHERE g.room_id = (SELECT id FROM rooms WHERE code = 'ABIERT')
ON CONFLICT DO NOTHING;

-- Algunas jugadas de la ronda 1 (trazabilidad)
INSERT INTO moves (round_id, seat, tile_left, tile_right, side, move_number)
SELECT r.id, 0, 6, 6, 'right', 1 FROM rounds r
JOIN games g ON g.id = r.game_id JOIN rooms ro ON ro.id = g.room_id
WHERE ro.code = 'ABIERT' AND r.round_number = 1
ON CONFLICT DO NOTHING;

INSERT INTO moves (round_id, seat, tile_left, tile_right, side, move_number)
SELECT r.id, 1, 6, 4, 'right', 2 FROM rounds r
JOIN games g ON g.id = r.game_id JOIN rooms ro ON ro.id = g.room_id
WHERE ro.code = 'ABIERT' AND r.round_number = 1
ON CONFLICT DO NOTHING;

INSERT INTO moves (round_id, seat, tile_left, tile_right, side, move_number)
SELECT r.id, 2, NULL, NULL, 'pass', 3 FROM rounds r
JOIN games g ON g.id = r.game_id JOIN rooms ro ON ro.id = g.room_id
WHERE ro.code = 'ABIERT' AND r.round_number = 1
ON CONFLICT DO NOTHING;

-- Estadísticas coherentes con la partida de ejemplo
INSERT INTO user_stats (user_id, games_played, games_won, total_points)
SELECT id, 1, 1, 45 FROM users WHERE username = 'alba'
ON CONFLICT (user_id) DO UPDATE SET games_played = 1, games_won = 1, total_points = 45, updated_at = now();

INSERT INTO user_stats (user_id, games_played, games_won, total_points)
SELECT id, 1, 0, 20 FROM users WHERE username = 'carla'
ON CONFLICT (user_id) DO UPDATE SET games_played = 1, games_won = 0, total_points = 20, updated_at = now();

INSERT INTO user_stats (user_id, games_played, games_won, total_points)
SELECT id, 0, 0, 0 FROM users WHERE username = 'bruno'
ON CONFLICT (user_id) DO NOTHING;
