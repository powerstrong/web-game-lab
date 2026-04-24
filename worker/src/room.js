const COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#f59e0b',
  '#a855f7', '#ec4899', '#14b8a6', '#f97316',
];

// Keep in sync with /games/registry.js (browser can't import that file here)
const GAME_PATHS = {
  'dodge-square':     '/prototypes/dodge-square/index.html',
  'rhythm-tap':       '/prototypes/rhythm-tap/index.html',
  'jump-climber':     '/prototypes/jump-climber/index.html',
  'mallang-factory':  '/prototypes/mallang-factory/index.html',
};

function randomHex(len) {
  const bytes = new Uint8Array(len / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

const JUMP_GAME_SETTINGS = {
  worldWidth: 500,
  arenaHeight: 640,
  gravity: 0.42,
  moveSpeed: 4.8,
  normalJump: -11.8,
  boostJump: -16.8,
  platformGap: 96,
  platformWidthMin: 84,
  platformWidthMax: 150,
  startLineY: 540,
  playerSpawnOffset: 52,
  tickMs: 50,
  safePlatformInset: 14,
  difficultyHeightRange: 2600,
  pathShiftMin: 180,
  pathShiftMax: 245,
  pathRequiredShiftMin: 40,
  pathRequiredShiftMax: 85,
  platformWidthMinLate: 74,
  platformWidthMaxLate: 122,
};

const PLATFORM_KINDS = ['leaf', 'cloud', 'cake'];
const JUMP_PROTOCOL_VERSION = 'jump/v1';
const JUMP_BASE_STEP_MS = 1000 / 60;
const JUMP_SESSION_LIMITS = {
  players: 2,
  spectators: 2,
};
const JUMP_PATCH_RATES = {
  playerMs: JUMP_GAME_SETTINGS.tickMs,
  spectatorMs: 100,
};

// ── 팩토리 게임 상수 ─────────────────────────────────────────────────────────

const FACTORY_CONFIG = {
  roundSec: 90,
  tickMs: 1000,          // 1초 서버 틱
  workbenchCount: 2,
  maxActiveOrders: 2,
  assemblyBaseSec: { mini_bot: 8, delivery_bot: 12, power_bot: 14 },
  qualityMultiplier: { normal: 1.0, good: 1.1, perfect: 1.3 },
};

const FACTORY_PARTS = [
  { id: 'frame',   name: '프레임', icon: '🔷' },
  { id: 'circuit', name: '회로',   icon: '🟩' },
  { id: 'wheel',   name: '바퀴',   icon: '🟡' },
  { id: 'battery', name: '배터리', icon: '🔋' },
];

const FACTORY_RECIPES = [
  { id: 'mini_bot',      name: '미니봇',  parts: ['frame', 'circuit'],           reward: 100 },
  { id: 'delivery_bot',  name: '배달봇',  parts: ['frame', 'circuit', 'wheel'],  reward: 180 },
  { id: 'power_bot',     name: '파워봇',  parts: ['frame', 'battery', 'wheel'],  reward: 200 },
];

function factoryMakeOrder(id) {
  const recipe = FACTORY_RECIPES[Math.floor(Math.random() * FACTORY_RECIPES.length)];
  return { id, recipeId: recipe.id, status: 'active' };
}

function factoryMakeWorkbench(id) {
  return { id, assignedOrderId: null, recipeId: null, parts: [], state: 'idle', helpedBy: [], assemblyEndsAt: null };
}

function getJumpSubstepCount() {
  return Math.max(1, Math.round(JUMP_GAME_SETTINGS.tickMs / JUMP_BASE_STEP_MS));
}

function getJumpSubstepMs() {
  return JUMP_GAME_SETTINGS.tickMs / getJumpSubstepCount();
}

function getJumpStepScale(stepMs) {
  return stepMs / JUMP_BASE_STEP_MS;
}

function getJumpSpectatorPatchEvery() {
  return Math.max(1, Math.round(JUMP_PATCH_RATES.spectatorMs / JUMP_PATCH_RATES.playerMs));
}

function getStepBlend(baseFactor, stepMs, fullStepMs = JUMP_GAME_SETTINGS.tickMs) {
  const clamped = clamp(baseFactor, 0, 1);
  return 1 - Math.pow(1 - clamped, stepMs / fullStepMs);
}

function createPlatformMotion() {
  const roll = Math.random();
  if (roll < 0.18) {
    return {
      type: 'drift',
      amplitude: randomBetween(18, 34),
      speed: randomBetween(0.45, 0.78),
      phase: randomBetween(0, Math.PI * 2),
      rotateAmplitude: randomBetween(2, 4),
    };
  }

  if (roll < 0.33) {
    return {
      type: 'rotate',
      amplitude: 0,
      speed: randomBetween(0.5, 0.9),
      phase: randomBetween(0, Math.PI * 2),
      rotateAmplitude: randomBetween(5, 9),
    };
  }

  return {
    type: 'static',
    amplitude: 0,
    speed: 0,
    phase: 0,
    rotateAmplitude: 0,
  };
}

function lerp(min, max, t) {
  return min + (max - min) * t;
}

function getDifficultyProgress(y) {
  const climbed = Math.max(0, JUMP_GAME_SETTINGS.startLineY - y);
  return clamp(climbed / JUMP_GAME_SETTINGS.difficultyHeightRange, 0, 1);
}

function getPlatformProfile(y) {
  const progress = getDifficultyProgress(y);
  return {
    progress,
    widthMin: lerp(JUMP_GAME_SETTINGS.platformWidthMin, JUMP_GAME_SETTINGS.platformWidthMinLate, progress),
    widthMax: lerp(JUMP_GAME_SETTINGS.platformWidthMax, JUMP_GAME_SETTINGS.platformWidthMaxLate, progress),
    pathShift: lerp(JUMP_GAME_SETTINGS.pathShiftMin, JUMP_GAME_SETTINGS.pathShiftMax, progress),
    pathRequiredShift: lerp(JUMP_GAME_SETTINGS.pathRequiredShiftMin, JUMP_GAME_SETTINGS.pathRequiredShiftMax, progress),
  };
}

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.jumpGame = null;
    this.jumpLoop = null;
    this.factoryGame = null;
    this.factoryLoop = null;
  }

  // Returns [{ws, player}] for all connected, registered players
  _getSessions() {
    return this.state.getWebSockets()
      .map(ws => ({ ws, player: ws.deserializeAttachment() }))
      .filter(({ player }) => player != null);
  }

  _getLobbySessions() {
    return this._getSessions().filter(({ player }) => player.role !== 'game');
  }

  _getGameSessions(gameId) {
    return this._getSessions().filter(({ player }) => player.role === 'game' && player.gameId === gameId);
  }

  _getJumpSessions({ spectators = null } = {}) {
    return this._getGameSessions('jump-climber').filter(({ player }) => {
      if (spectators == null) return true;
      return Boolean(player.isSpectator) === spectators;
    });
  }

  _broadcastAll(msg) {
    const text = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      try { ws.send(text); } catch { /* ignore closed */ }
    }
  }

  _broadcastExcept(msg, excludeWs) {
    const text = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      if (ws === excludeWs) continue;
      try { ws.send(text); } catch { /* ignore closed */ }
    }
  }

  _broadcastGame(msg, gameId = 'jump-climber', { spectators = null } = {}) {
    const text = JSON.stringify(msg);
    for (const { ws, player } of this._getGameSessions(gameId)) {
      if (spectators != null && Boolean(player.isSpectator) !== spectators) continue;
      try { ws.send(text); } catch { /* ignore closed */ }
    }
  }

  _buildGameVotes(sessions) {
    const tally = {};
    for (const { player } of sessions) {
      if (player.gameVote) tally[player.gameVote] = (tally[player.gameVote] || 0) + 1;
    }
    return tally;
  }

  _buildRankedScores(scores) {
    return Object.values(scores)
      .sort((a, b) => b.score - a.score)
      .map((entry, i) => ({ ...entry, rank: i + 1 }));
  }

  _createJumpPlayer(rosterPlayer, slot, totalPlayers, previous = null) {
    const positions = totalPlayers === 1 ? [228] : [155, 300];
    return {
      id: rosterPlayer.id,
      name: rosterPlayer.name,
      slot,
      colorIndex: rosterPlayer.colorIndex,
      characterId: previous?.characterId || 'mochi-rabbit',
      connected: previous?.connected || false,
      inputDirection: 0,
      x: positions[slot] ?? 228,
      y: JUMP_GAME_SETTINGS.startLineY - JUMP_GAME_SETTINGS.playerSpawnOffset - slot * 10,
      width: 46,
      height: 46,
      vx: 0,
      vy: JUMP_GAME_SETTINGS.normalJump,
      bestHeight: 0,
      alive: true,
    };
  }

  _getTopmostJumpPlatform() {
    if (!this.jumpGame || this.jumpGame.platforms.length === 0) return null;
    return this.jumpGame.platforms.reduce(
      (top, platform) => (platform.y < top.y ? platform : top),
      this.jumpGame.platforms[0]
    );
  }

  _createJumpPlatform(game, y, isBase = false, anchorPlatform = null) {
    const profile = getPlatformProfile(y);
    const width = isBase
      ? 200
      : Math.round(randomBetween(profile.widthMin, profile.widthMax));

    let x;
    if (isBase) {
      x = (JUMP_GAME_SETTINGS.worldWidth - width) / 2;
    } else {
      const reference = anchorPlatform || this._getTopmostJumpPlatform();
      const referenceCenter = reference ? reference.x + reference.width / 2 : JUMP_GAME_SETTINGS.worldWidth / 2;
      const centerBias = (JUMP_GAME_SETTINGS.worldWidth / 2 - referenceCenter) * 0.12;
      const direction = Math.random() < 0.5 ? -1 : 1;
      const signedShift = direction * randomBetween(profile.pathRequiredShift, profile.pathShift);
      const nextCenter = clamp(
        referenceCenter + centerBias + signedShift,
        width / 2 + JUMP_GAME_SETTINGS.safePlatformInset,
        JUMP_GAME_SETTINGS.worldWidth - width / 2 - JUMP_GAME_SETTINGS.safePlatformInset
      );
      x = nextCenter - width / 2;
    }
    const kind = isBase ? 'base' : PLATFORM_KINDS[Math.floor(Math.random() * PLATFORM_KINDS.length)];
    const motion = isBase
      ? { type: 'static', amplitude: 0, speed: 0, phase: 0, rotateAmplitude: 0 }
      : createPlatformMotion();
    const platform = {
      id: `platform-${game.nextPlatformId++}`,
      x,
      y,
      width,
      height: 18,
      kind,
      baseX: x,
      rotation: 0,
      motion,
    };

    if (!isBase && motion.type === 'static' && Math.random() < 0.2) {
      this._spawnJumpBoost(game, platform);
    }

    return platform;
  }

  _spawnJumpBoost(game, platform) {
    const kind = Math.random() < 0.5 ? 'rocket' : 'star';
    game.boosts.push({
      id: `boost-${game.nextBoostId++}`,
      x: platform.x + platform.width / 2 - 30,
      y: platform.y - 68,
      size: 60,
      kind,
    });
  }

  _ensureJumpGame(roster) {
    if (this.jumpGame) return this.jumpGame;

    const participants = roster
      .slice(0, JUMP_SESSION_LIMITS.players)
      .map((player, slot) => ({ ...player, slot }));
    this.jumpGame = {
      roster: participants,
      expectedPlayers: participants.length,
      players: {},
      platforms: [],
      boosts: [],
      cameraY: 0,
      elapsedMs: 0,
      nextPlatformId: 1,
      nextBoostId: 1,
      messageSeq: 0,
      running: false,
      worldDirty: true,
    };

    participants.forEach((player, slot) => {
      this.jumpGame.players[player.id] = this._createJumpPlayer(player, slot, participants.length);
    });

    this._resetJumpGameWorld();
    return this.jumpGame;
  }

  _resetJumpGameWorld() {
    if (!this.jumpGame) return;

    const previousPlayers = this.jumpGame.players || {};
    const roster = this.jumpGame.roster;
    this.jumpGame.platforms = [];
    this.jumpGame.boosts = [];
    this.jumpGame.cameraY = 0;
    this.jumpGame.nextPlatformId = 1;
    this.jumpGame.nextBoostId = 1;
    this.jumpGame.elapsedMs = 0;
    this.jumpGame.messageSeq = 0;
    this.jumpGame.players = {};
    this.jumpGame.running = false;
    this.jumpGame.worldDirty = true;

    roster.forEach((player, slot) => {
      this.jumpGame.players[player.id] = this._createJumpPlayer(
        player,
        slot,
        roster.length,
        previousPlayers[player.id]
      );
    });

    const base = this._createJumpPlatform(this.jumpGame, JUMP_GAME_SETTINGS.startLineY, true);
    this.jumpGame.platforms.push(base);
    let lastPlatform = base;

    for (let i = 1; i < 32; i += 1) {
      const platform = this._createJumpPlatform(
        this.jumpGame,
        JUMP_GAME_SETTINGS.startLineY - i * JUMP_GAME_SETTINGS.platformGap,
        false,
        lastPlatform
      );
      this.jumpGame.platforms.push(platform);
      lastPlatform = platform;
    }
  }

  _serializeJumpPlatform(platform) {
    return {
      id: platform.id,
      kind: platform.kind,
      width: platform.width,
      height: platform.height,
      y: platform.y,
      baseX: platform.baseX,
      motion: platform.motion ? { ...platform.motion } : null,
    };
  }

  _serializeJumpBoost(boost) {
    return { ...boost };
  }

  _buildJumpStateMessage(type, { includeWorld = false } = {}) {
    if (!this.jumpGame) return null;
    const shouldIncludeWorld = type === 'jump_init' || includeWorld;

    const message = {
      type,
      protocol: JUMP_PROTOCOL_VERSION,
      mode: type === 'jump_init' ? 'full' : 'patch',
      seq: this.jumpGame.messageSeq,
      running: this.jumpGame.running,
      waitingFor: Math.max(0, this.jumpGame.expectedPlayers - this._getJumpSessions({ spectators: false }).length),
      expectedPlayers: this.jumpGame.expectedPlayers,
      cameraY: this.jumpGame.cameraY,
      elapsedMs: this.jumpGame.elapsedMs,
      players: this.jumpGame.roster.map(({ id }) => ({ ...this.jumpGame.players[id] })),
    };

    if (shouldIncludeWorld) {
      message.platforms = this.jumpGame.platforms.map((platform) => this._serializeJumpPlatform(platform));
      message.boosts = this.jumpGame.boosts.map((boost) => this._serializeJumpBoost(boost));
    }

    return message;
  }

  _updateJumpPlatformMotion() {
    if (!this.jumpGame) return;
    const time = this.jumpGame.elapsedMs / 1000;

    this.jumpGame.platforms.forEach((platform) => {
      if (!platform.motion || platform.motion.type === 'static') {
        platform.x = platform.baseX;
        platform.rotation = 0;
        return;
      }

      const wave = Math.sin(time * platform.motion.speed + platform.motion.phase);
      platform.x = platform.baseX + (platform.motion.type === 'drift' ? wave * platform.motion.amplitude : 0);
      platform.rotation = wave * platform.motion.rotateAmplitude;
    });
  }

  _sendJumpInit(ws) {
    const init = this._buildJumpStateMessage('jump_init');
    if (!init) return;
    ws.send(JSON.stringify(init));
  }

  _broadcastJumpPatch({ forceSpectators = false } = {}) {
    if (!this.jumpGame) return;
    const includeWorld = Boolean(this.jumpGame.worldDirty);
    this.jumpGame.messageSeq += 1;
    const patch = this._buildJumpStateMessage('jump_patch', { includeWorld });
    if (!patch) return;
    this._broadcastGame(patch, 'jump-climber', { spectators: false });
    const shouldBroadcastToSpectators =
      forceSpectators ||
      !this.jumpGame.running ||
      includeWorld ||
      this.jumpGame.messageSeq % getJumpSpectatorPatchEvery() === 0;
    if (shouldBroadcastToSpectators) {
      this._broadcastGame(patch, 'jump-climber', { spectators: true });
    }
    this.jumpGame.worldDirty = false;
  }

  _startJumpLoop() {
    if (this.jumpLoop) clearInterval(this.jumpLoop);
    this.jumpLoop = setInterval(() => {
      this._tickJumpGame().catch(() => {});
    }, JUMP_GAME_SETTINGS.tickMs);
  }

  _stopJumpLoop() {
    if (this.jumpLoop) {
      clearInterval(this.jumpLoop);
      this.jumpLoop = null;
    }
  }

  _ensureJumpPlatformsAbove() {
    if (!this.jumpGame) return;
    let worldChanged = false;
    const previousPlatformCount = this.jumpGame.platforms.length;
    const previousBoostCount = this.jumpGame.boosts.length;

    while (Math.min(...this.jumpGame.platforms.map((platform) => platform.y)) > this.jumpGame.cameraY - 1500) {
      const topmost = this._getTopmostJumpPlatform();
      const newTop = topmost.y - JUMP_GAME_SETTINGS.platformGap;
      this.jumpGame.platforms.push(this._createJumpPlatform(this.jumpGame, newTop, false, topmost));
      worldChanged = true;
    }

    const cleanupLimit = this.jumpGame.cameraY + JUMP_GAME_SETTINGS.arenaHeight + 180;
    this.jumpGame.platforms = this.jumpGame.platforms.filter((platform) => platform.y <= cleanupLimit);
    this.jumpGame.boosts = this.jumpGame.boosts.filter((boost) => boost.y <= cleanupLimit);

    if (
      worldChanged ||
      this.jumpGame.platforms.length !== previousPlatformCount ||
      this.jumpGame.boosts.length !== previousBoostCount
    ) {
      this.jumpGame.worldDirty = true;
    }
  }

  _handleJumpLanding(player, previousY) {
    if (!this.jumpGame || !player.alive || player.vy <= 0) return;

    const feetNow = player.y + player.height;
    const feetBefore = previousY + player.height;

    for (const platform of this.jumpGame.platforms) {
      const horizontalHit = player.x + player.width > platform.x && player.x < platform.x + platform.width;
      const passedTop = feetBefore <= platform.y && feetNow >= platform.y;

      if (horizontalHit && passedTop) {
        player.y = platform.y - player.height;
        player.vy = JUMP_GAME_SETTINGS.normalJump;
        return;
      }
    }
  }

  _handleJumpBoostPickup(player) {
    if (!this.jumpGame || !player.alive) return;
    let pickedBoost = false;

    this.jumpGame.boosts = this.jumpGame.boosts.filter((boost) => {
      const intersects = !(
        player.x + player.width < boost.x ||
        player.x > boost.x + boost.size ||
        player.y + player.height < boost.y ||
        player.y > boost.y + boost.size
      );

      if (intersects) {
        player.vy = JUMP_GAME_SETTINGS.boostJump;
        pickedBoost = true;
        return false;
      }

      return true;
    });

    if (pickedBoost) {
      this.jumpGame.worldDirty = true;
    }
  }

  _updateJumpCamera(stepMs = JUMP_GAME_SETTINGS.tickMs) {
    if (!this.jumpGame) return;
    const alivePlayers = Object.values(this.jumpGame.players).filter((player) => player.alive);
    if (alivePlayers.length === 0) return;

    const lowestVisiblePlayerY = Math.max(...alivePlayers.map((player) => player.y));
    const target = Math.min(this.jumpGame.cameraY, lowestVisiblePlayerY - 320);
    this.jumpGame.cameraY += (target - this.jumpGame.cameraY) * getStepBlend(0.16, stepMs);
  }

  _tickJumpPlayer(player, stepScale) {
    if (!this.jumpGame || !player.alive) return;

    player.vx = player.inputDirection * JUMP_GAME_SETTINGS.moveSpeed;
    player.x += player.vx * stepScale;
    player.x = clamp(player.x, 0, JUMP_GAME_SETTINGS.worldWidth - player.width);

    const previousY = player.y;
    player.vy += JUMP_GAME_SETTINGS.gravity * stepScale;
    player.y += player.vy * stepScale;

    this._handleJumpLanding(player, previousY);
    this._handleJumpBoostPickup(player);

    const climbed = Math.max(0, Math.round((JUMP_GAME_SETTINGS.startLineY - player.y) / 10));
    player.bestHeight = Math.max(player.bestHeight, climbed);

    if (player.y > this.jumpGame.cameraY + JUMP_GAME_SETTINGS.arenaHeight + 140) {
      player.alive = false;
      player.vx = 0;
      player.vy = 0;
    }
  }

  async _finishJumpGame() {
    if (!this.jumpGame) return;

    this.jumpGame.running = false;
    this._stopJumpLoop();

    const scores = {};
    this.jumpGame.roster.forEach(({ id }) => {
      const player = this.jumpGame.players[id];
      scores[id] = {
        name: player.name,
        score: player.bestHeight,
        colorIndex: player.colorIndex,
        slot: player.slot,
        characterId: player.characterId,
      };
    });

    await this.state.storage.put('scores', scores);
    await this.state.storage.put('phase', 'results');

    const ranked = this._buildRankedScores(scores);
    this._broadcastGame({
      type: 'scoreboard',
      results: ranked,
      submitted: ranked.length,
      total: this.jumpGame.expectedPlayers,
      final: true,
    }, 'jump-climber');
  }

  async _tickJumpGame() {
    if (!this.jumpGame || !this.jumpGame.running) return;

    this._ensureJumpPlatformsAbove();
    const players = Object.values(this.jumpGame.players);
    const substepMs = getJumpSubstepMs();
    const stepScale = getJumpStepScale(substepMs);
    const substepCount = getJumpSubstepCount();

    for (let step = 0; step < substepCount; step += 1) {
      this.jumpGame.elapsedMs += substepMs;
      this._updateJumpPlatformMotion();
      players.forEach((player) => this._tickJumpPlayer(player, stepScale));
      this._updateJumpCamera(substepMs);

      if (players.every((player) => !player.alive)) {
        break;
      }
    }

    this._broadcastJumpPatch();

    if (players.every((player) => !player.alive)) {
      await this._finishJumpGame();
    }
  }

  async _handleJoinGame(ws, msg) {
    if (msg.gameId === 'mallang-factory') {
      return await this._handleFactoryJoinGame(ws, msg);
    }

    const currentGame = (await this.state.storage.get('currentGame')) || null;
    const phase = (await this.state.storage.get('phase')) || 'lobby';
    const fullRoster = (await this.state.storage.get('gameRoster')) || [];
    const playerRoster = fullRoster.slice(0, JUMP_SESSION_LIMITS.players);

    if (currentGame !== 'jump-climber' || msg.gameId !== 'jump-climber' || phase !== 'playing') {
      ws.send(JSON.stringify({ type: 'error', message: '지금은 말랑프렌즈 점프 실시간 방에 합류할 수 없습니다.' }));
      return;
    }

    const rosterPlayer = fullRoster.find((p) => p.id === msg.playerId) || null;
    if (!rosterPlayer) {
      ws.send(JSON.stringify({ type: 'error', message: '방 플레이어 정보가 맞지 않습니다. 대기실에서 다시 시작해 주세요.' }));
      return;
    }

    const game = this._ensureJumpGame(playerRoster);
    const isSpectator = !playerRoster.some((p) => p.id === msg.playerId);

    if (isSpectator) {
      const activeSpectators = this._getJumpSessions({ spectators: true })
        .filter(({ ws: sessionWs }) => sessionWs !== ws);
      if (activeSpectators.length >= JUMP_SESSION_LIMITS.spectators) {
        ws.send(JSON.stringify({ type: 'error', message: '관전 자리가 꽉 찼습니다. 최대 2명까지 관전 가능합니다.' }));
        return;
      }

      ws.serializeAttachment({
        ...rosterPlayer,
        role: 'game',
        gameId: 'jump-climber',
        isSpectator: true,
      });
      ws.send(JSON.stringify({ type: 'jump_joined', role: 'spectator' }));
      this._sendJumpInit(ws);
      return;
    }

    const player = game.players[rosterPlayer.id];
    player.connected = true;
    player.inputDirection = 0;
    player.characterId = msg.characterId || player.characterId;

    ws.serializeAttachment({
      ...rosterPlayer,
      role: 'game',
      gameId: 'jump-climber',
      slot: player.slot,
      characterId: player.characterId,
      isSpectator: false,
    });

    ws.send(JSON.stringify({ type: 'jump_joined', role: 'player', slot: player.slot }));

    const connectedPlayers = this._getJumpSessions({ spectators: false }).length;
    if (connectedPlayers >= game.expectedPlayers && !game.running) {
      game.running = true;
      this._startJumpLoop();
    }

    this._sendJumpInit(ws);
    this._broadcastJumpPatch();
  }

  _handlePlayerInput(player, msg) {
    if (!this.jumpGame || player.role !== 'game' || player.gameId !== 'jump-climber') return;
    if (player.isSpectator) return;
    const target = this.jumpGame.players[player.id];
    if (!target) return;
    target.inputDirection = clamp(Number(msg.direction) || 0, -1, 1);
  }

  // ── fetch ──────────────────────────────────────────────────────────────────

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/init') {
      const { code } = await request.json();
      await this.state.storage.put('code', code);
      return new Response('OK');
    }

    const upgrade = request.headers.get('Upgrade');
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ── WebSocket event handlers ────────────────────────────────────────────────

  async webSocketMessage(ws, rawMsg) {
    let msg;
    try { msg = JSON.parse(rawMsg); } catch { return; }

    const player = ws.deserializeAttachment();

    switch (msg.type) {
      case 'join':      await this._handleJoin(ws, msg);                        break;
      case 'join_game': await this._handleJoinGame(ws, msg);                    break;
      case 'chat':      if (player) await this._handleChat(player, msg);        break;
      case 'vote_game':     if (player) await this._handleVoteGame(ws, player, msg);      break;
      case 'vote_start':    if (player) await this._handleVoteStart(ws, player, msg);     break;
      case 'player_input':  if (player) this._handlePlayerInput(player, msg);             break;
      case 'submit_result': if (player) await this._handleSubmitResult(player, msg);      break;
      case 'rematch':       if (player) await this._handleRematch();                       break;
      // ── 팩토리 게임 액션 ──
      case 'FACTORY_READY':
        if (player) await this._handleFactoryReady(player);
        break;
      case 'ASSIGN_ORDER_TO_WORKBENCH':
        if (player) this._handleFactoryAssign(player, msg);
        break;
      case 'ADD_PART':
        if (player) this._handleFactoryAddPart(player, msg);
        break;
      case 'CLEAR_WORKBENCH':
        if (player) this._handleFactoryClear(player, msg);
        break;
      case 'HELP_ASSEMBLY':
        if (player) this._handleFactoryHelp(player, msg);
        break;
      case 'DELIVER':
        if (player) await this._handleFactoryDeliver(player, msg);
        break;
      case 'SELECT_ORDER':
        if (player) this._handleFactorySelectOrder(player, msg);
        break;
      case 'SELECT_WORKBENCH':
        if (player) this._handleFactorySelectWorkbench(player, msg);
        break;
      case 'ping':
        ws.send(JSON.stringify({
          type: 'pong',
          pingId: Number.isFinite(msg.pingId) ? msg.pingId : null,
          clientTimeMs: Number.isFinite(msg.clientTimeMs) ? msg.clientTimeMs : null,
          elapsedMs: this.jumpGame ? this.jumpGame.elapsedMs : null,
        }));
        break;
    }
  }

  async webSocketClose(ws) { await this._removePlayer(ws); }
  async webSocketError(ws) { await this._removePlayer(ws); }

  // ── Message handlers ────────────────────────────────────────────────────────

  async _handleJoin(ws, msg) {
    const name = (msg.name || '플레이어').slice(0, 32);

    let colorIndex = (await this.state.storage.get('colorIndex')) || 0;
    const color = COLORS[colorIndex % COLORS.length];
    await this.state.storage.put('colorIndex', colorIndex + 1);

    const playerData = { id: randomHex(6), name, color, colorIndex, gameVote: null, startVote: false, role: 'lobby' };
    ws.serializeAttachment(playerData);

    const sessions  = this._getLobbySessions();
    const players   = sessions.map(s => s.player);
    const chatLog   = (await this.state.storage.get('chatLog')) || [];
    const code      = (await this.state.storage.get('code')) || '';
    const phase     = (await this.state.storage.get('phase')) || 'lobby';
    const gameVotes = this._buildGameVotes(sessions);
    const currentGame = (await this.state.storage.get('currentGame')) || null;
    const scores = (await this.state.storage.get('scores')) || {};
    const results = phase === 'results' ? this._buildRankedScores(scores) : null;

    ws.send(JSON.stringify({ type: 'welcome', playerId: playerData.id, code, players, chatLog, gameVotes, phase, currentGame, results }));
    this._broadcastExcept({ type: 'player_joined', player: playerData }, ws);
    this._broadcastAll({ type: 'players_update', players });
  }

  async _handleChat(player, msg) {
    const text = (msg.text || '').slice(0, 256).trim();
    if (!text) return;

    const entry = { type: 'chat', playerId: player.id, name: player.name, colorIndex: player.colorIndex, text, ts: Date.now() };

    const chatLog = (await this.state.storage.get('chatLog')) || [];
    chatLog.push(entry);
    if (chatLog.length > 50) chatLog.shift();
    await this.state.storage.put('chatLog', chatLog);

    this._broadcastAll(entry);
  }

  async _handleVoteGame(ws, player, msg) {
    const gameId = msg.gameId || null;
    if (gameId && !GAME_PATHS[gameId]) return;

    ws.serializeAttachment({ ...player, gameVote: gameId });

    const sessions  = this._getLobbySessions();
    const gameVotes = this._buildGameVotes(sessions);
    this._broadcastAll({ type: 'game_vote_update', votes: gameVotes });
    await this._checkStartCondition(sessions);
  }

  async _handleVoteStart(ws, player, msg) {
    const vote = msg.vote !== false;
    ws.serializeAttachment({ ...player, startVote: vote });

    const sessions   = this._getLobbySessions();
    const startCount = sessions.filter(s => s.player.startVote).length;
    this._broadcastAll({ type: 'start_vote_update', count: startCount, total: sessions.length });
    await this._checkStartCondition(sessions);
  }

  async _checkStartCondition(sessions) {
    const phase = (await this.state.storage.get('phase')) || 'lobby';
    if (phase !== 'lobby') return;

    const total = sessions.length;
    if (total === 0) return;

    const startCount = sessions.filter(s => s.player.startVote).length;
    if (startCount <= total / 2) return;

    const tally = {};
    for (const { player } of sessions) {
      if (player.gameVote) tally[player.gameVote] = (tally[player.gameVote] || 0) + 1;
    }

    let topGame = null, topCount = 0;
    for (const [gameId, count] of Object.entries(tally)) {
      if (count > topCount) { topGame = gameId; topCount = count; }
    }

    if (!topGame || topCount <= total / 2) return;
    await this._startCountdown(topGame);
  }

  async _startCountdown(gameId) {
    await this.state.storage.put('currentGame', gameId);
    await this.state.storage.put('gameRoster', this._getLobbySessions().map(({ player }) => ({
      id: player.id,
      name: player.name,
      colorIndex: player.colorIndex,
      color: player.color,
    })));
    await this.state.storage.delete('scores');
    this.jumpGame = null;
    this._stopJumpLoop();
    await this.state.storage.put('phase', 'countdown');
    for (const seconds of [3, 2, 1]) {
      this._broadcastAll({ type: 'countdown', seconds });
      await new Promise(r => setTimeout(r, 1000));
    }
    await this.state.storage.put('phase', 'playing');
    this._broadcastAll({ type: 'game_start', gameId });
  }

  async _handleSubmitResult(player, msg) {
    const score = typeof msg.score === 'number' ? Math.max(0, msg.score) : 0;
    const scores = (await this.state.storage.get('scores')) || {};
    scores[player.id] = { name: player.name, score, colorIndex: player.colorIndex };
    await this.state.storage.put('scores', scores);

    const roster = (await this.state.storage.get('gameRoster')) || [];
    const total = Math.max(roster.length, Object.keys(scores).length);
    const submitted = Object.keys(scores).length;
    const ranked = this._buildRankedScores(scores);

    this._broadcastAll({ type: 'scoreboard', results: ranked, submitted, total, final: submitted >= total });

    if (submitted >= total) {
      await this.state.storage.put('phase', 'results');
    }
  }

  async _handleRematch() {
    await this.state.storage.delete('scores');
    await this.state.storage.delete('currentGame');
    await this.state.storage.delete('gameRoster');
    this.jumpGame = null;
    this._stopJumpLoop();
    // Reset player votes
    for (const { ws, player } of this._getLobbySessions()) {
      ws.serializeAttachment({ ...player, gameVote: null, startVote: false });
    }
    await this.state.storage.put('phase', 'lobby');
    const sessions = this._getLobbySessions();
    this._broadcastAll({
      type: 'room_state',
      phase: 'lobby',
      currentGame: null,
      players: sessions.map(s => s.player),
      gameVotes: {},
      startVotes: 0,
      results: [],
    });
  }

  async _removePlayer(ws) {
    const player = ws.deserializeAttachment();
    ws.serializeAttachment(null);
    if (!player) return;

    if (player.role === 'game' && player.gameId === 'jump-climber' && this.jumpGame?.players[player.id]) {
      const target = this.jumpGame.players[player.id];
      target.connected = false;
      target.inputDirection = 0;
      if (target.alive) {
        target.alive = false;
        target.vx = 0;
        target.vy = 0;
      }

      if (Object.values(this.jumpGame.players).every((entry) => !entry.alive)) {
        await this._finishJumpGame();
      } else {
        this._broadcastJumpPatch();
      }
      return;
    }

    const sessions = this._getLobbySessions(); // excludes the null'd player
    const players  = sessions.map(s => s.player);
    this._broadcastAll({ type: 'player_left', playerId: player.id, name: player.name });
    this._broadcastAll({ type: 'players_update', players });
  }

  // ── 팩토리 게임 메서드 ──────────────────────────────────────────────────────

  _getFactorySessions() {
    return this._getGameSessions('mallang-factory');
  }

  _broadcastFactory(msg) {
    this._broadcastGame(msg, 'mallang-factory');
  }

  _broadcastFactoryState() {
    if (!this.factoryGame) return;
    this._broadcastFactory({ type: 'STATE_SYNC', state: this.factoryGame });
  }

  async _handleFactoryJoinGame(ws, msg) {
    const currentGame = (await this.state.storage.get('currentGame')) || null;
    const phase       = (await this.state.storage.get('phase'))       || 'lobby';
    const fullRoster  = (await this.state.storage.get('gameRoster'))  || [];

    if (currentGame !== 'mallang-factory' || phase !== 'playing') {
      ws.send(JSON.stringify({ type: 'ERROR', message: '팩토리 게임이 아직 시작되지 않았습니다.' }));
      return;
    }

    const rosterPlayer = fullRoster.find(p => p.id === msg.playerId);
    if (!rosterPlayer) {
      ws.send(JSON.stringify({ type: 'ERROR', message: '플레이어 정보가 일치하지 않습니다.' }));
      return;
    }

    ws.serializeAttachment({
      ...rosterPlayer,
      role: 'game',
      gameId: 'mallang-factory',
      ready: false,
      selectedOrderId: null,
      selectedWorkbenchId: null,
    });

    if (!this.factoryGame) this._initFactoryGame(fullRoster.slice(0, 2));

    // 플레이어가 현재 상태 즉시 수신
    ws.send(JSON.stringify({ type: 'STATE_SYNC', state: this.factoryGame }));
  }

  _initFactoryGame(roster) {
    const orders = [
      factoryMakeOrder('o1'),
      factoryMakeOrder('o2'),
    ];
    const workbenches = [
      factoryMakeWorkbench('wb1'),
      factoryMakeWorkbench('wb2'),
    ];
    this.factoryGame = {
      phase: 'waiting',   // waiting | playing | finished
      players: roster.map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        colorIndex: p.colorIndex,
        selectedOrderId: null,
        selectedWorkbenchId: null,
      })),
      timeLeft: FACTORY_CONFIG.roundSec,
      score: 0,
      ordersCompleted: 0,
      perfectCount: 0,
      currentStreak: 0,
      maxStreak: 0,
      mostMade: {},
      orders,
      workbenches,
      nextOrderSeq: 3,
    };
  }

  async _handleFactoryReady(player) {
    if (!this.factoryGame) return;

    // 플레이어 ready 상태 업데이트
    const factoryPlayer = this.factoryGame.players.find(p => p.id === player.id);
    if (factoryPlayer) factoryPlayer.ready = true;

    // 세션의 WS attachment도 업데이트
    const session = this._getFactorySessions().find(s => s.player.id === player.id);
    if (session) session.ws.serializeAttachment({ ...session.player, ready: true });

    const allReady = this.factoryGame.players.every(p => p.ready);
    if (allReady && this.factoryGame.phase === 'waiting') {
      this._startFactoryGame();
    } else {
      this._broadcastFactoryState();
    }
  }

  _startFactoryGame() {
    if (!this.factoryGame) return;
    this.factoryGame.phase = 'playing';
    this.factoryGame.startedAt = Date.now();
    this._broadcastFactoryState();
    this._startFactoryLoop();
  }

  _startFactoryLoop() {
    if (this.factoryLoop) clearInterval(this.factoryLoop);
    this.factoryLoop = setInterval(() => {
      this._tickFactory().catch(() => {});
    }, FACTORY_CONFIG.tickMs);
  }

  async _tickFactory() {
    const fg = this.factoryGame;
    if (!fg || fg.phase !== 'playing') return;

    fg.timeLeft = Math.max(0, fg.timeLeft - 1);

    // 조립 완료 체크
    const now = Date.now();
    for (const wb of fg.workbenches) {
      if (wb.state === 'assembling' && wb.assemblyEndsAt && now >= wb.assemblyEndsAt) {
        wb.state = 'completed';
        wb.assemblyEndsAt = null;
        this._broadcastFactory({ type: 'EVENT', event: 'ASSEMBLY_DONE', payload: { workbenchId: wb.id } });
      }
    }

    if (fg.timeLeft <= 0) {
      await this._finishFactory();
      return;
    }

    this._broadcastFactoryState();
  }

  async _finishFactory() {
    const fg = this.factoryGame;
    if (!fg) return;
    fg.phase = 'finished';
    if (this.factoryLoop) { clearInterval(this.factoryLoop); this.factoryLoop = null; }
    this._broadcastFactoryState();

    // 결과를 lobby scores에 저장
    const scores = (await this.state.storage.get('scores')) || {};
    for (const p of fg.players) {
      scores[p.id] = { id: p.id, name: p.name, color: p.color, score: fg.score };
    }
    await this.state.storage.put('scores', scores);
    await this.state.storage.put('phase', 'results');
  }

  _handleFactorySelectOrder(player, msg) {
    if (!this.factoryGame || this.factoryGame.phase !== 'playing') return;
    const fp = this.factoryGame.players.find(p => p.id === player.id);
    if (fp) fp.selectedOrderId = msg.orderId ?? null;
    this._broadcastFactoryState();
  }

  _handleFactorySelectWorkbench(player, msg) {
    if (!this.factoryGame || this.factoryGame.phase !== 'playing') return;
    const fp = this.factoryGame.players.find(p => p.id === player.id);
    if (fp) fp.selectedWorkbenchId = msg.workbenchId ?? null;
    this._broadcastFactoryState();
  }

  _handleFactoryAssign(player, msg) {
    const fg = this.factoryGame;
    if (!fg || fg.phase !== 'playing') return;
    const { orderId, workbenchId } = msg;
    const order = fg.orders.find(o => o.id === orderId && o.status === 'active');
    const wb    = fg.workbenches.find(w => w.id === workbenchId);
    if (!order || !wb || wb.state !== 'idle') return;

    const recipe = FACTORY_RECIPES.find(r => r.id === order.recipeId);
    if (!recipe) return;

    wb.assignedOrderId = orderId;
    wb.recipeId = order.recipeId;
    wb.parts = [];
    wb.helpedBy = [];

    const fp = fg.players.find(p => p.id === player.id);
    if (fp) { fp.selectedOrderId = orderId; fp.selectedWorkbenchId = workbenchId; }

    this._broadcastFactory({ type: 'EVENT', event: 'ORDER_ASSIGNED', payload: { orderId, workbenchId, playerName: player.name } });
    this._broadcastFactoryState();
  }

  _handleFactoryAddPart(player, msg) {
    const fg = this.factoryGame;
    if (!fg || fg.phase !== 'playing') return;
    const { workbenchId, partId } = msg;
    const wb = fg.workbenches.find(w => w.id === workbenchId);
    if (!wb || wb.state !== 'idle' || !wb.recipeId) return;

    const recipe = FACTORY_RECIPES.find(r => r.id === wb.recipeId);
    if (!recipe || !recipe.parts.includes(partId)) return;

    // 이미 넣은 자재 중복 체크
    const needed = recipe.parts.filter(p => p !== wb.parts.find(ep => ep === p));
    if (!needed.includes(partId)) return;

    wb.parts.push(partId);
    this._broadcastFactory({ type: 'EVENT', event: 'PART_ADDED', payload: { workbenchId, partId, playerName: player.name } });

    // 모든 자재가 다 들어오면 조립 시작
    const allFilled = recipe.parts.every(p => {
      const count = wb.parts.filter(ep => ep === p).length;
      const needed_ = recipe.parts.filter(ep => ep === p).length;
      return count >= needed_;
    });

    if (allFilled) {
      this._startAssembly(wb, recipe);
    }
    this._broadcastFactoryState();
  }

  _startAssembly(wb, recipe) {
    const baseSec = FACTORY_CONFIG.assemblyBaseSec[recipe.id] ?? 10;
    wb.state = 'assembling';
    wb.assemblyEndsAt = Date.now() + baseSec * 1000;
    wb.helpedBy = [];
  }

  _handleFactoryHelp(player, msg) {
    const fg = this.factoryGame;
    if (!fg || fg.phase !== 'playing') return;
    const wb = fg.workbenches.find(w => w.id === msg.workbenchId);
    if (!wb || wb.state !== 'assembling') return;
    if (wb.helpedBy.includes(player.id)) return;
    wb.helpedBy.push(player.id);
    this._broadcastFactory({ type: 'EVENT', event: 'HELPED', payload: { workbenchId: wb.id, playerName: player.name } });
    this._broadcastFactoryState();
  }

  _handleFactoryClear(player, msg) {
    const fg = this.factoryGame;
    if (!fg || fg.phase !== 'playing') return;
    const wb = fg.workbenches.find(w => w.id === msg.workbenchId);
    if (!wb || wb.state === 'assembling' || wb.state === 'completed') return;
    wb.assignedOrderId = null;
    wb.recipeId = null;
    wb.parts = [];
    wb.helpedBy = [];
    wb.state = 'idle';
    wb.assemblyEndsAt = null;
    this._broadcastFactoryState();
  }

  async _handleFactoryDeliver(player, msg) {
    const fg = this.factoryGame;
    if (!fg || fg.phase !== 'playing') return;
    const wb = fg.workbenches.find(w => w.id === msg.workbenchId);
    if (!wb || wb.state !== 'completed') return;

    const recipe = FACTORY_RECIPES.find(r => r.id === wb.recipeId);
    if (!recipe) return;

    // 품질 계산
    const helpers = wb.helpedBy.length;
    const qualityKey = helpers >= 2 ? 'perfect' : helpers === 1 ? 'good' : 'normal';
    const multiplier = FACTORY_CONFIG.qualityMultiplier[qualityKey];
    const reward = Math.round(recipe.reward * multiplier);

    fg.score += reward;
    fg.ordersCompleted += 1;
    fg.currentStreak += 1;
    if (fg.currentStreak > fg.maxStreak) fg.maxStreak = fg.currentStreak;
    if (qualityKey === 'perfect') fg.perfectCount += 1;
    fg.mostMade[recipe.id] = (fg.mostMade[recipe.id] || 0) + 1;

    // 완료된 주문을 새 주문으로 교체
    const orderIdx = fg.orders.findIndex(o => o.id === wb.assignedOrderId);
    if (orderIdx !== -1) {
      fg.orders[orderIdx] = factoryMakeOrder(`o${fg.nextOrderSeq++}`);
    }

    // 작업대 초기화
    wb.assignedOrderId = null;
    wb.recipeId = null;
    wb.parts = [];
    wb.state = 'idle';
    wb.helpedBy = [];
    wb.assemblyEndsAt = null;

    this._broadcastFactory({ type: 'EVENT', event: 'DELIVERED', payload: { reward, quality: qualityKey, playerName: player.name, recipeName: recipe.name } });
    this._broadcastFactoryState();
  }
}
