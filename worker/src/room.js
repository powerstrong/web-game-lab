const COLORS = [
  '#ef4444', // red
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#a855f7', // purple
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
];

const GAME_PATHS = {
  'dodge-square': '/prototypes/dodge-square/index.html',
  'rhythm-tap': '/prototypes/rhythm-tap/index.html',
};

function randomHex(len) {
  const bytes = new Uint8Array(len / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    // In-memory state (persists across messages within same DO instance)
    this.players = new Map();       // ws -> {id, name, color}
    this.gameVotes = new Map();     // playerId -> gameId
    this.startVotes = new Set();    // playerId
    this.phase = 'lobby';
    this.chatLog = [];
    this.code = '';
    this.colorIndex = 0;
    this.countdownActive = false;
  }

  // ─── fetch ────────────────────────────────────────────────────────────────

  async fetch(request) {
    const url = new URL(request.url);

    // Internal init call from index.js
    if (request.method === 'POST' && url.pathname === '/init') {
      const { code } = await request.json();
      this.code = code;
      return new Response('OK');
    }

    // WebSocket upgrade
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── WebSocket handlers ────────────────────────────────────────────────────

  async webSocketMessage(ws, rawMsg) {
    let msg;
    try {
      msg = JSON.parse(rawMsg);
    } catch {
      return;
    }

    const player = this.players.get(ws);

    switch (msg.type) {
      case 'join':
        await this._handleJoin(ws, msg);
        break;
      case 'chat':
        if (player) await this._handleChat(ws, player, msg);
        break;
      case 'vote_game':
        if (player) await this._handleVoteGame(player, msg);
        break;
      case 'vote_start':
        if (player) await this._handleVoteStart(player);
        break;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
    }
  }

  async webSocketClose(ws) {
    await this._removePlayer(ws);
  }

  async webSocketError(ws) {
    await this._removePlayer(ws);
  }

  // ─── Message handlers ──────────────────────────────────────────────────────

  async _handleJoin(ws, msg) {
    const name = (msg.name || 'Player').slice(0, 32);
    const id = randomHex(6);
    const color = COLORS[this.colorIndex % COLORS.length];
    this.colorIndex++;

    const playerData = { id, name, color };
    this.players.set(ws, playerData);

    // Send welcome to new player
    const playersArr = Array.from(this.players.values());
    const gameVotesObj = Object.fromEntries(this.gameVotes);

    ws.send(JSON.stringify({
      type: 'welcome',
      playerId: id,
      code: this.code,
      players: playersArr,
      chatLog: this.chatLog,
      gameVotes: gameVotesObj,
      phase: this.phase,
    }));

    // Broadcast player_joined to everyone else
    this._broadcast({ type: 'player_joined', player: playerData }, ws);
  }

  async _handleChat(ws, player, msg) {
    const text = (msg.text || '').slice(0, 256);
    if (!text.trim()) return;

    const entry = {
      type: 'chat',
      playerId: player.id,
      name: player.name,
      text,
      ts: Date.now(),
    };

    this.chatLog.push(entry);
    if (this.chatLog.length > 50) this.chatLog.shift();

    this._broadcastAll(entry);
  }

  async _handleVoteGame(player, msg) {
    const gameId = msg.gameId;
    if (!GAME_PATHS[gameId]) return;

    this.gameVotes.set(player.id, gameId);

    this._broadcastAll({
      type: 'game_voted',
      playerId: player.id,
      gameId,
      votes: Object.fromEntries(this.gameVotes),
    });

    await this._checkStartCondition();
  }

  async _handleVoteStart(player) {
    this.startVotes.add(player.id);

    this._broadcastAll({
      type: 'start_voted',
      playerId: player.id,
      startVotes: Array.from(this.startVotes),
      total: this.players.size,
    });

    await this._checkStartCondition();
  }

  async _checkStartCondition() {
    if (this.phase !== 'lobby') return;
    if (this.countdownActive) return;

    const playerCount = this.players.size;
    if (playerCount === 0) return;

    // Majority start votes: >50%
    if (this.startVotes.size <= playerCount / 2) return;

    // Find majority game vote
    const tally = new Map();
    for (const gameId of this.gameVotes.values()) {
      tally.set(gameId, (tally.get(gameId) || 0) + 1);
    }

    let topGame = null;
    let topCount = 0;
    for (const [gameId, count] of tally) {
      if (count > topCount) {
        topCount = count;
        topGame = gameId;
      }
    }

    // Need a majority game vote too
    if (!topGame || topCount <= playerCount / 2) return;

    await this._startCountdown(topGame);
  }

  async _startCountdown(gameId) {
    this.countdownActive = true;
    this.phase = 'countdown';

    // Capture origin from one of the connected websockets' attachment or use a fallback
    // We'll resolve the base URL at game_start time via the env or a stored origin
    const baseUrl = this.baseUrl || '';

    for (const seconds of [3, 2, 1]) {
      this._broadcastAll({ type: 'countdown', seconds });
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    this.phase = 'playing';
    const gamePath = GAME_PATHS[gameId];
    const gameUrl = `${baseUrl}${gamePath}`;

    this._broadcastAll({ type: 'game_start', gameId, url: gameUrl });
  }

  // ─── Player removal ────────────────────────────────────────────────────────

  async _removePlayer(ws) {
    const player = this.players.get(ws);
    if (!player) return;

    this.players.delete(ws);
    this.gameVotes.delete(player.id);
    this.startVotes.delete(player.id);

    this._broadcastAll({ type: 'player_left', playerId: player.id });
  }

  // ─── Broadcast helpers ─────────────────────────────────────────────────────

  _broadcastAll(msg) {
    const text = JSON.stringify(msg);
    for (const ws of this.players.keys()) {
      try { ws.send(text); } catch { /* closed */ }
    }
  }

  // Broadcast to everyone except `exclude`
  _broadcast(msg, exclude) {
    const text = JSON.stringify(msg);
    for (const ws of this.players.keys()) {
      if (ws === exclude) continue;
      try { ws.send(text); } catch { /* closed */ }
    }
  }
}
