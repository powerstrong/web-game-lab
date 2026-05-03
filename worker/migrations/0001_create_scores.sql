CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_name TEXT NOT NULL,
  game_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  week_key TEXT NOT NULL,
  room_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scores_weekly_leaderboard
  ON scores (game_id, week_key, score DESC);

CREATE INDEX IF NOT EXISTS idx_scores_player_best
  ON scores (player_name, game_id, week_key);
