const arena = document.getElementById("arena");
const worldEl = document.getElementById("world");
const statusEl = document.getElementById("status");
const setupHintEl = document.getElementById("setupHint");
const startButton = document.getElementById("startGame");
const restartButton = document.getElementById("restart");
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

const CHARACTER_LIST = [
  { id: "mochi-rabbit", name: "모찌 토끼" },
  { id: "pudding-hamster", name: "푸딩 햄스터" },
  { id: "peach-chick", name: "말랑 병아리" },
];

const CHARACTER_MAP = Object.fromEntries(CHARACTER_LIST.map((character) => [character.id, character]));
const PLATFORM_KINDS = ["leaf", "cloud", "cake"];
const BOOST_META = {
  rocket: { label: "UP", message: "로켓 부스트" },
  star: { label: "GO", message: "별 부스트" },
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

function createTuftMarkup() {
  return '<div class="avatar__tuft"><span></span></div>';
}

function createAvatarMarkup(setup, label, compact = false) {
  const character = getCharacter(setup.characterId);
  const hasCustomFace = Boolean(setup.faceEnabled && setup.faceUrl);
  const classes = ["avatar", `avatar--${character.id}`];

  if (compact) {
    classes.push("avatar--compact");
  }

  const transform = setup.faceTransform;
  const style = `--face-scale:${transform.scale}; --face-x:${transform.x}; --face-y:${transform.y};`;

  return `
    <div class="${classes.join(" ")} is-rising" style="${style}">
      ${label ? `<span class="avatar__label">${label}</span>` : ""}
      <div class="avatar__character">
        <div class="avatar__ear avatar__ear--left"></div>
        <div class="avatar__ear avatar__ear--right"></div>
        ${character.id === "peach-chick" ? createTuftMarkup() : ""}
        <div class="avatar__head">
          <div class="avatar__face-mask">
            ${
              hasCustomFace
                ? `<img class="avatar__face-photo" src="${setup.faceUrl}" alt="" />`
                : `
                  <div class="avatar__face-default">
                    <span class="avatar__eye avatar__eye--left"></span>
                    <span class="avatar__eye avatar__eye--right"></span>
                    <span class="avatar__nose"></span>
                    <span class="avatar__smile"></span>
                  </div>
                `
            }
          </div>
          <div class="avatar__cheek avatar__cheek--left"></div>
          <div class="avatar__cheek avatar__cheek--right"></div>
        </div>
        <div class="avatar__wing avatar__wing--left"></div>
        <div class="avatar__wing avatar__wing--right"></div>
        <div class="avatar__body-core"></div>
        <div class="avatar__paw avatar__paw--left"></div>
        <div class="avatar__paw avatar__paw--right"></div>
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
      ${createAvatarMarkup({ ...createDefaultSetup(character.id), faceEnabled: false }, "", true)}
      <span class="character-option__name">${character.name}</span>
    </button>
  `;
}

function setStatus(message) {
  statusEl.textContent = message;
}

function hideResultsOverlay() {
  resultsOverlay.classList.remove("is-active");
}

function exitSession() {
  if (gameBoot) {
    gameBoot.exit();
    return;
  }

  window.location.href = "/";
}

function submitRoundResult() {
  if (!gameBoot || !gameBoot.isMultiplayer || state.resultSubmitted) return;

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

function renderSetupUI() {
  playerCountButtons.forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.playerCount) === state.playerCount);
  });

  configRefs.forEach((ref, slot) => {
    const setup = state.setup[slot];
    const character = getCharacter(setup.characterId);
    const isActiveSlot = slot < state.playerCount;
    const slidersEnabled = Boolean(setup.faceEnabled && setup.faceUrl);

    ref.card.classList.toggle("is-hidden", !isActiveSlot);
    ref.name.textContent = character.name;
    ref.preview.innerHTML = createAvatarMarkup(setup, `${slot + 1}P`);
    ref.options.innerHTML = CHARACTER_LIST.map((item) =>
      createCharacterOptionMarkup(item, slot, item.id === setup.characterId)
    ).join("");
    ref.faceEnabled.checked = setup.faceEnabled;
    ref.faceScale.value = Math.round(setup.faceTransform.scale * 100);
    ref.faceX.value = setup.faceTransform.x;
    ref.faceY.value = setup.faceTransform.y;
    ref.faceScale.disabled = !slidersEnabled;
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

  const el = document.createElement("div");
  el.className = `platform platform--${kind}`;
  el.style.width = `${width}px`;
  worldEl.appendChild(el);

  const platform = { x, y, width, height: 18, el };

  if (!isBase && Math.random() < 0.2) {
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
  el.innerHTML = createAvatarMarkup(state.setup[slot], `${slot + 1}P`);
  worldEl.appendChild(el);

  return {
    slot,
    x: positions[slot],
    y: settings.startLineY - 42 - slot * 10,
    width: 46,
    height: 46,
    vx: 0,
    vy: settings.normalJump,
    bestHeight: 0,
    alive: true,
    el,
    avatarEl: el.querySelector(".avatar"),
  };
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

  avatar.classList.toggle("is-left", player.vx < -0.35);
  avatar.classList.toggle("is-right", player.vx > 0.35);
  avatar.classList.toggle("is-falling", player.vy > 0.8);
  avatar.classList.toggle("is-rising", player.vy <= 0.8);
}

function render() {
  state.platforms.forEach((platform) => {
    platform.el.style.transform = `translate(${platform.x}px, ${platform.y - state.cameraY}px)`;
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
  updatePlayers();
  updateCamera();
  render();
  updateHud();

  if (state.running) {
    state.rafId = requestAnimationFrame(loop);
  }
}

function startGame() {
  resetWorld();
  hideResultsOverlay();

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
    return;
  }

  state.playerCount = 1;
  setupHintEl.innerHTML =
    "방 플레이에서는 <strong>1P 기록</strong>만 제출됩니다. " +
    "<strong>A / D</strong> 또는 화면 좌우 터치로 움직이고, 게임 종료 후 대기실로 복귀하세요.";

  const twoPlayerButton = playerCountButtons.find((button) => Number(button.dataset.playerCount) === 2);
  if (twoPlayerButton) {
    twoPlayerButton.disabled = true;
    twoPlayerButton.title = "방 플레이에서는 1P 결과만 제출됩니다.";
  }
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
}

function handlePointerMove(event) {
  if (!state.touchAssignments.has(event.pointerId)) return;

  event.preventDefault();
  updatePointerDirection(state.touchAssignments.get(event.pointerId), event.clientX);
}

function clearPointer(event) {
  if (!state.touchAssignments.has(event.pointerId)) return;

  const slot = state.touchAssignments.get(event.pointerId);
  state.touchAssignments.delete(event.pointerId);
  state.playerTouchDirections[slot] = 0;

  if (arena.releasePointerCapture) {
    arena.releasePointerCapture(event.pointerId);
  }
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
      renderSetupUI();
      noteConfigChange();
    });
  });

  startButton.addEventListener("click", startGame);
  restartButton.addEventListener("click", startGame);
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
  });

  window.addEventListener("keyup", (event) => {
    state.keys.delete(event.key);
  });

  window.addEventListener("blur", () => {
    state.keys.clear();
    state.touchAssignments.clear();
    state.playerTouchDirections = [0, 0];
  });
}

configureSessionMode();
bindSetupEvents();
bindKeyboardEvents();
renderSetupUI();
updateHud();
startGame();
