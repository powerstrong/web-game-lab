const arena = document.getElementById("arena");
const worldEl = document.getElementById("world");
const setupScreen = document.getElementById("setupScreen");
const playScreen = document.getElementById("playScreen");
const statusEl = document.getElementById("status");
const setupHintEl = document.getElementById("setupHint");
const startButton = document.getElementById("startGame");
const restartButton = document.getElementById("restart");
const backToSetupButton = document.getElementById("backToSetup");
const playTitleEl = document.getElementById("playTitle");
const spectatorBadgeEl = document.getElementById("spectatorBadge");
const restartFromResultsButton = document.getElementById("restartFromResults");
const exitAfterResultsButton = document.getElementById("exitAfterResults");
const playerCountButtons = Array.from(document.querySelectorAll("[data-player-count]"));
const playerConfigCards = Array.from(document.querySelectorAll(".player-config"));
const hudCards = Array.from(document.querySelectorAll(".hud-card"));
const bestEls = [document.getElementById("best1"), document.getElementById("best2")];
const lifeEls = [document.getElementById("life1"), document.getElementById("life2")];
const resultsOverlay = document.getElementById("resultsOverlay");
const resultRows = Array.from(document.querySelectorAll("[data-result-slot]"));
const resultNameEls = [document.getElementById("resultName1"), document.getElementById("resultName2")];
const resultScoreEls = [document.getElementById("resultScore1"), document.getElementById("resultScore2")];
const resultLeadEl = document.getElementById("resultLead");
const chatOverlayEl = document.getElementById("chatOverlay");
const chatMessagesEl = document.getElementById("chatMessages");
const chatToggleBtn = document.getElementById("chatToggle");
const chatInputWrap = document.getElementById("chatInputWrap");
const chatInputEl = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSend");
const gameBoot = window.GameBoot || null;
const isRoomSession = Boolean(gameBoot && gameBoot.isMultiplayer);

function assetPath(fileName) {
  return `/assets/${encodeURIComponent(fileName)}`;
}

const CHARACTER_LIST = [
  {
    id: "mochi-rabbit",
    name: "모찌 토끼",
    faceBox: { left: 50, top: 34, size: 22 },
    assets: {
      preview: assetPath("토끼 오른쪽 점프.png"),
      jump_neutral: assetPath("토끼 점프 위로.png"),
      jump_left: assetPath("토끼 왼쪽 점프.png"),
      jump_right: assetPath("토끼 오른쪽 점프.png"),
      fall_neutral: assetPath("토끼 추락.png"),
    },
  },
  {
    id: "pudding-hamster",
    name: "푸딩 햄스터",
    faceBox: { left: 50, top: 35, size: 22 },
    assets: {
      preview: assetPath("햄스터 오른쪽.png"),
      jump_neutral: assetPath("햄스터 점프 위로.png"),
      jump_left: assetPath("햄스터 왼쪽.png"),
      jump_right: assetPath("햄스터 오른쪽.png"),
      fall_neutral: assetPath("햄스터 추락.png"),
    },
  },
  {
    id: "peach-chick",
    name: "말랑 병아리",
    faceBox: { left: 50, top: 34, size: 19 },
    assets: {
      preview: assetPath("병아리 오른쪽 점프.png"),
      jump_neutral: assetPath("병아리 점프.png"),
      jump_left: assetPath("병아리 왼쪽 점프.png"),
      jump_right: assetPath("병아리 오른쪽 점프.png"),
      fall_neutral: assetPath("병아리 추락.png"),
    },
  },
];

const CHARACTER_MAP = Object.fromEntries(CHARACTER_LIST.map((character) => [character.id, character]));
const PLATFORM_KINDS = ["leaf", "cloud", "cake"];
const BOOST_META = {
  rocket: { label: "UP", message: "로켓 부스트" },
  star: { label: "GO", message: "별 부스트" },
};

const PLATFORM_DECO_BY_MOTION = {
  drift: "orb",
  rotate: "spinner",
};

const settings = {
  worldWidth: 500,
  gravity: 0.42,
  moveSpeed: 4.8,
  normalJump: -11.8,
  boostJump: -16.8,
  platformGap: 96,
  platformWidthMin: 84,
  platformWidthMax: 150,
  startLineY: 540,
  playerSpawnOffset: 52,
  safePlatformInset: 14,
  difficultyHeightRange: 2600,
  pathShiftMin: 180,
  pathShiftMax: 245,
  pathRequiredShiftMin: 40,
  pathRequiredShiftMax: 85,
  platformWidthMinLate: 74,
  platformWidthMaxLate: 122,
};

const PLAYER_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ec4899", "#14b8a6", "#f97316"];
const NETWORK_TICK_MS = 50;
const NETWORK_PING_INTERVAL_MS = 2000;
const NETWORK_SNAPSHOT_LIMIT = 32;
const NETWORK_RTT_SAMPLE_LIMIT = 8;
const NETWORK_DEFAULT_ONE_WAY_MS = NETWORK_TICK_MS * 0.5;
const NETWORK_MIN_INTERPOLATION_MS = 100;
const NETWORK_MAX_INTERPOLATION_MS = 260;
const NETWORK_BASE_INTERPOLATION_MS = NETWORK_TICK_MS * 2;

const state = {
  running: false,
  rafId: 0,
  keys: new Set(),
  touchAssignments: new Map(),
  playerTouchDirections: [0, 0],
  playerCount: 1,
  cameraY: 0,
  arenaMetrics: {
    clientWidth: 0,
    clientHeight: 0,
    scale: 1,
    worldHeight: 0,
  },
  isSpectator: false,
  chatInputOpen: false,
  chatFocused: false,
  setup: [createDefaultSetup("mochi-rabbit"), createDefaultSetup("pudding-hamster")],
  players: [],
  platforms: [],
  boosts: [],
  effects: [],
  resultSubmitted: false,
  audio: {
    ctx: null,
    unlocked: false,
  },
  network: {
    ws: null,
    joined: false,
    protocol: null,
    initialized: false,
    lastSeq: -1,
    elapsedMs: 0,
    elapsedSyncedAtMs: 0,
    snapshot: null,
    snapshots: [],
    rttSamples: [],
    rttMs: 0,
    jitterMs: 0,
    interpolationDelayMs: NETWORK_BASE_INTERPOLATION_MS + NETWORK_DEFAULT_ONE_WAY_MS,
    nextPingId: 1,
    pendingPings: new Map(),
    lastSentDirection: null,
    inputIntervalId: 0,
    pingIntervalId: 0,
    renderFrameId: 0,
    lastFrameTime: 0,
    platformEls: new Map(),
    boostEls: new Map(),
    playerEls: new Map(),
  },
};

const configRefs = playerConfigCards.map((card, slot) => ({
  slot,
  card,
  name: card.querySelector(`[data-player-name="${slot}"]`),
  preview: card.querySelector(`[data-preview-slot="${slot}"]`),
  options: card.querySelector(`[data-character-options="${slot}"]`),
  faceEnabled: card.querySelector(".face-enabled"),
  faceUpload: card.querySelector(".face-upload"),
  faceScale: card.querySelector(".face-scale"),
  photoScale: card.querySelector(".photo-scale"),
  characterScale: card.querySelector(".character-scale"),
  faceX: card.querySelector(".face-x"),
  faceY: card.querySelector(".face-y"),
  faceReset: card.querySelector(".face-reset"),
}));

function createDefaultSetup(characterId) {
  return {
    characterId,
    faceEnabled: false,
    faceUrl: "",
    faceTransform: {
      scale: 1,
      x: 0,
      y: 0,
    },
    photoScale: 1,
    characterScale: 1,
  };
}

function random(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function ensureAudioUnlocked() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;

  if (!state.audio.ctx) {
    state.audio.ctx = new AudioCtx();
  }

  if (state.audio.ctx.state === "suspended") {
    state.audio.ctx.resume().catch(() => {});
  }

  state.audio.unlocked = true;
  return state.audio.ctx;
}

function playTone({ type = "sine", frequency = 440, endFrequency = frequency, duration = 0.12, volume = 0.04 }) {
  const ctx = ensureAudioUnlocked();
  if (!ctx) return;

  const now = ctx.currentTime;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, endFrequency), now + duration);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}

function playJumpSound() {
  playTone({ type: "triangle", frequency: 420, endFrequency: 660, duration: 0.1, volume: 0.035 });
}

function playLandSound() {
  playTone({ type: "sine", frequency: 220, endFrequency: 140, duration: 0.09, volume: 0.03 });
}

function playBoostSound() {
  playTone({ type: "square", frequency: 540, endFrequency: 1080, duration: 0.16, volume: 0.04 });
  window.setTimeout(() => {
    playTone({ type: "triangle", frequency: 760, endFrequency: 520, duration: 0.14, volume: 0.028 });
  }, 36);
}

function slotLabel(slot) {
  return `${slot + 1}P`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function getAvatarLabel(name, fallback = "") {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed || fallback;
}

function getCharacter(characterId) {
  return CHARACTER_MAP[characterId] || CHARACTER_LIST[0];
}

function getSpriteSrc(character, pose) {
  return character.assets[pose] || character.assets.jump_neutral;
}

function createAvatarMarkup(setup, label, compact = false, pose = "preview") {
  const character = getCharacter(setup.characterId);
  const hasCustomFace = Boolean(setup.faceEnabled && setup.faceUrl);
  const classes = ["avatar", `avatar--${character.id}`];

  if (compact) {
    classes.push("avatar--compact");
  }

  const transform = setup.faceTransform;
  const faceBox = character.faceBox;
  const style =
    `--face-size-scale:${transform.scale}; --photo-scale:${setup.photoScale || 1}; --character-scale:${setup.characterScale || 1}; ` +
    `--face-x:${transform.x}; --face-y:${transform.y}; ` +
    `--face-left:${faceBox.left}%; --face-top:${faceBox.top}%; --face-size:${faceBox.size}%;`;

  return `
    <div class="${classes.join(" ")} is-rising" style="${style}">
      ${label ? `<span class="avatar__label">${escapeHtml(label)}</span>` : ""}
      <div class="avatar__character">
        <img class="avatar__sprite" src="${getSpriteSrc(character, pose)}" alt="${character.name}" />
        ${
          hasCustomFace
            ? `
              <div class="avatar__face-mask">
                <img class="avatar__face-photo" src="${setup.faceUrl}" alt="" />
              </div>
            `
            : ""
        }
      </div>
    </div>
  `;
}

function createCharacterOptionMarkup(character, slot, active) {
  return `
    <button
      type="button"
      class="character-option ${active ? "is-active" : ""}"
      data-slot="${slot}"
      data-character-id="${character.id}"
    >
      ${createAvatarMarkup({ ...createDefaultSetup(character.id), faceEnabled: false }, "", true, "preview")}
      <span class="character-option__name">${character.name}</span>
    </button>
  `;
}

function addChatMessage(entry) {
  const color = PLAYER_COLORS[(entry.colorIndex || 0) % PLAYER_COLORS.length];
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const el = document.createElement("div");
  el.className = "chat-message";
  el.innerHTML = `
    <span class="chat-message__name" style="color:${color}">${entry.name}</span>
    <span class="chat-message__text">${entry.text}</span>
    <span class="chat-message__time">${timeStr}</span>
  `;
  chatMessagesEl.appendChild(el);

  while (chatMessagesEl.children.length > 8) {
    chatMessagesEl.removeChild(chatMessagesEl.firstChild);
  }

  setTimeout(() => {
    el.classList.add("is-fading");
    setTimeout(() => el.remove(), 650);
  }, 10000);
}

function sendChat() {
  const text = (chatInputEl.value || "").trim();
  if (!text) return;
  if (!state.network.ws || state.network.ws.readyState !== WebSocket.OPEN) return;
  state.network.ws.send(JSON.stringify({ type: "chat", text }));
  chatInputEl.value = "";
}

function toggleChatInput(open) {
  state.chatInputOpen = open !== undefined ? open : !state.chatInputOpen;
  chatInputWrap.classList.toggle("is-open", state.chatInputOpen);
  chatToggleBtn.textContent = state.chatInputOpen ? "✕" : "💬";
  if (state.chatInputOpen) chatInputEl.focus();
}

function isTypingTarget(target) {
  return Boolean(
    target &&
    typeof target === "object" &&
    ("tagName" in target || "isContentEditable" in target) &&
    (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    )
  );
}

function showChatOverlay() {
  chatOverlayEl.classList.remove("is-hidden");
}

function setStatus(message) {
  statusEl.textContent = message;
}

function showScreen(screen) {
  const isSetup = screen === "setup";
  setupScreen.classList.toggle("is-active", isSetup);
  playScreen.classList.toggle("is-active", !isSetup);
  window.scrollTo(0, 0);
}

function buildRoomWebSocketUrl(code) {
  const base = (window.WORKER_URL || window.location.origin).replace(/^http/, "ws");
  return `${base}/api/rooms/${encodeURIComponent(code)}`;
}

function getPoseFromStateLike(player) {
  if (player.vy > 0.8) return "fall_neutral";
  if (player.vx < -0.35) return "jump_left";
  if (player.vx > 0.35) return "jump_right";
  return "jump_neutral";
}

function createPlatformMotion() {
  const roll = Math.random();
  if (roll < 0.18) {
    return {
      type: "drift",
      amplitude: random(18, 34),
      speed: random(0.45, 0.78),
      phase: random(0, Math.PI * 2),
      rotateAmplitude: random(2, 4),
    };
  }

  if (roll < 0.33) {
    return {
      type: "rotate",
      amplitude: 0,
      speed: random(0.5, 0.9),
      phase: random(0, Math.PI * 2),
      rotateAmplitude: random(5, 9),
    };
  }

  return {
    type: "static",
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
  const climbed = Math.max(0, settings.startLineY - y);
  return clamp(climbed / settings.difficultyHeightRange, 0, 1);
}

function getPlatformProfile(y) {
  const progress = getDifficultyProgress(y);
  return {
    progress,
    widthMin: lerp(settings.platformWidthMin, settings.platformWidthMinLate, progress),
    widthMax: lerp(settings.platformWidthMax, settings.platformWidthMaxLate, progress),
    pathShift: lerp(settings.pathShiftMin, settings.pathShiftMax, progress),
    pathRequiredShift: lerp(settings.pathRequiredShiftMin, settings.pathRequiredShiftMax, progress),
  };
}

function getTopmostPlatform() {
  if (state.platforms.length === 0) return null;
  return state.platforms.reduce((top, platform) => (platform.y < top.y ? platform : top), state.platforms[0]);
}

function getArenaScale() {
  if (!arena?.clientWidth) return 1;
  return Math.min(1, arena.clientWidth / settings.worldWidth);
}

function applyArenaScale(force = false) {
  if (!arena || !worldEl) return state.arenaMetrics;
  const clientWidth = arena.clientWidth || 0;
  const clientHeight = arena.clientHeight || 0;
  const scale = clientWidth ? Math.min(1, clientWidth / settings.worldWidth) : 1;
  const worldHeight = Math.ceil(clientHeight / Math.max(scale, 0.0001));
  const metrics = state.arenaMetrics;

  if (
    !force &&
    metrics.clientWidth === clientWidth &&
    metrics.clientHeight === clientHeight &&
    metrics.scale === scale &&
    metrics.worldHeight === worldHeight
  ) {
    return metrics;
  }

  metrics.clientWidth = clientWidth;
  metrics.clientHeight = clientHeight;
  metrics.scale = scale;
  metrics.worldHeight = worldHeight;

  worldEl.style.width = `${settings.worldWidth}px`;
  worldEl.style.height = `${worldHeight}px`;
  worldEl.style.transform = `translateZ(0) scale(${scale})`;
  worldEl.style.transformOrigin = "top left";
  return metrics;
}

function formatWorldTranslate(x, y, extraTransform = "") {
  const tx = Number.isFinite(x) ? x.toFixed(2) : "0.00";
  const ty = Number.isFinite(y) ? y.toFixed(2) : "0.00";
  return `translate3d(${tx}px, ${ty}px, 0)${extraTransform}`;
}

function clearNetworkWorld() {
  state.network.platformEls.forEach((entry) => entry.el?.remove());
  state.network.boostEls.forEach((entry) => entry.el?.remove());
  state.network.playerEls.forEach(({ el }) => el.remove());
  state.network.platformEls.clear();
  state.network.boostEls.clear();
  state.network.playerEls.clear();
  state.network.joined = false;
  state.network.protocol = null;
  state.network.initialized = false;
  state.network.lastSeq = -1;
  state.network.elapsedMs = 0;
  state.network.elapsedSyncedAtMs = 0;
  state.network.snapshot = null;
  state.network.snapshots = [];
  state.network.rttSamples = [];
  state.network.rttMs = 0;
  state.network.jitterMs = 0;
  state.network.interpolationDelayMs = NETWORK_BASE_INTERPOLATION_MS + NETWORK_DEFAULT_ONE_WAY_MS;
  state.network.nextPingId = 1;
  state.network.pendingPings.clear();
  state.network.lastFrameTime = 0;
  state.network.lastSentDirection = null;
  state.isSpectator = false;
  state.effects = [];
  if (spectatorBadgeEl) spectatorBadgeEl.classList.add("is-hidden");
  chatOverlayEl.classList.add("is-hidden");
}

function stopNetworkInputLoop() {
  if (state.network.inputIntervalId) {
    clearInterval(state.network.inputIntervalId);
    state.network.inputIntervalId = 0;
  }
}

function stopNetworkPingLoop() {
  if (state.network.pingIntervalId) {
    clearInterval(state.network.pingIntervalId);
    state.network.pingIntervalId = 0;
  }
  state.network.pendingPings.clear();
}

function stopNetworkRenderLoop() {
  if (state.network.renderFrameId) {
    cancelAnimationFrame(state.network.renderFrameId);
    state.network.renderFrameId = 0;
  }
}

function stopSoloGame() {
  state.running = false;
  cancelAnimationFrame(state.rafId);
}

function exitSession() {
  stopNetworkInputLoop();
  stopNetworkPingLoop();
  stopNetworkRenderLoop();
  if (state.network.ws) {
    try {
      state.network.ws.close();
    } catch {
      // ignore close errors
    }
    state.network.ws = null;
  }

  if (gameBoot) {
    gameBoot.exit();
    return;
  }

  window.location.href = "/";
}

function hideResultsOverlay() {
  resultsOverlay.classList.remove("is-active");
}

function submitRoundResult() {
  if (!gameBoot || !gameBoot.isMultiplayer || state.resultSubmitted || isRoomSession) return;

  const submittedScore = Math.max(...state.players.map((player) => player.bestHeight), 0);
  gameBoot.submitResult({ score: submittedScore });
  state.resultSubmitted = true;
}

function showResultsOverlay() {
  const rankedPlayers = [...state.players].sort((a, b) => b.bestHeight - a.bestHeight);
  const leadMessage =
    rankedPlayers.length > 1
      ? rankedPlayers[0].bestHeight === rankedPlayers[1].bestHeight
        ? "동점이에요. 한 판 더 해서 승부를 가려보세요."
        : `${slotLabel(rankedPlayers[0].slot)} 승리! ${rankedPlayers[0].bestHeight}m까지 올랐어요.`
      : `${slotLabel(rankedPlayers[0].slot)} 최고 기록 ${rankedPlayers[0].bestHeight}m`;

  resultLeadEl.textContent = isRoomSession
    ? `${leadMessage} 결과를 제출했고, 대기실로 돌아가면 스코어보드를 볼 수 있어요.`
    : leadMessage;

  for (let slot = 0; slot < 2; slot += 1) {
    const active = slot < state.playerCount;
    const player = state.players.find((entry) => entry.slot === slot);
    const characterName = getCharacter(state.setup[slot].characterId).name;

    resultRows[slot].classList.toggle("is-hidden", !active);
    if (!active) continue;

    resultNameEls[slot].textContent = `${slotLabel(slot)} · ${characterName}`;
    resultScoreEls[slot].textContent = `${player ? player.bestHeight : 0}m`;
  }

  restartFromResultsButton.textContent = isRoomSession ? "대기실로 복귀" : "한 판 더 하기";
  exitAfterResultsButton.textContent = isRoomSession ? "허브로 가기" : "허브로 나가기";
  resultsOverlay.classList.add("is-active");
}

function showNetworkResultsOverlay(results) {
  const bySlot = new Map(results.map((entry) => [entry.slot, entry]));
  const leader = results[0] || null;

  resultLeadEl.textContent = leader
    ? `${leader.name} 승리! ${leader.score}m 기록으로 대기실 스코어보드에도 반영됩니다.`
    : "라운드가 끝났습니다. 대기실로 돌아가 결과를 확인해 주세요.";

  for (let slot = 0; slot < 2; slot += 1) {
    const entry = bySlot.get(slot);
    resultRows[slot].classList.toggle("is-hidden", !entry);
    if (!entry) continue;
    resultNameEls[slot].textContent = `${slotLabel(slot)} · ${entry.name}`;
    resultScoreEls[slot].textContent = `${entry.score}m`;
  }

  restartFromResultsButton.textContent = "대기실로 복귀";
  exitAfterResultsButton.textContent = "허브로 가기";
  resultsOverlay.classList.add("is-active");
}

function updateHudFromSnapshot(players) {
  for (let slot = 0; slot < 2; slot += 1) {
    const player = players.find((entry) => entry.slot === slot);
    const active = Boolean(player);

    hudCards[slot].classList.toggle("is-hidden", !active);
    bestEls[slot].textContent = player ? `${player.bestHeight}m` : "0m";
    lifeEls[slot].textContent = player ? (player.alive ? "생존" : "탈락") : "대기";
  }
}

function syncEntityMap(map, items, createFn, updateFn) {
  const nextIds = new Set(items.map((item) => item.id));
  items.forEach((item) => {
    if (!map.has(item.id)) {
      map.set(item.id, createFn(item));
    }
    updateFn(map.get(item.id), item);
  });

  for (const [id, entry] of map.entries()) {
    if (nextIds.has(id)) continue;
    (entry.el || entry).remove();
    map.delete(id);
  }
}

function samplePlatformMotion(platform, timeSeconds) {
  const baseX = Number.isFinite(platform.baseX) ? platform.baseX : (Number.isFinite(platform.x) ? platform.x : 0);
  if (!platform.motion || platform.motion.type === "static") {
    return {
      x: baseX,
      rotation: 0,
    };
  }

  const wave = Math.sin(timeSeconds * platform.motion.speed + platform.motion.phase);
  return {
    x: baseX + (platform.motion.type === "drift" ? wave * platform.motion.amplitude : 0),
    rotation: wave * platform.motion.rotateAmplitude,
  };
}

function getNetworkOneWayDelayMs() {
  return state.network.rttMs > 0 ? state.network.rttMs * 0.5 : NETWORK_DEFAULT_ONE_WAY_MS;
}

function recalculateNetworkInterpolationDelay() {
  const adaptiveDelay =
    NETWORK_BASE_INTERPOLATION_MS +
    getNetworkOneWayDelayMs() +
    state.network.jitterMs * 2;
  state.network.interpolationDelayMs = clamp(
    adaptiveDelay,
    NETWORK_MIN_INTERPOLATION_MS,
    NETWORK_MAX_INTERPOLATION_MS
  );
}

function recordNetworkRttSample(rttMs) {
  if (!Number.isFinite(rttMs) || rttMs <= 0) return;
  state.network.rttSamples.push(rttMs);
  if (state.network.rttSamples.length > NETWORK_RTT_SAMPLE_LIMIT) {
    state.network.rttSamples.shift();
  }

  const sampleTotal = state.network.rttSamples.reduce((sum, sample) => sum + sample, 0);
  const averageRtt = sampleTotal / state.network.rttSamples.length;
  const averageDeviation =
    state.network.rttSamples.reduce((sum, sample) => sum + Math.abs(sample - averageRtt), 0) /
    state.network.rttSamples.length;

  state.network.rttMs = averageRtt;
  state.network.jitterMs = averageDeviation;
  recalculateNetworkInterpolationDelay();
}

function syncNetworkClock(snapshot, now = performance.now()) {
  if (!Number.isFinite(snapshot.elapsedMs)) return;
  state.network.elapsedMs = snapshot.elapsedMs + getNetworkOneWayDelayMs();
  state.network.elapsedSyncedAtMs = now;
}

function getEstimatedNetworkElapsedMs(now = performance.now()) {
  if (!state.network.elapsedSyncedAtMs) {
    return state.network.elapsedMs;
  }

  return state.network.elapsedMs + Math.max(0, now - state.network.elapsedSyncedAtMs);
}

function getBufferedNetworkElapsedMs(now = performance.now()) {
  return Math.max(0, getEstimatedNetworkElapsedMs(now) - state.network.interpolationDelayMs);
}

function pushNetworkSnapshot(snapshot) {
  if (!Number.isFinite(snapshot.elapsedMs)) return;
  const normalizedSnapshot = {
    elapsedMs: snapshot.elapsedMs,
    cameraY: Number.isFinite(snapshot.cameraY) ? snapshot.cameraY : 0,
    players: (snapshot.players || []).map((player) => ({
      id: player.id,
      x: player.x,
      y: player.y,
      vx: player.vx || 0,
      vy: player.vy || 0,
      alive: player.alive,
      width: player.width,
      height: player.height,
    })),
  };

  const snapshots = state.network.snapshots;
  const lastSnapshot = snapshots[snapshots.length - 1];
  if (lastSnapshot && lastSnapshot.elapsedMs === normalizedSnapshot.elapsedMs) {
    snapshots[snapshots.length - 1] = normalizedSnapshot;
  } else {
    snapshots.push(normalizedSnapshot);
  }

  while (snapshots.length > NETWORK_SNAPSHOT_LIMIT) {
    snapshots.shift();
  }
}

function sampleBufferedNetworkState(now = performance.now()) {
  const snapshots = state.network.snapshots;
  if (snapshots.length === 0) return null;

  const targetElapsedMs = getBufferedNetworkElapsedMs(now);
  const firstSnapshot = snapshots[0];
  const latestSnapshot = snapshots[snapshots.length - 1];

  if (snapshots.length === 1 || targetElapsedMs <= firstSnapshot.elapsedMs) {
    return {
      elapsedMs: firstSnapshot.elapsedMs,
      cameraY: firstSnapshot.cameraY,
      playersById: new Map(firstSnapshot.players.map((player) => [player.id, player])),
    };
  }

  if (targetElapsedMs >= latestSnapshot.elapsedMs) {
    return {
      elapsedMs: latestSnapshot.elapsedMs,
      cameraY: latestSnapshot.cameraY,
      playersById: new Map(latestSnapshot.players.map((player) => [player.id, player])),
    };
  }

  let previousSnapshot = firstSnapshot;
  let nextSnapshot = latestSnapshot;
  for (let index = 1; index < snapshots.length; index += 1) {
    if (targetElapsedMs <= snapshots[index].elapsedMs) {
      previousSnapshot = snapshots[index - 1];
      nextSnapshot = snapshots[index];
      break;
    }
  }

  const spanMs = Math.max(1, nextSnapshot.elapsedMs - previousSnapshot.elapsedMs);
  const t = clamp((targetElapsedMs - previousSnapshot.elapsedMs) / spanMs, 0, 1);
  const previousPlayers = new Map(previousSnapshot.players.map((player) => [player.id, player]));
  const nextPlayers = new Map(nextSnapshot.players.map((player) => [player.id, player]));
  const playerIds = new Set([...previousPlayers.keys(), ...nextPlayers.keys()]);
  const playersById = new Map();

  playerIds.forEach((playerId) => {
    const previousPlayer = previousPlayers.get(playerId);
    const nextPlayer = nextPlayers.get(playerId);
    if (!previousPlayer && nextPlayer) {
      playersById.set(playerId, nextPlayer);
      return;
    }
    if (previousPlayer && !nextPlayer) {
      playersById.set(playerId, previousPlayer);
      return;
    }
    playersById.set(playerId, {
      ...nextPlayer,
      x: lerp(previousPlayer.x, nextPlayer.x, t),
      y: lerp(previousPlayer.y, nextPlayer.y, t),
      vx: lerp(previousPlayer.vx || 0, nextPlayer.vx || 0, t),
      vy: lerp(previousPlayer.vy || 0, nextPlayer.vy || 0, t),
    });
  });

  return {
    elapsedMs: lerp(previousSnapshot.elapsedMs, nextSnapshot.elapsedMs, t),
    cameraY: lerp(previousSnapshot.cameraY, nextSnapshot.cameraY, t),
    playersById,
  };
}

function renderNetworkPlatformEntry(entry, timeSeconds) {
  const { x, rotation } = samplePlatformMotion(entry, timeSeconds);
  entry.el.style.transform = formatWorldTranslate(
    x,
    entry.worldY - state.cameraY,
    ` rotate(${rotation.toFixed(2)}deg)`
  );
}

function renderNetworkBoostEntry(entry) {
  entry.el.style.transform = formatWorldTranslate(entry.worldX, entry.worldY - state.cameraY);
}

function initializeEntityMotion(entry, x, y, rotation = 0) {
  if (typeof entry.currentX !== "number") entry.currentX = x;
  if (typeof entry.currentY !== "number") entry.currentY = y;
  if (typeof entry.targetX !== "number") entry.targetX = x;
  if (typeof entry.targetY !== "number") entry.targetY = y;
  if (typeof entry.currentRotation !== "number") entry.currentRotation = rotation;
  if (typeof entry.targetRotation !== "number") entry.targetRotation = rotation;
}

function updateNetworkTargets(snapshot) {
  applyArenaScale();
  const syncNow = performance.now();
  syncNetworkClock(snapshot, syncNow);
  state.network.snapshot = snapshot;
  pushNetworkSnapshot(snapshot);
  const bufferedState = sampleBufferedNetworkState(syncNow);
  state.cameraY = bufferedState ? bufferedState.cameraY : (snapshot.cameraY || 0);

  if (Array.isArray(snapshot.platforms)) {
    syncEntityMap(
      state.network.platformEls,
      snapshot.platforms,
      (platform) => {
        const el = document.createElement("div");
        el.className = `platform platform--${platform.kind}`;
        el.style.width = `${platform.width}px`;
        const decoType = PLATFORM_DECO_BY_MOTION[platform.motion?.type] || "";
        if (decoType) {
          el.innerHTML = `<span class="platform-deco platform-deco--${decoType}"></span>`;
        }
        worldEl.appendChild(el);
        return {
          el,
          baseX: Number.isFinite(platform.baseX) ? platform.baseX : (Number.isFinite(platform.x) ? platform.x : 0),
          worldY: platform.y,
          motion: platform.motion || null,
        };
      },
      (entry, platform) => {
        const el = entry.el;
        el.className = `platform platform--${platform.kind}`;
        el.style.width = `${platform.width}px`;
        const decoType = PLATFORM_DECO_BY_MOTION[platform.motion?.type] || "";
        el.innerHTML = decoType ? `<span class="platform-deco platform-deco--${decoType}"></span>` : "";
        entry.baseX = Number.isFinite(platform.baseX) ? platform.baseX : (Number.isFinite(platform.x) ? platform.x : 0);
        entry.worldY = platform.y;
        entry.motion = platform.motion || null;
        renderNetworkPlatformEntry(entry, getBufferedNetworkElapsedMs(syncNow) / 1000);
      }
    );
  }

  if (Array.isArray(snapshot.boosts)) {
    syncEntityMap(
      state.network.boostEls,
      snapshot.boosts,
      (boost) => {
        const el = document.createElement("div");
        el.className = `boost boost--${boost.kind}`;
        el.textContent = BOOST_META[boost.kind]?.label || "";
        worldEl.appendChild(el);
        return { el, worldX: boost.x, worldY: boost.y };
      },
      (entry, boost) => {
        const el = entry.el;
        el.className = `boost boost--${boost.kind}`;
        el.textContent = BOOST_META[boost.kind]?.label || "";
        entry.worldX = boost.x;
        entry.worldY = boost.y;
        renderNetworkBoostEntry(entry);
      }
    );
  }

  syncEntityMap(
    state.network.playerEls,
    snapshot.players || [],
    (player) => {
      const el = document.createElement("div");
      el.className = "player";
      worldEl.appendChild(el);
      return { el, avatarEl: null, spriteEl: null, pose: null, characterId: null };
    },
    (entry, player) => {
      const previousLatest = entry.latest;
      const pose = getPoseFromStateLike(player);
      const isLocalPlayer = Boolean(gameBoot?.playerId) && player.id === gameBoot.playerId;
      const setupForRender = isLocalPlayer
        ? state.setup[0]
        : { ...createDefaultSetup(player.characterId), characterId: player.characterId };
      if (entry.characterId !== player.characterId || !entry.spriteEl) {
        entry.el.innerHTML = createAvatarMarkup(
          setupForRender,
          getAvatarLabel(player.name, `${player.slot + 1}P`),
          false,
          pose
        );
        entry.avatarEl = entry.el.querySelector(".avatar");
        entry.spriteEl = entry.el.querySelector(".avatar__sprite");
        entry.characterId = player.characterId;
        entry.pose = pose;
      } else if (entry.pose !== pose) {
        const character = getCharacter(player.characterId);
        entry.spriteEl.src = getSpriteSrc(character, pose);
        entry.pose = pose;
      }

      initializeEntityMotion(entry, player.x, player.y);
      entry.id = player.id;
      entry.targetX = player.x;
      entry.targetY = player.y;
      entry.serverX = player.x;
      entry.serverY = player.y;
      entry.serverVx = player.vx || 0;
      entry.serverVy = player.vy || 0;
      entry.el.classList.toggle("is-eliminated", !player.alive);
      if (entry.avatarEl) {
        entry.avatarEl.classList.toggle("is-left", player.vx < -0.35);
        entry.avatarEl.classList.toggle("is-right", player.vx > 0.35);
        entry.avatarEl.classList.toggle("is-falling", player.vy > 0.8);
        entry.avatarEl.classList.toggle("is-rising", player.vy <= 0.8);
      }
      entry.isLocalPlayer = isLocalPlayer;
      entry.alive = player.alive;
      entry.latest = player;

      if (isLocalPlayer && previousLatest) {
        const landed =
          previousLatest.alive &&
          previousLatest.vy > 0.8 &&
          player.alive &&
          player.vy <= settings.normalJump + 0.2;
        if (landed) {
          spawnEffect("land", player.x + player.width / 2, player.y + player.height + 4);
          spawnEffect("jump", player.x + player.width / 2, player.y + player.height * 0.8);
          playLandSound();
          playJumpSound();
        }

        const boosted =
          previousLatest.alive &&
          player.alive &&
          previousLatest.vy > settings.boostJump + 3 &&
          player.vy <= settings.boostJump + 0.2;
        if (boosted) {
          spawnEffect("boost", player.x + player.width / 2, player.y + player.height / 2);
          spawnEffect("pickup", player.x + player.width / 2, player.y + 8);
          playBoostSound();
        }
      }
    }
  );

  updateHudFromSnapshot(snapshot.players || []);

  if (!snapshot.running && snapshot.waitingFor > 0) {
    setStatus(`친구 접속 대기 중... ${snapshot.expectedPlayers - snapshot.waitingFor}/${snapshot.expectedPlayers} 준비`);
  } else if (snapshot.running) {
    const aliveCount = (snapshot.players || []).filter((player) => player.alive).length;
    setStatus(aliveCount > 1 ? "같은 맵에서 함께 점프 중!" : "한 명만 남았습니다. 끝까지 올라가세요!");
  }
}

function applyJumpInitFrame(frame) {
  const wasJoined = state.network.joined;
  clearNetworkWorld();
  state.network.joined = wasJoined;
  state.network.protocol = frame.protocol || "jump/v1";
  state.network.initialized = true;
  state.network.lastSeq = Number.isFinite(frame.seq) ? frame.seq : 0;
  updateNetworkTargets(frame);
}

function applyJumpPatchFrame(frame) {
  if (!state.network.initialized) return;
  const nextSeq = Number.isFinite(frame.seq) ? frame.seq : state.network.lastSeq + 1;
  if (nextSeq <= state.network.lastSeq) return;
  state.network.protocol = frame.protocol || state.network.protocol;
  state.network.lastSeq = nextSeq;
  updateNetworkTargets(frame);
}

function applyLegacyJumpState(frame) {
  if (!state.network.initialized) {
    clearNetworkWorld();
    state.network.protocol = "jump_state_legacy";
    state.network.initialized = true;
  }
  updateNetworkTargets(frame);
}

function renderNetworkFrame(now) {
  if (!isRoomSession || !state.running) return;

  const dt = state.network.lastFrameTime ? now - state.network.lastFrameTime : 16.67;
  state.network.lastFrameTime = now;
  const predictionStep = dt / 16.67;
  const bufferedState = sampleBufferedNetworkState(now);
  const motionTime = bufferedState
    ? bufferedState.elapsedMs / 1000
    : getBufferedNetworkElapsedMs(now) / 1000;
  if (bufferedState) {
    state.cameraY = bufferedState.cameraY;
  }

  state.network.platformEls.forEach((entry) => {
    renderNetworkPlatformEntry(entry, motionTime);
  });

  state.network.boostEls.forEach((entry) => {
    renderNetworkBoostEntry(entry);
  });

  state.network.playerEls.forEach((entry) => {
    if (entry.isLocalPlayer) {
      const predictedDirection = getPlayerDirection(0);
      entry.currentX += predictedDirection * settings.moveSpeed * predictionStep;
      entry.currentX += (entry.serverX - entry.currentX) * 0.08;
      entry.currentY += (entry.serverY - entry.currentY) * 0.18;
      entry.currentX = clamp(entry.currentX, 0, settings.worldWidth - (entry.latest?.width || 46));
    } else if (bufferedState?.playersById.has(entry.id)) {
      const sampledPlayer = bufferedState.playersById.get(entry.id);
      entry.currentX = sampledPlayer.x;
      entry.currentY = sampledPlayer.y;
    } else {
      entry.currentX += (entry.serverX - entry.currentX) * 0.12;
      entry.currentY += (entry.serverY - entry.currentY) * 0.12;
    }

    entry.el.style.transform = formatWorldTranslate(entry.currentX, entry.currentY - state.cameraY);
  });

  state.effects.forEach((effect) => {
    effect.el.style.setProperty("--ty", `${effect.tyBase - state.cameraY}px`);
  });

  state.network.renderFrameId = requestAnimationFrame(renderNetworkFrame);
}

function startNetworkRenderLoop() {
  stopNetworkRenderLoop();
  state.network.lastFrameTime = 0;
  state.network.renderFrameId = requestAnimationFrame(renderNetworkFrame);
}

function sendNetworkPing() {
  if (!state.network.ws || state.network.ws.readyState !== WebSocket.OPEN) return;
  const pingId = state.network.nextPingId;
  state.network.nextPingId += 1;
  const sentAtMs = performance.now();
  state.network.pendingPings.set(pingId, sentAtMs);
  state.network.ws.send(JSON.stringify({ type: "ping", pingId, clientTimeMs: sentAtMs }));
}

function handleNetworkPong(msg) {
  const pingId = Number(msg.pingId);
  if (!Number.isFinite(pingId)) return;
  const sentAtMs = state.network.pendingPings.get(pingId);
  if (!Number.isFinite(sentAtMs)) return;
  state.network.pendingPings.delete(pingId);
  recordNetworkRttSample(performance.now() - sentAtMs);
}

function startNetworkPingLoop() {
  stopNetworkPingLoop();
  sendNetworkPing();
  state.network.pingIntervalId = window.setInterval(() => {
    sendNetworkPing();
  }, NETWORK_PING_INTERVAL_MS);
}

function sendNetworkInput(direction) {
  if (!state.network.ws || state.network.ws.readyState !== WebSocket.OPEN) return;
  state.network.ws.send(JSON.stringify({ type: "player_input", direction }));
}

function syncNetworkInput(force = false) {
  if (!isRoomSession || state.isSpectator) return;
  const direction = getPlayerDirection(0);
  if (!force && direction === state.network.lastSentDirection) return;
  state.network.lastSentDirection = direction;
  sendNetworkInput(direction);
}

function startNetworkInputLoop() {
  stopNetworkInputLoop();
  state.network.lastSentDirection = null;
  syncNetworkInput(true);
  state.network.inputIntervalId = window.setInterval(() => {
    syncNetworkInput(true);
  }, 50);
}

function handleNetworkMessage(msg) {
  switch (msg.type) {
    case "jump_init":
      applyJumpInitFrame(msg);
      break;
    case "jump_patch":
      applyJumpPatchFrame(msg);
      break;
    case "jump_state":
      applyLegacyJumpState(msg);
      break;
    case "pong":
      handleNetworkPong(msg);
      break;
    case "jump_joined":
      state.network.joined = true;
      state.isSpectator = msg.role === "spectator";
      if (state.isSpectator) {
        stopNetworkInputLoop();
        setStatus("관전 중 — 채팅으로 응원해 주세요! 선수들이 열심히 올라가고 있어요.");
        if (spectatorBadgeEl) spectatorBadgeEl.classList.remove("is-hidden");
      } else if (spectatorBadgeEl) {
        spectatorBadgeEl.classList.add("is-hidden");
      }
      break;
    case "chat":
      addChatMessage(msg);
      break;
    case "scoreboard":
      state.running = false;
      stopNetworkInputLoop();
      stopNetworkRenderLoop();
      showNetworkResultsOverlay(msg.results || []);
      break;
    case "error":
      setStatus(msg.message || "방 플레이 연결 중 오류가 발생했습니다.");
      break;
    default:
      break;
  }
}

function connectNetworkGame() {
  stopNetworkInputLoop();
  stopNetworkPingLoop();
  stopNetworkRenderLoop();
  if (state.network.ws) {
    try {
      state.network.ws.close();
    } catch {
      // ignore close errors
    }
    state.network.ws = null;
  }

  clearWorld();
  clearNetworkWorld();

  const ws = new WebSocket(buildRoomWebSocketUrl(gameBoot.code));
  state.network.ws = ws;
  state.running = true;

  ws.addEventListener("open", () => {
    if (state.network.ws !== ws) return;
    ws.send(
      JSON.stringify({
        type: "join_game",
        code: gameBoot.code,
        name: gameBoot.name,
        playerId: gameBoot.playerId,
        gameId: gameBoot.gameId || "jump-climber",
        characterId: state.setup[0].characterId,
      })
    );
    startNetworkInputLoop();
    startNetworkPingLoop();
    startNetworkRenderLoop();
    showChatOverlay();
    setStatus("방에 합류했어요. 친구가 들어오면 같은 맵이 시작됩니다.");
  });

  ws.addEventListener("message", (event) => {
    if (state.network.ws !== ws) return;
    try {
      handleNetworkMessage(JSON.parse(event.data));
    } catch {
      // ignore malformed packets
    }
  });

  ws.addEventListener("close", () => {
    if (state.network.ws !== ws) return;
    state.network.ws = null;
    stopNetworkInputLoop();
    stopNetworkPingLoop();
    stopNetworkRenderLoop();
    if (state.running) {
      setStatus("방 연결이 끊어졌습니다. 다시 시작 버튼으로 재접속해 주세요.");
    }
  });
}

function renderSetupUI() {
  playerCountButtons.forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.playerCount) === state.playerCount);
  });

  configRefs.forEach((ref, slot) => {
    const setup = state.setup[slot];
    const character = getCharacter(setup.characterId);
    const isActiveSlot = slot < state.playerCount;
    const slidersEnabled = Boolean(setup.faceEnabled && setup.faceUrl);
    const faceControlsLocked = false;

    ref.card.classList.toggle("is-hidden", !isActiveSlot);
    ref.name.textContent = character.name;
    ref.preview.innerHTML = createAvatarMarkup(setup, `${slot + 1}P`, false, "preview");
    ref.options.innerHTML = CHARACTER_LIST.map((item) =>
      createCharacterOptionMarkup(item, slot, item.id === setup.characterId)
    ).join("");
    ref.faceEnabled.checked = setup.faceEnabled;
    ref.faceScale.value = Math.round(setup.faceTransform.scale * 100);
    ref.photoScale.value = Math.round((setup.photoScale || 1) * 100);
    ref.characterScale.value = Math.round((setup.characterScale || 1) * 100);
    ref.faceX.value = setup.faceTransform.x;
    ref.faceY.value = setup.faceTransform.y;
    ref.faceEnabled.disabled = faceControlsLocked;
    ref.faceUpload.disabled = faceControlsLocked;
    ref.faceScale.disabled = !slidersEnabled;
    ref.photoScale.disabled = !slidersEnabled;
    ref.characterScale.disabled = false;
    ref.faceX.disabled = !slidersEnabled;
    ref.faceY.disabled = !slidersEnabled;
    ref.faceReset.disabled = !setup.faceEnabled && !setup.faceUrl;

    ref.options.querySelectorAll(".character-option").forEach((option) => {
      option.addEventListener("click", () => {
        state.setup[slot].characterId = option.dataset.characterId;
        renderSetupUI();
        updateHud();
        noteConfigChange();
      });
    });
  });

  updateHudVisibility();
}

function updateHudVisibility() {
  hudCards.forEach((card, slot) => {
    card.classList.toggle("is-hidden", slot >= state.playerCount);
  });
}

function noteConfigChange() {
  if (!state.running) {
    setStatus("캐릭터 설정을 마쳤다면 시작 버튼을 눌러주세요.");
    return;
  }

  setStatus("설정이 바뀌었어요. 다시 시작하면 바로 반영됩니다.");
}

function setPlayerCount(count) {
  state.playerCount = count;
  if (count === 1) {
    releaseTouchForSlot(1);
    state.playerTouchDirections[1] = 0;
  }
  renderSetupUI();
  updateHud();
  noteConfigChange();
}

function releaseTouchForSlot(slot) {
  for (const [pointerId, assignedSlot] of state.touchAssignments.entries()) {
    if (assignedSlot === slot) {
      state.touchAssignments.delete(pointerId);
    }
  }
}

function getKeyboardDirection(slot) {
  let direction = 0;

  if (slot === 0) {
    if (state.keys.has("a") || state.keys.has("A")) direction -= 1;
    if (state.keys.has("d") || state.keys.has("D")) direction += 1;

    if (state.playerCount === 1) {
      if (state.keys.has("ArrowLeft")) direction -= 1;
      if (state.keys.has("ArrowRight")) direction += 1;
    }
  }

  if (slot === 1) {
    if (state.keys.has("ArrowLeft")) direction -= 1;
    if (state.keys.has("ArrowRight")) direction += 1;
  }

  return clamp(direction, -1, 1);
}

function getPlayerDirection(slot) {
  return clamp(getKeyboardDirection(slot) + state.playerTouchDirections[slot], -1, 1);
}

function createPlatform(y, isBase = false, anchorPlatform = null) {
  const profile = getPlatformProfile(y);
  const width = isBase
    ? 200
    : Math.round(random(profile.widthMin, profile.widthMax));

  let x;
  if (isBase) {
    x = (settings.worldWidth - width) / 2;
  } else {
    const reference = anchorPlatform || getTopmostPlatform();
    const referenceCenter = reference ? reference.x + reference.width / 2 : settings.worldWidth / 2;
    const centerBias = (settings.worldWidth / 2 - referenceCenter) * 0.12;
    const direction = Math.random() < 0.5 ? -1 : 1;
    const signedShift = direction * random(profile.pathRequiredShift, profile.pathShift);
    const nextCenter = clamp(
      referenceCenter + centerBias + signedShift,
      width / 2 + settings.safePlatformInset,
      settings.worldWidth - width / 2 - settings.safePlatformInset
    );
    x = nextCenter - width / 2;
  }
  const kind = isBase ? "base" : PLATFORM_KINDS[Math.floor(random(0, PLATFORM_KINDS.length))];
  const motion = isBase
    ? { type: "static", amplitude: 0, speed: 0, phase: 0, rotateAmplitude: 0 }
    : createPlatformMotion();

  const el = document.createElement("div");
  el.className = `platform platform--${kind}`;
  el.style.width = `${width}px`;
  const decoType = PLATFORM_DECO_BY_MOTION[motion.type] || "";
  if (decoType) {
    el.innerHTML = `<span class="platform-deco platform-deco--${decoType}"></span>`;
  }
  worldEl.appendChild(el);

  const platform = {
    x,
    y,
    width,
    height: 18,
    el,
    baseX: x,
    rotation: 0,
    motion,
  };

  if (!isBase && motion.type === "static" && Math.random() < 0.2) {
    spawnBoost(platform);
  }

  return platform;
}

function spawnBoost(platform) {
  const kind = Math.random() < 0.5 ? "rocket" : "star";
  const el = document.createElement("div");
  el.className = `boost boost--${kind}`;
  el.textContent = BOOST_META[kind].label;
  worldEl.appendChild(el);

  state.boosts.push({
    x: platform.x + platform.width / 2 - 30,
    y: platform.y - 68,
    size: 60,
    kind,
    el,
  });
}

function spawnEffect(kind, worldX, worldY) {
  const el = document.createElement("div");
  el.className = `effect effect--${kind}`;
  const isLand = kind === "land";
  const w = isLand ? 148 : 96;
  const h = isLand ? 72 : 96;
  const tx = worldX - w / 2;
  const tyBase = isLand ? worldY - h * 0.56 : worldY - h / 2;

  const effectObj = { el, tx, tyBase };
  state.effects.push(effectObj);

  el.style.setProperty("--tx", `${tx}px`);
  el.style.setProperty("--ty", `${tyBase - state.cameraY}px`);

  worldEl.appendChild(el);
  setTimeout(() => {
    el.remove();
    state.effects = state.effects.filter((e) => e !== effectObj);
  }, isLand ? 520 : 420);
}

function clearWorld() {
  cancelAnimationFrame(state.rafId);
  worldEl.innerHTML = "";
  state.players = [];
  state.platforms = [];
  state.boosts = [];
  state.effects = [];
  state.touchAssignments.clear();
  state.playerTouchDirections = [0, 0];
  state.arenaMetrics.clientWidth = 0;
  state.arenaMetrics.clientHeight = 0;
  state.arenaMetrics.scale = 1;
  state.arenaMetrics.worldHeight = 0;
}

function resetWorld() {
  clearWorld();

  const base = createPlatform(settings.startLineY, true);
  state.platforms.push(base);
  let lastPlatform = base;

  for (let i = 1; i < 32; i += 1) {
    const platform = createPlatform(settings.startLineY - i * settings.platformGap, false, lastPlatform);
    state.platforms.push(platform);
    lastPlatform = platform;
  }
}

function createPlayer(slot) {
  const positions = state.playerCount === 1 ? [228] : [155, 300];
  const el = document.createElement("div");
  el.className = "player";
  const localLabel = slot === 0
    ? getAvatarLabel(gameBoot?.name, `${slot + 1}P`)
    : `${slot + 1}P`;
  el.innerHTML = createAvatarMarkup(state.setup[slot], localLabel, false, "jump_neutral");
  worldEl.appendChild(el);

  return {
    slot,
    x: positions[slot],
    y: settings.startLineY - settings.playerSpawnOffset - slot * 10,
    width: 46,
    height: 46,
    vx: 0,
    vy: settings.normalJump,
    bestHeight: 0,
    alive: true,
    el,
    avatarEl: el.querySelector(".avatar"),
    spriteEl: el.querySelector(".avatar__sprite"),
    pose: "jump_neutral",
  };
}

function updatePlatformMotionLocal() {
  const time = performance.now() / 1000;
  state.platforms.forEach((platform) => {
    const motion = samplePlatformMotion(platform, time);
    platform.x = motion.x;
    platform.rotation = motion.rotation;
  });
}

function ensurePlatformsAbove() {
  while (Math.min(...state.platforms.map((platform) => platform.y)) > state.cameraY - 1500) {
    const topmost = getTopmostPlatform();
    const newTop = topmost.y - settings.platformGap;
    state.platforms.push(createPlatform(newTop, false, topmost));
  }

  const cleanupLimit = state.cameraY + arena.clientHeight + 180;
  state.platforms = state.platforms.filter((platform) => {
    if (platform.y > cleanupLimit) {
      platform.el.remove();
      return false;
    }
    return true;
  });

  state.boosts = state.boosts.filter((boost) => {
    if (boost.y > cleanupLimit) {
      boost.el.remove();
      return false;
    }
    return true;
  });
}

function intersects(a, b) {
  return !(
    a.x + a.width < b.x ||
    a.x > b.x + b.width ||
    a.y + a.height < b.y ||
    a.y > b.y + b.height
  );
}

function handleLanding(player, previousY) {
  if (!player.alive || player.vy <= 0) return;

  const feetNow = player.y + player.height;
  const feetBefore = previousY + player.height;

  for (const platform of state.platforms) {
    const horizontalHit = player.x + player.width > platform.x && player.x < platform.x + platform.width;
    const passedTop = feetBefore <= platform.y && feetNow >= platform.y;

    if (horizontalHit && passedTop) {
      player.y = platform.y - player.height;
      player.vy = settings.normalJump;
      spawnEffect("land", player.x + player.width / 2, platform.y + 6);
      spawnEffect("jump", player.x + player.width / 2, platform.y);
      playLandSound();
      playJumpSound();
      return;
    }
  }
}

function handleBoostPickup(player) {
  if (!player.alive) return;

  const playerBox = { x: player.x, y: player.y, width: player.width, height: player.height };

  state.boosts = state.boosts.filter((boost) => {
    const boostBox = { x: boost.x, y: boost.y, width: boost.size, height: boost.size };
    const picked = intersects(playerBox, boostBox);

    if (picked) {
      player.vy = settings.boostJump;
      spawnEffect("boost", boost.x + boost.size / 2, boost.y + boost.size / 2);
      spawnEffect("pickup", boost.x + boost.size / 2, boost.y);
      playBoostSound();
      setStatus(`${slotLabel(player.slot)} ${BOOST_META[boost.kind].message}!`);
      boost.el.remove();
      return false;
    }

    return true;
  });
}

function updateBestHeight(player) {
  const climbed = Math.max(0, Math.round((settings.startLineY - player.y) / 10));
  player.bestHeight = Math.max(player.bestHeight, climbed);
}

function eliminatePlayer(player) {
  if (!player.alive) return;

  player.alive = false;
  player.vx = 0;
  player.vy = 0;
  player.el.classList.add("is-eliminated");
  releaseTouchForSlot(player.slot);
  state.playerTouchDirections[player.slot] = 0;

  const survivors = state.players.filter((entry) => entry.alive);
  if (survivors.length === 0) {
    endGame();
    return;
  }

  setStatus(`${slotLabel(player.slot)} 탈락! ${survivors.map((entry) => slotLabel(entry.slot)).join(" / ")} 계속 진행`);
}

function applyInput(player) {
  if (!player.alive) return;

  const direction = getPlayerDirection(player.slot);
  player.vx = direction * settings.moveSpeed;
  player.x += player.vx;
  player.x = clamp(player.x, 0, settings.worldWidth - player.width);
}

function updatePlayers() {
  state.players.forEach((player) => {
    if (!player.alive) return;

    applyInput(player);
    const previousY = player.y;
    player.vy += settings.gravity;
    player.y += player.vy;

    handleLanding(player, previousY);
    handleBoostPickup(player);
    updateBestHeight(player);

    if (player.y > state.cameraY + arena.clientHeight + 140) {
      eliminatePlayer(player);
    }
  });
}

function updateCamera() {
  const alivePlayers = state.players.filter((player) => player.alive);
  if (alivePlayers.length === 0) return;

  const lowestVisiblePlayerY = Math.max(...alivePlayers.map((player) => player.y));
  const target = Math.min(state.cameraY, lowestVisiblePlayerY - arena.clientHeight * 0.78);
  state.cameraY += (target - state.cameraY) * 0.16;
}

function updatePlayerVisualState(player) {
  const avatar = player.avatarEl;
  if (!avatar) return;

  let pose = "jump_neutral";
  if (player.vy > 0.8) {
    pose = "fall_neutral";
  } else if (player.vx < -0.35) {
    pose = "jump_left";
  } else if (player.vx > 0.35) {
    pose = "jump_right";
  }

  if (player.pose !== pose && player.spriteEl) {
    player.pose = pose;
    player.spriteEl.src = getSpriteSrc(getCharacter(state.setup[player.slot].characterId), pose);
  }

  avatar.classList.toggle("is-left", player.vx < -0.35);
  avatar.classList.toggle("is-right", player.vx > 0.35);
  avatar.classList.toggle("is-falling", player.vy > 0.8);
  avatar.classList.toggle("is-rising", player.vy <= 0.8);
}

function render() {
  applyArenaScale();
  state.platforms.forEach((platform) => {
    platform.el.style.transform = formatWorldTranslate(
      platform.x,
      platform.y - state.cameraY,
      ` rotate(${(platform.rotation || 0).toFixed(2)}deg)`
    );
  });

  state.boosts.forEach((boost) => {
    boost.el.style.transform = formatWorldTranslate(boost.x, boost.y - state.cameraY);
  });

  state.players.forEach((player) => {
    updatePlayerVisualState(player);
    player.el.style.transform = formatWorldTranslate(player.x, player.y - state.cameraY);
  });

  state.effects.forEach((effect) => {
    effect.el.style.setProperty("--ty", `${effect.tyBase - state.cameraY}px`);
  });
}

function updateHud() {
  for (let slot = 0; slot < 2; slot += 1) {
    const player = state.players.find((entry) => entry.slot === slot);
    const active = slot < state.playerCount;

    hudCards[slot].classList.toggle("is-hidden", !active);
    bestEls[slot].textContent = player ? `${player.bestHeight}m` : "0m";

    if (!active) {
      lifeEls[slot].textContent = "대기";
      continue;
    }

    if (!player) {
      lifeEls[slot].textContent = "준비";
      continue;
    }

    lifeEls[slot].textContent = player.alive ? "생존" : "탈락";
  }
}

function loop() {
  if (!state.running) return;

  ensurePlatformsAbove();
  updatePlatformMotionLocal();
  updatePlayers();
  updateCamera();
  render();
  updateHud();

  if (state.running) {
    state.rafId = requestAnimationFrame(loop);
  }
}

function startGame() {
  ensureAudioUnlocked();
  if (isRoomSession) {
    hideResultsOverlay();
    showScreen("play");
    requestAnimationFrame(() => applyArenaScale(true));
    connectNetworkGame();
    return;
  }

  resetWorld();
  hideResultsOverlay();
  showScreen("play");

  state.cameraY = 0;
  state.running = true;
  state.players = [];
  state.keys.clear();
  state.resultSubmitted = false;

  for (let slot = 0; slot < state.playerCount; slot += 1) {
    state.players.push(createPlayer(slot));
  }

  updateHud();
  applyArenaScale(true);
  render();
  setStatus(
    state.playerCount === 2
      ? "두 명 모두 출발! 낮은 플레이어 기준으로 화면이 움직입니다."
      : "화면 왼쪽과 오른쪽을 눌러 점프 경로를 잡아보세요."
  );
  state.rafId = requestAnimationFrame(loop);
}

function endGame() {
  if (isRoomSession) return;

  state.running = false;
  cancelAnimationFrame(state.rafId);
  updateHud();
  submitRoundResult();
  showResultsOverlay();

  const summary = state.players
    .map((player) => `${slotLabel(player.slot)} ${player.bestHeight}m`)
    .join(" / ");
  setStatus(`게임 종료! 최고 기록 ${summary}`);
}

function configureSessionMode() {
  if (!isRoomSession) {
    exitAfterResultsButton.textContent = "허브로 가기";
    backToSetupButton.textContent = "설정";
    restartButton.hidden = false;
    restartButton.textContent = "재시작";
    return;
  }

  state.playerCount = 1;
  setupHintEl.innerHTML =
    "방 플레이에서는 <strong>각 기기마다 캐릭터 1명</strong>을 맡아 같은 맵에서 동시에 점프합니다. " +
    "<strong>A / D</strong> 또는 화면 좌우 터치로 움직이고, 캐릭터와 얼굴을 고른 뒤 방 합류를 누르세요.";

  const twoPlayerButton = playerCountButtons.find((button) => Number(button.dataset.playerCount) === 2);
  if (twoPlayerButton) {
    twoPlayerButton.disabled = true;
    twoPlayerButton.title = "방 플레이에서는 기기당 캐릭터 1명으로 같은 맵에 합류합니다.";
  }

  startButton.textContent = "방 합류";
  restartButton.hidden = true;
  backToSetupButton.textContent = "대기실로";
}

function updatePointerDirection(slot, clientX) {
  const bounds = arena.getBoundingClientRect();
  const midpoint = bounds.left + bounds.width / 2;
  state.playerTouchDirections[slot] = clientX < midpoint ? -1 : 1;
}

function findFreeTouchSlot() {
  const activeSlots = new Set(state.touchAssignments.values());
  for (let slot = 0; slot < state.playerCount; slot += 1) {
    if (!activeSlots.has(slot)) return slot;
  }
  return null;
}

function handlePointerDown(event) {
  ensureAudioUnlocked();
  if (!state.running || state.chatFocused || resultsOverlay.classList.contains("is-active")) return;
  const activeSlots = new Set(state.touchAssignments.values());
  const slot = state.playerCount === 1 ? (activeSlots.has(0) ? null : 0) : findFreeTouchSlot();
  if (slot == null) return;

  event.preventDefault();
  state.touchAssignments.set(event.pointerId, slot);
  updatePointerDirection(slot, event.clientX);

  if (arena.setPointerCapture) {
    arena.setPointerCapture(event.pointerId);
  }

  syncNetworkInput();
}

function handlePointerMove(event) {
  if (!state.touchAssignments.has(event.pointerId)) return;

  event.preventDefault();
  updatePointerDirection(state.touchAssignments.get(event.pointerId), event.clientX);
  syncNetworkInput();
}

function clearPointer(event) {
  if (!state.touchAssignments.has(event.pointerId)) return;

  const slot = state.touchAssignments.get(event.pointerId);
  state.touchAssignments.delete(event.pointerId);
  state.playerTouchDirections[slot] = 0;

  if (arena.releasePointerCapture) {
    arena.releasePointerCapture(event.pointerId);
  }

  syncNetworkInput();
}

function bindSetupEvents() {
  playerCountButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setPlayerCount(Number(button.dataset.playerCount));
    });
  });

  configRefs.forEach((ref, slot) => {
    ref.faceEnabled.addEventListener("change", () => {
      state.setup[slot].faceEnabled = ref.faceEnabled.checked;
      renderSetupUI();
      noteConfigChange();
    });

    ref.faceUpload.addEventListener("change", () => {
      const file = ref.faceUpload.files && ref.faceUpload.files[0];
      if (!file) return;

      if (state.setup[slot].faceUrl.startsWith("blob:")) {
        URL.revokeObjectURL(state.setup[slot].faceUrl);
      }

      state.setup[slot].faceUrl = URL.createObjectURL(file);
      state.setup[slot].faceEnabled = true;
      renderSetupUI();
      noteConfigChange();
    });

    ref.faceScale.addEventListener("input", () => {
      state.setup[slot].faceTransform.scale = Number(ref.faceScale.value) / 100;
      renderSetupUI();
      noteConfigChange();
    });

    ref.photoScale.addEventListener("input", () => {
      state.setup[slot].photoScale = Number(ref.photoScale.value) / 100;
      renderSetupUI();
      noteConfigChange();
    });

    ref.characterScale.addEventListener("input", () => {
      state.setup[slot].characterScale = Number(ref.characterScale.value) / 100;
      renderSetupUI();
      noteConfigChange();
    });

    ref.faceX.addEventListener("input", () => {
      state.setup[slot].faceTransform.x = Number(ref.faceX.value);
      renderSetupUI();
      noteConfigChange();
    });

    ref.faceY.addEventListener("input", () => {
      state.setup[slot].faceTransform.y = Number(ref.faceY.value);
      renderSetupUI();
      noteConfigChange();
    });

    ref.faceReset.addEventListener("click", () => {
      state.setup[slot].faceEnabled = false;
      state.setup[slot].faceTransform = { scale: 1, x: 0, y: 0 };
      state.setup[slot].photoScale = 1;
      state.setup[slot].characterScale = 1;
      renderSetupUI();
      noteConfigChange();
    });
  });

  startButton.addEventListener("click", startGame);
  restartButton.addEventListener("click", () => {
    if (isRoomSession) {
      exitSession();
      return;
    }
    startGame();
  });
  backToSetupButton.addEventListener("click", () => {
    if (isRoomSession) {
      exitSession();
      return;
    }
    hideResultsOverlay();
    stopSoloGame();
    showScreen("setup");
    setStatus("설정을 바꾼 뒤 다시 시작해 보세요.");
  });
  restartFromResultsButton.addEventListener("click", () => {
    if (isRoomSession) {
      exitSession();
      return;
    }

    startGame();
  });
  exitAfterResultsButton.addEventListener("click", exitSession);

  resultsOverlay.addEventListener("pointerdown", (e) => e.stopPropagation());
  chatOverlayEl.addEventListener("pointerdown", (e) => e.stopPropagation());

  arena.addEventListener("pointerdown", handlePointerDown);
  arena.addEventListener("pointermove", handlePointerMove);
  arena.addEventListener("pointerup", clearPointer);
  arena.addEventListener("pointercancel", clearPointer);
}

function bindKeyboardEvents() {
  window.addEventListener("keydown", (event) => {
    ensureAudioUnlocked();
    const trackedKeys = ["a", "A", "d", "D", "ArrowLeft", "ArrowRight"];
    if (!trackedKeys.includes(event.key)) return;
    if (state.chatFocused || isTypingTarget(event.target)) return;

    event.preventDefault();
    state.keys.add(event.key);
    syncNetworkInput();
  });

  window.addEventListener("keyup", (event) => {
    const trackedKeys = ["a", "A", "d", "D", "ArrowLeft", "ArrowRight"];
    if (!trackedKeys.includes(event.key)) return;
    if (state.chatFocused || isTypingTarget(event.target)) return;
    state.keys.delete(event.key);
    syncNetworkInput();
  });

  window.addEventListener("blur", () => {
    state.keys.clear();
    state.touchAssignments.clear();
    state.playerTouchDirections = [0, 0];
    syncNetworkInput(true);
  });
}

function bindChatEvents() {
  chatToggleBtn.addEventListener("click", () => toggleChatInput());

  chatSendBtn.addEventListener("click", sendChat);

  chatInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendChat();
    }
    if (e.key === "Escape") {
      toggleChatInput(false);
      chatInputEl.blur();
    }
  });

  chatInputEl.addEventListener("focus", () => {
    state.chatFocused = true;
    state.keys.clear();
    syncNetworkInput(true);
  });

  chatInputEl.addEventListener("blur", () => {
    state.chatFocused = false;
  });
}

configureSessionMode();
bindSetupEvents();
bindKeyboardEvents();
bindChatEvents();
window.addEventListener("resize", () => applyArenaScale(true));
renderSetupUI();
updateHud();
showScreen("setup");
setStatus(
  isRoomSession
    ? "캐릭터를 고르고 방 합류를 누르면 같은 맵에서 함께 시작합니다."
    : "캐릭터를 고르고 게임 시작을 누르면 바로 플레이 화면으로 넘어갑니다."
);
