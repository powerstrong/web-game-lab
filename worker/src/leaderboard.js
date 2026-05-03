export function getWeekKey(date = new Date()) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);

  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);

  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export async function submitScore(db, { playerName, gameId, score, roomCode }) {
  const weekKey = getWeekKey();
  const normalizedScore = Math.trunc(Number(score));

  if (!playerName || !gameId || !Number.isFinite(normalizedScore)) {
    throw new Error('playerName, gameId, and score are required');
  }

  const existing = await db.prepare(`
    SELECT MAX(score) AS best_score
    FROM scores
    WHERE player_name = ? AND game_id = ? AND week_key = ?
  `).bind(playerName, gameId, weekKey).first();

  const previousBest = existing?.best_score == null ? null : Number(existing.best_score);

  await db.prepare(`
    INSERT INTO scores (player_name, game_id, score, week_key, room_code)
    VALUES (?, ?, ?, ?, ?)
  `).bind(playerName, gameId, normalizedScore, weekKey, roomCode || null).run();

  const rankRow = await db.prepare(`
    SELECT COUNT(*) + 1 AS player_rank
    FROM (
      SELECT player_name, MAX(score) AS best_score
      FROM scores
      WHERE game_id = ? AND week_key = ?
      GROUP BY player_name
      HAVING MAX(score) > ?
    )
  `).bind(gameId, weekKey, normalizedScore).first();

  return {
    isNewRecord: previousBest == null || normalizedScore > previousBest,
    previousBest,
    rank: Number(rankRow?.player_rank || 1),
  };
}

export async function getWeeklyLeaderboard(db, gameId) {
  const weekKey = getWeekKey();
  const { results } = await db.prepare(`
    SELECT player_name, MAX(score) AS best_score, COUNT(*) AS games_played
    FROM scores
    WHERE game_id = ? AND week_key = ?
    GROUP BY player_name
    ORDER BY best_score DESC, player_name ASC
    LIMIT 20
  `).bind(gameId, weekKey).all();

  return results || [];
}
