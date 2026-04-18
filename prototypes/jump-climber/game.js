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
  platformWidthMin: 92,
  platformWidthMax: 150,
  startLineY: 540,
  playerSpawnOffset: 52,
};

const state = {
  running: false,
  rafId: 0,
  keys: new Set(),
  touchAssignments: new Map(),
  playerTouchDirections: [0, 0],
  playerCount: 1,
  cameraY: 0,
  setup: [createDefaultSetup("mochi-rabbit"), createDefaultSetup("pudding-hamster")],
  players: [],
  platforms: [],
  boosts: [],
  resultSubmitted: false,
  network: {
    ws: null,
    joined: false,
    snapshot: null,
    lastSentDirection: null,
    inputIntervalId: 0,
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

function slotLabel(slot) {
  return `${slot + 1}P`;
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
      ${label ? `<span class="avatar__label">${label}</span>` : ""}
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

function getArenaScale() {
  if (!arena?.clientWidth) return 1;
  return Math.min(1, arena.clientWidth / settings.worldWidth);
}

function applyArenaScale() {
  const scale = getArenaScale();
  worldEl.style.width = `${settings.worldWidth}px`;
  worldEl.style.height = `${Math.ceil(arena.clientHeight / scale)}px`;
  worldEl.style.transform = `scale(${scale})`;
  worldEl.style.transformOrigin = "top left";
}

function clearNetworkWorld() {
  state.network.platformEls.forEach((el) => el.remove());
  state.network.boostEls.forEach((el) => el.remove());
  state.network.playerEls.forEach(({ el }) => el.remove());
  state.network.platformEls.clear();
  state.network.boostEls.clear();
  state.network.playerEls.clear();
  state.network.snapshot = null;
}

function stopNetworkInputLoop() {
  if (state.network.inputIntervalId) {
    clearInterval(state.network.inputIntervalId);
    state.network.inputIntervalId = 0;
  }
}

function stopSoloGame() {
  state.running = false;
  cancelAnimationFrame(state.rafId);
}

function exitSession() {
  stopNetworkInputLoop();
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
    lifeEls[slot].textContent = player ? (player.alive ? `${player.name} 생존` : `${player.name} 탈락`) : "대기";
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

function renderNetworkSnapshot(snapshot) {
  applyArenaScale();
  state.network.snapshot = snapshot;

  syncEntityMap(
    state.network.platformEls,
    snapshot.platforms || [],
    (platform) => {
      const el = document.createElement("div");
      el.className = `platform platform--${platform.kind}`;
      el.style.width = `${platform.width}px`;
      const decoType = PLATFORM_DECO_BY_MOTION[platform.motion?.type] || "";
      if (decoType) {
        el.innerHTML = `<span class="platform-deco platform-deco--${decoType}"></span>`;
      }
      worldEl.appendChild(el);
      return el;
    },
    (el, platform) => {
      el.className = `platform platform--${platform.kind}`;
      el.style.width = `${platform.width}px`;
      const decoType = PLATFORM_DECO_BY_MOTION[platform.motion?.type] || "";
      el.innerHTML = decoType ? `<span class="platform-deco platform-deco--${decoType}"></span>` : "";
      el.style.transform = `translate(${platform.x}px, ${platform.y - snapshot.cameraY}px) rotate(${platform.rotation || 0}deg)`;
    }
  );

  syncEntityMap(
    state.network.boostEls,
    snapshot.boosts || [],
    (boost) => {
      const el = document.createElement("div");
      el.className = `boost boost--${boost.kind}`;
      el.textContent = BOOST_META[boost.kind]?.label || "";
      worldEl.appendChild(el);
      return el;
    },
    (el, boost) => {
      el.className = `boost boost--${boost.kind}`;
      el.textContent = BOOST_META[boost.kind]?.label || "";
      el.style.transform = `translate(${boost.x}px, ${boost.y - snapshot.cameraY}px)`;
    }
  );

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
      const pose = getPoseFromStateLike(player);
      const isLocalPlayer = Boolean(gameBoot?.playerId) && player.id === gameBoot.playerId;
      const setupForRender = isLocalPlayer
        ? state.setup[0]
        : { ...createDefaultSetup(player.characterId), characterId: player.characterId };
      if (entry.characterId !== player.characterId || entry.pose !== pose) {
        entry.el.innerHTML = createAvatarMarkup(
          setupForRender,
          `${player.slot + 1}P`,
          false,
          pose
        );
        entry.avatarEl = entry.el.querySelector(".avatar");
        entry.spriteEl = entry.el.querySelector(".avatar__sprite");
        entry.characterId = player.characterId;
        entry.pose = pose;
      } else if (isLocalPlayer) {
        entry.el.innerHTML = createAvatarMarkup(setupForRender, `${player.slot + 1}P`, false, pose);
        entry.avatarEl = entry.el.querySelector(".avatar");
        entry.spriteEl = entry.el.querySelector(".avatar__sprite");
      }

      entry.el.classList.toggle("is-eliminated", !player.alive);
      if (entry.avatarEl) {
        entry.avatarEl.classList.toggle("is-left", player.vx < -0.35);
        entry.avatarEl.classList.toggle("is-right", player.vx > 0.35);
        entry.avatarEl.classList.toggle("is-falling", player.vy > 0.8);
        entry.avatarEl.classList.toggle("is-rising", player.vy <= 0.8);
      }
      entry.el.style.transform = `translate(${player.x}px, ${player.y - snapshot.cameraY}px)`;
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

function sendNetworkInput(direction) {
  if (!state.network.ws || state.network.ws.readyState !== WebSocket.OPEN) return;
  state.network.ws.send(JSON.stringify({ type: "player_input", direction }));
}

function syncNetworkInput(force = false) {
  if (!isRoomSession) return;
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
  }, 180);
}

function handleNetworkMessage(msg) {
  switch (msg.type) {
    case "jump_state":
      renderNetworkSnapshot(msg);
      break;
    case "scoreboard":
      state.running = false;
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
    setStatus("방에 합류했어요. 친구가 들어오면 같은 맵이 시작됩니다.");
  });

  ws.addEventListener("message", (event) => {
    try {
      handleNetworkMessage(JSON.parse(event.data));
    } catch {
      // ignore malformed packets
    }
  });

  ws.addEventListener("close", () => {
    stopNetworkInputLoop();
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

function createPlatform(y, isBase = false) {
  const width = isBase
    ? 200
    : Math.round(random(settings.platformWidthMin, settings.platformWidthMax));
  const x = isBase ? (settings.worldWidth - width) / 2 : random(10, settings.worldWidth - width - 10);
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
    x: platform.x + platform.width / 2 - 14,
    y: platform.y - 38,
    size: 28,
    kind,
    el,
  });
}

function clearWorld() {
  cancelAnimationFrame(state.rafId);
  worldEl.innerHTML = "";
  state.players = [];
  state.platforms = [];
  state.boosts = [];
  state.touchAssignments.clear();
  state.playerTouchDirections = [0, 0];
}

function resetWorld() {
  clearWorld();

  const base = createPlatform(settings.startLineY, true);
  state.platforms.push(base);

  for (let i = 1; i < 32; i += 1) {
    state.platforms.push(createPlatform(settings.startLineY - i * settings.platformGap));
  }
}

function createPlayer(slot) {
  const positions = state.playerCount === 1 ? [228] : [155, 300];
  const el = document.createElement("div");
  el.className = "player";
  el.innerHTML = createAvatarMarkup(state.setup[slot], `${slot + 1}P`, false, "jump_neutral");
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
    if (!platform.motion || platform.motion.type === "static") {
      platform.x = platform.baseX;
      platform.rotation = 0;
      return;
    }

    const wave = Math.sin(time * platform.motion.speed + platform.motion.phase);
    platform.x = platform.baseX + (platform.motion.type === "drift" ? wave * platform.motion.amplitude : 0);
    platform.rotation = wave * platform.motion.rotateAmplitude;
  });
}

function ensurePlatformsAbove() {
  while (Math.min(...state.platforms.map((platform) => platform.y)) > state.cameraY - 1500) {
    const newTop = Math.min(...state.platforms.map((platform) => platform.y)) - settings.platformGap;
    state.platforms.push(createPlatform(newTop));
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
  const target = Math.min(state.cameraY, lowestVisiblePlayerY - 320);
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
    platform.el.style.transform = `translate(${platform.x}px, ${platform.y - state.cameraY}px) rotate(${platform.rotation || 0}deg)`;
  });

  state.boosts.forEach((boost) => {
    boost.el.style.transform = `translate(${boost.x}px, ${boost.y - state.cameraY}px)`;
  });

  state.players.forEach((player) => {
    updatePlayerVisualState(player);
    player.el.style.transform = `translate(${player.x}px, ${player.y - state.cameraY}px)`;
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

    const characterName = getCharacter(state.setup[slot].characterId).name;
    if (!player) {
      lifeEls[slot].textContent = `${characterName} 준비`;
      continue;
    }

    lifeEls[slot].textContent = player.alive ? `${characterName} 생존` : `${characterName} 탈락`;
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
  if (isRoomSession) {
    hideResultsOverlay();
    showScreen("play");
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
  playTitleEl.textContent = "말랑프렌즈 점프";
  if (!isRoomSession) {
    exitAfterResultsButton.textContent = "허브로 가기";
    backToSetupButton.textContent = "설정으로";
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
  restartButton.textContent = "대기실로 복귀";
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

  arena.addEventListener("pointerdown", handlePointerDown);
  arena.addEventListener("pointermove", handlePointerMove);
  arena.addEventListener("pointerup", clearPointer);
  arena.addEventListener("pointercancel", clearPointer);
}

function bindKeyboardEvents() {
  window.addEventListener("keydown", (event) => {
    const trackedKeys = ["a", "A", "d", "D", "ArrowLeft", "ArrowRight"];
    if (!trackedKeys.includes(event.key)) return;

    event.preventDefault();
    state.keys.add(event.key);
    syncNetworkInput();
  });

  window.addEventListener("keyup", (event) => {
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

configureSessionMode();
bindSetupEvents();
bindKeyboardEvents();
window.addEventListener("resize", applyArenaScale);
renderSetupUI();
updateHud();
showScreen("setup");
setStatus(
  isRoomSession
    ? "캐릭터를 고르고 방 합류를 누르면 같은 맵에서 함께 시작합니다."
    : "캐릭터를 고르고 게임 시작을 누르면 바로 플레이 화면으로 넘어갑니다."
);
