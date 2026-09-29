-- =============================================================
-- Dominó — esquema PostgreSQL (Fase 3)
-- Idempotente: puede ejecutarse varias veces (IF NOT EXISTS).
-- =============================================================

-- ---------- users ----------
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(32)  NOT NULL UNIQUE,
  email         VARCHAR(255) UNIQUE,
  password_hash TEXT,
  is_guest      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_username_len CHECK (char_length(username) BETWEEN 3 AND 32),
  -- Registrados: email + hash obligatorios. Invitados: sin email ni hash.
  CONSTRAINT users_guest_consistency CHECK (
    (is_guest = TRUE  AND password_hash IS NULL AND email IS NULL) OR
    (is_guest = FALSE AND password_hash IS NOT NULL AND email IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_users_created ON users (created_at DESC);

-- ---------- rooms ----------
CREATE TABLE IF NOT EXISTS rooms (
  id           SERIAL PRIMARY KEY,
  code         CHAR(6) NOT NULL UNIQUE,               -- código para compartir por link
  host_id      INTEGER REFERENCES users (id) ON DELETE SET NULL,
  is_private   BOOLEAN NOT NULL DEFAULT FALSE,
  max_players  SMALLINT NOT NULL DEFAULT 4,
  target_score INTEGER  NOT NULL DEFAULT 100,
  status       VARCHAR(16) NOT NULL DEFAULT 'lobby',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rooms_max_players CHECK (max_players BETWEEN 2 AND 4),
  CONSTRAINT rooms_target CHECK (target_score > 0),
  CONSTRAINT rooms_status CHECK (status IN ('lobby', 'playing', 'finished'))
);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms (status);
CREATE INDEX IF NOT EXISTS idx_rooms_host ON rooms (host_id);

-- ---------- games ----------
-- room_id NULL = partida contra la máquina (sin sala).
-- winner_id NULL = ganó un bot (ver winner_seat + game_players).
CREATE TABLE IF NOT EXISTS games (
  id          SERIAL PRIMARY KEY,
  room_id     INTEGER REFERENCES rooms (id) ON DELETE CASCADE,
  mode        VARCHAR(16) NOT NULL DEFAULT 'online',
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at    TIMESTAMPTZ,
  winner_id   INTEGER REFERENCES users (id) ON DELETE SET NULL,
  winner_seat SMALLINT,
  CONSTRAINT games_mode CHECK (mode IN ('solo', 'online')),
  CONSTRAINT games_winner_seat CHECK (winner_seat IS NULL OR winner_seat BETWEEN 0 AND 3)
);
CREATE INDEX IF NOT EXISTS idx_games_room ON games (room_id);
CREATE INDEX IF NOT EXISTS idx_games_winner ON games (winner_id);

-- ---------- game_players ----------
CREATE TABLE IF NOT EXISTS game_players (
  game_id     INTEGER NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users (id) ON DELETE SET NULL,  -- NULL = bot
  seat        SMALLINT NOT NULL,
  final_score INTEGER NOT NULL DEFAULT 0,
  is_bot      BOOLEAN NOT NULL DEFAULT FALSE,
  bot_level   VARCHAR(8),
  PRIMARY KEY (game_id, seat),
  CONSTRAINT gp_seat CHECK (seat BETWEEN 0 AND 3),
  CONSTRAINT gp_score CHECK (final_score >= 0),
  CONSTRAINT gp_human_has_user CHECK (is_bot = TRUE OR user_id IS NOT NULL),
  CONSTRAINT gp_level CHECK (bot_level IS NULL OR bot_level IN ('easy', 'medium', 'hard'))
);
CREATE INDEX IF NOT EXISTS idx_gp_user ON game_players (user_id);

-- ---------- rounds ----------
CREATE TABLE IF NOT EXISTS rounds (
  id             SERIAL PRIMARY KEY,
  game_id        INTEGER NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  round_number   INTEGER NOT NULL,
  winner_seat    SMALLINT,
  points_awarded INTEGER NOT NULL DEFAULT 0,
  ended_by_block BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT rounds_number CHECK (round_number > 0),
  CONSTRAINT rounds_points CHECK (points_awarded >= 0),
  CONSTRAINT rounds_winner CHECK (winner_seat IS NULL OR winner_seat BETWEEN 0 AND 3),
  CONSTRAINT rounds_unique_number UNIQUE (game_id, round_number)
);
CREATE INDEX IF NOT EXISTS idx_rounds_game ON rounds (game_id);

-- ---------- moves ----------
-- side: 'left' | 'right' (jugada) | 'draw' (robó) | 'pass' (pasó).
-- En 'draw'/'pass', tile_left/tile_right son NULL.
CREATE TABLE IF NOT EXISTS moves (
  id          BIGSERIAL PRIMARY KEY,
  round_id    INTEGER NOT NULL REFERENCES rounds (id) ON DELETE CASCADE,
  seat        SMALLINT NOT NULL,
  tile_left   SMALLINT,
  tile_right  SMALLINT,
  side        VARCHAR(8) NOT NULL,
  move_number INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT moves_seat CHECK (seat BETWEEN 0 AND 3),
  CONSTRAINT moves_pips CHECK (
    (tile_left IS NULL AND tile_right IS NULL) OR
    (tile_left BETWEEN 0 AND 6 AND tile_right BETWEEN 0 AND 6)
  ),
  CONSTRAINT moves_side CHECK (side IN ('left', 'right', 'draw', 'pass')),
  CONSTRAINT moves_number CHECK (move_number > 0),
  CONSTRAINT moves_unique_number UNIQUE (round_id, move_number)
);
CREATE INDEX IF NOT EXISTS idx_moves_round ON moves (round_id);

-- ---------- user_stats ----------
-- Una fila por usuario con actividad. Se actualiza en la misma
-- transacción que guarda el resultado de la partida.
CREATE TABLE IF NOT EXISTS user_stats (
  user_id      INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  games_played INTEGER NOT NULL DEFAULT 0,
  games_won    INTEGER NOT NULL DEFAULT 0,
  total_points INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stats_nonneg CHECK (games_played >= 0 AND games_won >= 0 AND total_points >= 0),
  CONSTRAINT stats_won_lte_played CHECK (games_won <= games_played)
);

-- ---------- ranking (vista) ----------
CREATE OR REPLACE VIEW v_ranking AS
SELECT
  u.id,
  u.username,
  u.is_guest,
  COALESCE(s.games_played, 0) AS games_played,
  COALESCE(s.games_won, 0)    AS games_won,
  COALESCE(s.total_points, 0) AS total_points,
  RANK() OVER (ORDER BY COALESCE(s.games_won, 0) DESC, COALESCE(s.total_points, 0) DESC) AS rank
FROM users u
LEFT JOIN user_stats s ON s.user_id = u.id
WHERE COALESCE(s.games_played, 0) > 0
ORDER BY rank, u.username;
