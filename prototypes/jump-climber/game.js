const arena = document.getElementById("arena");
const worldEl = document.getElementById("world");
const playerEl = document.getElementById("player");
const heightEl = document.getElementById("height");
const statusEl = document.getElementById("status");
const restartButton = document.getElementById("restart");
const leftBtn = document.getElementById("leftBtn");
const rightBtn = document.getElementById("rightBtn");

const settings = {
  worldWidth: 420,
  gravity: 0.42,
  moveSpeed: 4.6,
  normalJump: -11.5,
  boostJump: -16,
  platformGap: 90,
  platformWidthMin: 80,
  platformWidthMax: 130,
};

const state = {
  running: false,
  rafId: 0,
  keys: new Set(),
  player: {
    x: 180,
    y: 460,
    width: 34,
    height: 34,
    vx: 0,
    vy: 0,
  },
  cameraY: 0,
  bestHeight: 0,
  platforms: [],
  boosts: [],
};

function random(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createPlatform(y, isBase = false) {
  const width = isBase
    ? 180
    : Math.round(random(settings.platformWidthMin, settings.platformWidthMax));
  const x = isBase ? (settings.worldWidth - width) / 2 : random(6, settings.worldWidth - width - 6);

  const el = document.createElement("div");
  el.className = "platform";
  el.style.width = `${width}px`;
  worldEl.appendChild(el);

  const platform = { x, y, width, height: 14, el };

  if (!isBase && Math.random() < 0.18) {
    spawnBoost(platform);
  }

  return platform;
}

function spawnBoost(platform) {
  const el = document.createElement("div");
  el.className = "boost";
  const angel = Math.random() < 0.5;
  el.textContent = angel ? "🪽" : "🍖";
  worldEl.appendChild(el);

  state.boosts.push({
    x: platform.x + platform.width / 2 - 11,
    y: platform.y - 30,
    size: 22,
    type: angel ? "wing" : "meat",
    el,
  });
}

function resetWorld() {
  state.platforms.forEach((platform) => platform.el.remove());
  state.boosts.forEach((boost) => boost.el.remove());
  state.platforms = [];
  state.boosts = [];

  const base = createPlatform(500, true);
  state.platforms.push(base);

  for (let i = 1; i < 30; i += 1) {
    state.platforms.push(createPlatform(500 - i * settings.platformGap));
  }
}

function ensurePlatformsAbove() {
  while (Math.min(...state.platforms.map((platform) => platform.y)) > state.cameraY - 1300) {
    const newTop =
      Math.min(...state.platforms.map((platform) => platform.y)) - settings.platformGap;
    state.platforms.push(createPlatform(newTop));
  }

  const cleanupLimit = state.cameraY + 900;
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

function applyInput() {
  let direction = 0;
  if (state.keys.has("ArrowLeft")) direction -= 1;
  if (state.keys.has("ArrowRight")) direction += 1;

  state.player.vx = direction * settings.moveSpeed;
  state.player.x += state.player.vx;
  state.player.x = clamp(state.player.x, 0, settings.worldWidth - state.player.width);
}

function intersects(a, b) {
  return !(
    a.x + a.width < b.x ||
    a.x > b.x + b.width ||
    a.y + a.height < b.y ||
    a.y > b.y + b.height
  );
}

function handleLanding(previousY) {
  if (state.player.vy <= 0) return;

  const feetNow = state.player.y + state.player.height;
  const feetBefore = previousY + state.player.height;

  for (const platform of state.platforms) {
    const horizontalHit =
      state.player.x + state.player.width > platform.x &&
      state.player.x < platform.x + platform.width;
    const passedTop = feetBefore <= platform.y && feetNow >= platform.y;

    if (horizontalHit && passedTop) {
      state.player.y = platform.y - state.player.height;
      state.player.vy = settings.normalJump;
      statusEl.textContent = "점프 성공! 계속 올라가세요";
      return;
    }
  }
}

function handleBoostPickup() {
  const playerBox = {
    x: state.player.x,
    y: state.player.y,
    width: state.player.width,
    height: state.player.height,
  };

  state.boosts = state.boosts.filter((boost) => {
    const boostBox = { x: boost.x, y: boost.y, width: boost.size, height: boost.size };
    const picked = intersects(playerBox, boostBox);

    if (picked) {
      state.player.vy = settings.boostJump;
      statusEl.textContent = boost.type === "wing" ? "천사날개 부스트!" : "고기 파워 점프!";
      boost.el.remove();
      return false;
    }

    return true;
  });
}

function updateCamera() {
  const target = Math.min(state.cameraY, state.player.y - 300);
  state.cameraY += (target - state.cameraY) * 0.18;
}

function updatePhysics() {
  applyInput();

  const previousY = state.player.y;
  state.player.vy += settings.gravity;
  state.player.y += state.player.vy;

  handleLanding(previousY);
  handleBoostPickup();
  updateCamera();

  const climbed = Math.max(0, Math.round((500 - state.player.y) / 10));
  state.bestHeight = Math.max(state.bestHeight, climbed);
  heightEl.textContent = `Height ${state.bestHeight}m`;

  if (state.player.y > state.cameraY + arena.clientHeight + 120) {
    endGame();
  }
}

function render() {
  playerEl.style.transform = `translate(${state.player.x}px, ${state.player.y - state.cameraY}px)`;

  state.platforms.forEach((platform) => {
    platform.el.style.transform = `translate(${platform.x}px, ${platform.y - state.cameraY}px)`;
  });

  state.boosts.forEach((boost) => {
    boost.el.style.transform = `translate(${boost.x}px, ${boost.y - state.cameraY}px)`;
  });
}

function loop() {
  if (!state.running) return;

  ensurePlatformsAbove();
  updatePhysics();
  render();

  state.rafId = requestAnimationFrame(loop);
}

function startGame() {
  cancelAnimationFrame(state.rafId);
  resetWorld();

  state.running = true;
  state.player.x = 190;
  state.player.y = 466;
  state.player.vx = 0;
  state.player.vy = settings.normalJump;
  state.cameraY = 0;
  state.bestHeight = 0;

  heightEl.textContent = "Height 0m";
  statusEl.textContent = "좌우로 착지하며 살아남으세요";

  render();
  state.rafId = requestAnimationFrame(loop);
}

function endGame() {
  state.running = false;
  cancelAnimationFrame(state.rafId);
  statusEl.textContent = `추락으로 사망! 최고 ${state.bestHeight}m`;
}

function bindTouch(button, key) {
  const on = (event) => {
    event.preventDefault();
    state.keys.add(key);
  };

  const off = (event) => {
    event.preventDefault();
    state.keys.delete(key);
  };

  button.addEventListener("pointerdown", on);
  button.addEventListener("pointerup", off);
  button.addEventListener("pointerleave", off);
  button.addEventListener("pointercancel", off);
}

window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    state.keys.add(event.key);
  }
});

window.addEventListener("keyup", (event) => {
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    state.keys.delete(event.key);
  }
});

restartButton.addEventListener("click", startGame);
bindTouch(leftBtn, "ArrowLeft");
bindTouch(rightBtn, "ArrowRight");

startGame();
