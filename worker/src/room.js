const COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#f59e0b',
  '#a855f7', '#ec4899', '#14b8a6', '#f97316',
];

// Keep in sync with /games/registry.js (browser can't import that file here)
const GAME_PATHS = {
  'jump-climber': '/prototypes/jump-climber/index.html',
  'mallang-tug-war': '/prototypes/mallang-tug-war/index.html',
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
  monsterSize: 280,
  monsterSpeed: 1.05,
  monsterSpawnIntervalMinMs: 5000,
  monsterSpawnIntervalMaxMs: 9500,
  monsterFirstSpawnDelayMs: 3000,
  monsterBobAmplitude: 14,
  monsterTurnIntervalMinMs: 1400,
  monsterTurnIntervalMaxMs: 2800,
  monsterLifetimeMs: 9000,
};

const PLATFORM_KINDS = ['leaf', 'cloud', 'cake'];

// 모든 캐릭터 ID와 특성. 신규 2종(latte-puppy, mint-kitten)은 클라 UI에선 랜덤으로만 등장.
const JUMP_CHARACTERS = [
  'mochi-rabbit',
  'pudding-hamster',
  'peach-chick',
  'latte-puppy',
  'mint-kitten',
];

const JUMP_CHARACTER_ABILITIES = {
  'mochi-rabbit':    { jumpMul: 1.06, gravityMul: 1.00, moveMul: 1.00, boostMul: 1.00, superJumpEvery: 0 },
  'pudding-hamster': { jumpMul: 1.00, gravityMul: 1.00, moveMul: 1.18, boostMul: 1.00, superJumpEvery: 0 },
  'peach-chick':     { jumpMul: 1.00, gravityMul: 0.85, moveMul: 1.00, boostMul: 1.00, superJumpEvery: 0 },
  'latte-puppy':     { jumpMul: 1.00, gravityMul: 1.00, moveMul: 1.00, boostMul: 1.00, superJumpEvery: 3 },
  'mint-kitten':     { jumpMul: 1.00, gravityMul: 1.00, moveMul: 1.00, boostMul: 1.50, superJumpEvery: 0 },
};

const JUMP_DEFAULT_ABILITIES = JUMP_CHARACTER_ABILITIES['mochi-rabbit'];

function getJumpAbilities(characterId) {
  return JUMP_CHARACTER_ABILITIES[characterId] || JUMP_DEFAULT_ABILITIES;
}

function sanitizeJumpCharacterId(characterId, fallback = 'mochi-rabbit') {
  return JUMP_CHARACTERS.includes(characterId) ? characterId : fallback;
}
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
    this.tugWarGame = null;
    this.tugWarLoop = null;
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
    const characterId = sanitizeJumpCharacterId(previous?.characterId || 'mochi-rabbit');
    const abilities = getJumpAbilities(characterId);
    return {
      id: rosterPlayer.id,
      name: rosterPlayer.name,
      slot,
      colorIndex: rosterPlayer.colorIndex,
      characterId,
      connected: previous?.connected || false,
      inputDirection: 0,
      x: positions[slot] ?? 228,
      y: JUMP_GAME_SETTINGS.startLineY - JUMP_GAME_SETTINGS.playerSpawnOffset - slot * 10,
      width: 46,
      height: 46,
      vx: 0,
      vy: JUMP_GAME_SETTINGS.normalJump * abilities.jumpMul,
      bestHeight: 0,
      alive: true,
      jumpCount: 0,
      bounceTag: 0,        // 클라 픽업/슈퍼점프 이펙트 트리거 (단조 증가, wraparound 256)
      lastBounceKind: null, // 'normal' | 'super' | 'boost'
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
      monsters: [],
      cameraY: 0,
      elapsedMs: 0,
      nextPlatformId: 1,
      nextBoostId: 1,
      nextMonsterId: 1,
      nextMonsterSpawnAtMs: JUMP_GAME_SETTINGS.monsterFirstSpawnDelayMs,
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
    this.jumpGame.monsters = [];
    this.jumpGame.cameraY = 0;
    this.jumpGame.nextPlatformId = 1;
    this.jumpGame.nextBoostId = 1;
    this.jumpGame.nextMonsterId = 1;
    this.jumpGame.nextMonsterSpawnAtMs = JUMP_GAME_SETTINGS.monsterFirstSpawnDelayMs;
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

  _serializeJumpMonster(monster) {
    return {
      id: monster.id,
      kind: monster.kind,
      x: monster.x,
      y: monster.y,
      size: monster.size,
      vx: monster.vx,
      vy: monster.vy,
    };
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
      monsters: this.jumpGame.monsters.map((m) => this._serializeJumpMonster(m)),
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
    const previousMonsterCount = this.jumpGame.monsters.length;

    while (Math.min(...this.jumpGame.platforms.map((platform) => platform.y)) > this.jumpGame.cameraY - 1500) {
      const topmost = this._getTopmostJumpPlatform();
      const newTop = topmost.y - JUMP_GAME_SETTINGS.platformGap;
      const platform = this._createJumpPlatform(this.jumpGame, newTop, false, topmost);
      this.jumpGame.platforms.push(platform);
      worldChanged = true;
    }

    const cleanupLimit = this.jumpGame.cameraY + JUMP_GAME_SETTINGS.arenaHeight + 180;
    this.jumpGame.platforms = this.jumpGame.platforms.filter((platform) => platform.y <= cleanupLimit);
    this.jumpGame.boosts = this.jumpGame.boosts.filter((boost) => boost.y <= cleanupLimit);
    // 몬스터는 cross-screen 흐름이라 _tickJumpMonsters에서 자체 cleanup

    if (
      worldChanged ||
      this.jumpGame.platforms.length !== previousPlatformCount ||
      this.jumpGame.boosts.length !== previousBoostCount ||
      this.jumpGame.monsters.length !== previousMonsterCount
    ) {
      this.jumpGame.worldDirty = true;
    }
  }

  _handleJumpLanding(player, previousY) {
    if (!this.jumpGame || !player.alive || player.vy <= 0) return;

    const feetNow = player.y + player.height;
    const feetBefore = previousY + player.height;

    for (const platform of this.jumpGame.platforms) {
      // 발판 PNG는 좌우에 투명 여백이 있어서 시각보다 hitbox가 더 넓음. 8% 인셋.
      const inset = platform.width * 0.08;
      const hitX = platform.x + inset;
      const hitW = platform.width - inset * 2;
      const horizontalHit = player.x + player.width > hitX && player.x < hitX + hitW;
      const passedTop = feetBefore <= platform.y && feetNow >= platform.y;

      if (horizontalHit && passedTop) {
        const abilities = getJumpAbilities(player.characterId);
        player.y = platform.y - player.height;
        player.jumpCount = (player.jumpCount || 0) + 1;
        const isSuperJump =
          abilities.superJumpEvery > 0 &&
          player.jumpCount % abilities.superJumpEvery === 0;
        player.vy = isSuperJump
          ? JUMP_GAME_SETTINGS.boostJump
          : JUMP_GAME_SETTINGS.normalJump * abilities.jumpMul;
        player.lastBounceKind = isSuperJump ? 'super' : 'normal';
        player.bounceTag = ((player.bounceTag || 0) + 1) & 0xff;
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
        const abilities = getJumpAbilities(player.characterId);
        player.vy = JUMP_GAME_SETTINGS.boostJump * abilities.boostMul;
        player.lastBounceKind = 'boost';
        player.bounceTag = ((player.bounceTag || 0) + 1) & 0xff;
        pickedBoost = true;
        return false;
      }

      return true;
    });

    if (pickedBoost) {
      this.jumpGame.worldDirty = true;
    }
  }

  // ── 몬스터: 가장자리 바깥에서 등장 → 랜덤 방향으로 떠돌이 → 수명 끝나거나 화면 밖으로 사라짐 ──
  _initialMonsterAngle(direction) {
    // direction=1 (왼→오): -π/3 ~ π/3 사이 (오른쪽 반구)
    // direction=-1 (오→왼): 2π/3 ~ 4π/3 사이 (왼쪽 반구)
    const span = (Math.PI * 2) / 3;
    if (direction === 1) {
      return -span / 2 + Math.random() * span;
    }
    return Math.PI - span / 2 + Math.random() * span;
  }

  _spawnEdgeMonster(game) {
    const size = JUMP_GAME_SETTINGS.monsterSize;
    const direction = Math.random() < 0.5 ? -1 : 1;
    const x = direction === 1 ? -size : JUMP_GAME_SETTINGS.worldWidth;
    const y = game.cameraY + (0.15 + Math.random() * 0.4) * JUMP_GAME_SETTINGS.arenaHeight;
    const kind = Math.random() < 0.55 ? 'cloud_imp' : 'fluff_ghost';
    const angle = this._initialMonsterAngle(direction);
    const speed = JUMP_GAME_SETTINGS.monsterSpeed;
    game.monsters.push({
      id: `monster-${game.nextMonsterId++}`,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size,
      kind,
      spawnY: y,
      spawnTimeMs: game.elapsedMs,
      nextTurnAtMs: game.elapsedMs + randomBetween(
        JUMP_GAME_SETTINGS.monsterTurnIntervalMinMs,
        JUMP_GAME_SETTINGS.monsterTurnIntervalMaxMs
      ),
    });
    game.worldDirty = true;
  }

  _tickJumpMonsters(stepMs) {
    if (!this.jumpGame) return;
    const game = this.jumpGame;
    const stepScale = getJumpStepScale(stepMs);
    const speed = JUMP_GAME_SETTINGS.monsterSpeed;

    const before = game.monsters.length;
    game.monsters = game.monsters.filter((m) => {
      // 일정 간격마다 랜덤 방향 재선정 (8방향 비편향 랜덤)
      if (game.elapsedMs >= m.nextTurnAtMs) {
        const angle = Math.random() * Math.PI * 2;
        m.vx = Math.cos(angle) * speed;
        m.vy = Math.sin(angle) * speed;
        m.nextTurnAtMs = game.elapsedMs + randomBetween(
          JUMP_GAME_SETTINGS.monsterTurnIntervalMinMs,
          JUMP_GAME_SETTINGS.monsterTurnIntervalMaxMs
        );
      }

      m.x += m.vx * stepScale;
      m.y += m.vy * stepScale;

      const margin = JUMP_GAME_SETTINGS.monsterSize * 1.3;
      const aged = (game.elapsedMs - m.spawnTimeMs) > JUMP_GAME_SETTINGS.monsterLifetimeMs;
      const offscreen = m.x < -margin || m.x > JUMP_GAME_SETTINGS.worldWidth + margin;
      const fellBehind = m.y > game.cameraY + JUMP_GAME_SETTINGS.arenaHeight + 200;
      const tooHigh = m.y < game.cameraY - JUMP_GAME_SETTINGS.arenaHeight;
      return !(aged || offscreen || fellBehind || tooHigh);
    });
    if (game.monsters.length !== before) game.worldDirty = true;

    if (game.elapsedMs >= game.nextMonsterSpawnAtMs) {
      this._spawnEdgeMonster(game);
      game.nextMonsterSpawnAtMs = game.elapsedMs + randomBetween(
        JUMP_GAME_SETTINGS.monsterSpawnIntervalMinMs,
        JUMP_GAME_SETTINGS.monsterSpawnIntervalMaxMs
      );
    }
  }

  _resolveMonsterCollisions(player, previousY) {
    if (!this.jumpGame || !player.alive || this.jumpGame.monsters.length === 0) return;

    // 몬스터 hitbox 모델 (PNG 외곽 투명 영역 고려해 시각 본체에 맞춤):
    //  - 가로 22% 인셋 (약 280 - 124 = 156px 너비, 본체 비율)
    //  - 세로는 22%~60% 구간 (약 106px 높이)
    //  - 위에서 발이 hitTop 통과 → 발판처럼 안착 + 점프 회복
    //  - 아래에서 머리 박힘 → 수평 push 없이 vy=0 (제자리 낙하)
    //  - 옆 박힘 → 수평 MTV
    const sizeInsetX = JUMP_GAME_SETTINGS.monsterSize * 0.22;
    const topInset = JUMP_GAME_SETTINGS.monsterSize * 0.22;
    const bodyHeight = JUMP_GAME_SETTINGS.monsterSize * 0.38;

    for (const m of this.jumpGame.monsters) {
      const hitX = m.x + sizeInsetX;
      const hitW = m.size - sizeInsetX * 2;
      const hitTop = m.y + topInset;
      const hitBottom = hitTop + bodyHeight;

      const horizontalHit = player.x + player.width > hitX && player.x < hitX + hitW;
      if (!horizontalHit) continue;

      // 위에서 떨어져 hitTop 통과 → 발판처럼 안착 + 일반 점프
      if (player.vy > 0) {
        const feetNow = player.y + player.height;
        const feetBefore = previousY + player.height;
        if (feetBefore <= hitTop && feetNow >= hitTop) {
          const abilities = getJumpAbilities(player.characterId);
          player.y = hitTop - player.height;
          player.jumpCount = (player.jumpCount || 0) + 1;
          const isSuperJump =
            abilities.superJumpEvery > 0 &&
            player.jumpCount % abilities.superJumpEvery === 0;
          player.vy = isSuperJump
            ? JUMP_GAME_SETTINGS.boostJump
            : JUMP_GAME_SETTINGS.normalJump * abilities.jumpMul;
          player.lastBounceKind = isSuperJump ? 'super' : 'normal';
          player.bounceTag = ((player.bounceTag || 0) + 1) & 0xff;
          continue;
        }
      }

      // 아래에서 머리 박힘 — 옆으로 밀지 않고 제자리에서 vy=0으로 떨어뜨림
      if (player.vy < 0) {
        const headNow = player.y;
        const headBefore = previousY;
        if (headBefore >= hitBottom && headNow <= hitBottom) {
          player.y = hitBottom;
          player.vy = 0;
          continue;
        }
      }

      // 옆 박힘 — MTV 수평 push
      const overlapY = Math.min(player.y + player.height, hitBottom) - Math.max(player.y, hitTop);
      if (overlapY <= 0) continue;
      const overlapX = Math.min(player.x + player.width, hitX + hitW) - Math.max(player.x, hitX);
      if (overlapX <= 0) continue;
      const playerCenter = player.x + player.width / 2;
      const monsterCenter = m.x + m.size / 2;
      if (playerCenter < monsterCenter) player.x -= overlapX;
      else player.x += overlapX;
      player.x = clamp(player.x, 0, JUMP_GAME_SETTINGS.worldWidth - player.width);
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

    const abilities = getJumpAbilities(player.characterId);

    player.vx = player.inputDirection * JUMP_GAME_SETTINGS.moveSpeed * abilities.moveMul;
    player.x += player.vx * stepScale;
    player.x = clamp(player.x, 0, JUMP_GAME_SETTINGS.worldWidth - player.width);

    const previousY = player.y;
    player.vy += JUMP_GAME_SETTINGS.gravity * abilities.gravityMul * stepScale;
    player.y += player.vy * stepScale;

    this._handleJumpLanding(player, previousY);
    this._handleJumpBoostPickup(player);
    this._resolveMonsterCollisions(player, previousY);

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
      this._tickJumpMonsters(substepMs);
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
    if (msg.gameId === 'mallang-tug-war') {
      return await this._handleTugWarJoinGame(ws, msg);
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
    player.characterId = sanitizeJumpCharacterId(msg.characterId || player.characterId, player.characterId || 'mochi-rabbit');
    // 게임 시작 전이면 새 캐릭터 능력에 맞게 초기 vy를 재계산 (createJumpPlayer는 default로 계산).
    if (!game.running) {
      const abilities = getJumpAbilities(player.characterId);
      player.vy = JUMP_GAME_SETTINGS.normalJump * abilities.jumpMul;
      player.jumpCount = 0;
    }

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

  async _handleTugWarJoinGame(ws, msg) {
    const fullRoster = (await this.state.storage.get('gameRoster')) || [];
    const playerRoster = fullRoster.slice(0, 2); // 1v1, first 2 roster entries are players
    const rosterPlayer = fullRoster.find((p) => p.id === msg.playerId) || null;

    if (!rosterPlayer) {
      ws.send(JSON.stringify({ type: 'error', message: '방 플레이어 정보가 맞지 않습니다.' }));
      return;
    }

    const isPlayer = playerRoster.some((p) => p.id === msg.playerId);
    const role = isPlayer ? 'player' : 'spectator';
    const side = isPlayer
      ? (playerRoster[0].id === msg.playerId ? 'left' : 'right')
      : undefined;

    ws.serializeAttachment({
      ...rosterPlayer,
      role: 'game',
      gameId: 'mallang-tug-war',
      isSpectator: !isPlayer,
    });

    ws.send(JSON.stringify({ type: 'TUG_JOINED', role, side }));

    // TODO: Phase B에서 게임 상태 초기화 + STATE_SYNC 브로드캐스트
  }

  async _handleTugWarReady(player, msg) {
    // TODO: Phase B에서 ready 상태 추적 + 양쪽 ready 시 카운트다운 시작
    console.log('[tug-war] TUG_READY received from', player.id, msg.ready);
  }

  async _handleTugWarSelectCharacter(player, msg) {
    // TODO: Phase B에서 캐릭터 ID 검증 + 상태 저장 + 브로드캐스트
    console.log('[tug-war] TUG_SELECT_CHARACTER', player.id, msg.characterId);
  }

  _handleTugWarTap(player, msg) {
    // TODO: Phase C에서 리듬 판정 + ropePos 업데이트
  }

  _handleTugWarItemGrab(player, msg) {
    // TODO: Phase E에서 아이템 효과 적용
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
      case 'TUG_READY':
        if (player?.gameId === 'mallang-tug-war') await this._handleTugWarReady(player, msg);
        break;
      case 'TUG_SELECT_CHARACTER':
        if (player?.gameId === 'mallang-tug-war') await this._handleTugWarSelectCharacter(player, msg);
        break;
      case 'TUG_TAP':
        if (player?.gameId === 'mallang-tug-war') this._handleTugWarTap(player, msg);
        break;
      case 'TUG_ITEM_GRAB':
        if (player?.gameId === 'mallang-tug-war') this._handleTugWarItemGrab(player, msg);
        break;
      case 'submit_result': if (player) await this._handleSubmitResult(player, msg);      break;
      case 'rematch':       if (player) await this._handleRematch();                       break;
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
    const requestedId = typeof msg.playerId === 'string' && msg.playerId ? msg.playerId : null;

    // 동일 playerId의 lobby 세션이 살아있으면 (페이지 nav 후 옛 ws가 아직 정리 안 된 상태),
    // 옛 ws는 닫고 그 세션의 식별 정보(id/color/votes)를 새 ws로 인계 → 자기 자신 복제 방지.
    let inherited = null;
    if (requestedId) {
      for (const session of this._getLobbySessions()) {
        if (session.player.id === requestedId && session.ws !== ws) {
          inherited = session.player;
          try { session.ws.close(4001, 'replaced'); } catch { /* ignore */ }
          session.ws.serializeAttachment(null);
          break;
        }
      }
    }

    let playerData;
    if (inherited) {
      playerData = { ...inherited, name, role: 'lobby' };
    } else {
      let colorIndex = (await this.state.storage.get('colorIndex')) || 0;
      const color = COLORS[colorIndex % COLORS.length];
      await this.state.storage.put('colorIndex', colorIndex + 1);
      playerData = { id: randomHex(6), name, color, colorIndex, gameVote: null, startVote: false, role: 'lobby' };
    }
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

    if (player.role === 'game' && player.gameId === 'mallang-tug-war' && this.tugWarGame) {
      // TODO: Phase B에서 disconnect 정리 (게임 중이면 abandoned로 종료)
    }

    const sessions = this._getLobbySessions(); // excludes the null'd player
    const players  = sessions.map(s => s.player);
    this._broadcastAll({ type: 'player_left', playerId: player.id, name: player.name });
    this._broadcastAll({ type: 'players_update', players });
  }


}
