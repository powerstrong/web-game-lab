const arena = document.getElementById("arena");
const playerEl = document.getElementById("player");
const enemyEl = document.getElementById("enemy");
const scoreEl = document.getElementById("score");
const messageEl = document.getElementById("message");
const restartButton = document.getElementById("restart");

const state = {
  running: false,
  player: { x: 80, y: 120, size: 30, speed: 4.8 },
  enemy: { x: 240, y: 180, size: 30, speed: 1.6 },
  keys: new Set(),
  startedAt: 0,
  rafId: 0,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function positionEntity(element, entity) {
  element.style.transform = `translate(${entity.x}px, ${entity.y}px)`;
}

function resetPositions() {
  state.player.x = 80;
  state.player.y = 120;
  state.enemy.x = 260;
  state.enemy.y = 220;
  state.enemy.speed = 1.6;
  positionEntity(playerEl, state.player);
  positionEntity(enemyEl, state.enemy);
}

function endGame(message) {
  state.running = false;
  cancelAnimationFrame(state.rafId);
  messageEl.textContent = message;
}

function isColliding(a, b) {
  return !(
    a.x + a.size < b.x ||
    a.x > b.x + b.size ||
    a.y + a.size < b.y ||
    a.y > b.y + b.size
  );
}

function updatePlayer(bounds) {
  let nextX = state.player.x;
  let nextY = state.player.y;

  if (state.keys.has("ArrowLeft")) nextX -= state.player.speed;
  if (state.keys.has("ArrowRight")) nextX += state.player.speed;
  if (state.keys.has("ArrowUp")) nextY -= state.player.speed;
  if (state.keys.has("ArrowDown")) nextY += state.player.speed;

  state.player.x = clamp(nextX, 0, bounds.width - state.player.size);
  state.player.y = clamp(nextY, 0, bounds.height - state.player.size);
}

function updateEnemy() {
  const dx = state.player.x - state.enemy.x;
  const dy = state.player.y - state.enemy.y;
  const distance = Math.hypot(dx, dy) || 1;

  state.enemy.x += (dx / distance) * state.enemy.speed;
  state.enemy.y += (dy / distance) * state.enemy.speed;
}

function tick() {
  if (!state.running) return;

  const bounds = arena.getBoundingClientRect();
  const elapsed = (performance.now() - state.startedAt) / 1000;

  updatePlayer(bounds);
  updateEnemy();

  state.enemy.speed = 1.6 + elapsed * 0.08;

  positionEntity(playerEl, state.player);
  positionEntity(enemyEl, state.enemy);
  scoreEl.textContent = `Time ${elapsed.toFixed(1)}s`;

  if (isColliding(state.player, state.enemy)) {
    endGame(`Caught after ${elapsed.toFixed(1)}s`);
    return;
  }

  state.rafId = requestAnimationFrame(tick);
}

function startGame() {
  resetPositions();
  state.running = true;
  state.startedAt = performance.now();
  scoreEl.textContent = "Time 0.0s";
  messageEl.textContent = "Survive as long as you can";
  state.rafId = requestAnimationFrame(tick);
}

window.addEventListener("keydown", (event) => {
  if (event.key.startsWith("Arrow")) {
    event.preventDefault();
    state.keys.add(event.key);
  }
});

window.addEventListener("keyup", (event) => {
  state.keys.delete(event.key);
});

restartButton.addEventListener("click", startGame);

resetPositions();
