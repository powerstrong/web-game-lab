/* GameBoot — common bootstrap contract for all game prototypes.
 *
 * Load this before game.js to get a standard interface for:
 *   - reading session params (code, name, gameId, type)
 *   - submitting results (PARTY_ASYNC stubs to sessionStorage for now)
 *   - navigating back after a round ends
 *
 * Usage:
 *   <script src="/shared/bootstrap.js"></script>
 *   // then in game.js:
 *   const { code, name, isMultiplayer } = window.GameBoot;
 *   window.GameBoot.submitResult({ score: 42, duration: 30 });
 *   window.GameBoot.exit();
 */

window.GameBoot = (function () {
  const params = new URLSearchParams(window.location.search);
  const code   = params.get('code')   || null;
  const name   = params.get('name')   || null;
  const gameId = params.get('gameId') || null;
  const playerId = params.get('playerId') || null;

  const registry = window.GAME_REGISTRY || [];
  const gameMeta = registry.find(g => g.id === gameId) || null;
  const gameType = gameMeta ? gameMeta.type : 'SOLO';

  // true when launched from a multiplayer lobby
  const isMultiplayer = !!code;

  function submitResult(result) {
    // Persists result to sessionStorage so a results screen can read it.
    // Future: POST to worker for PARTY_ASYNC leaderboard once that API exists.
    const entry = {
      gameId,
      code,
      name,
      type: gameType,
      timestamp: Date.now(),
      ...result,
    };
    try {
      const stored = JSON.parse(sessionStorage.getItem('lastGameResult') || 'null');
      const history = JSON.parse(sessionStorage.getItem('gameHistory') || '[]');
      history.push(entry);
      sessionStorage.setItem('lastGameResult', JSON.stringify(entry));
      sessionStorage.setItem('gameHistory', JSON.stringify(history.slice(-20)));
    } catch {
      /* storage unavailable — ignore */
    }
  }

  function exit() {
    if (isMultiplayer && code) {
      window.location.href =
        '/lobby/room.html?code=' + encodeURIComponent(code) +
        '&name=' + encodeURIComponent(name || '');
    } else {
      window.location.href = '/';
    }
  }

  return { code, name, gameId, gameType, playerId, isMultiplayer, submitResult, exit };
})();
