const marker = document.getElementById("marker");
const scoreEl = document.getElementById("score");
const comboEl = document.getElementById("combo");
const timerEl = document.getElementById("timer");
const messageEl = document.getElementById("message");
const restartButton = document.getElementById("restart");

const state = {
  running: false,
  markerY: 0,
  speed: 3.2,
  direction: 1,
  score: 0,
  combo: 0,
  startedAt: 0,
  timeLeft: 30,
  rafId: 0,
  exitTimeoutId: 0,
};

function resetGame() {
  clearTimeout(state.exitTimeoutId);
  state.running = true;
  state.markerY = 0;
  state.speed = 3.2;
  state.direction = 1;
  state.score = 0;
  state.combo = 0;
  state.startedAt = performance.now();
  state.timeLeft = 30;
  scoreEl.textContent = "Score 0";
  comboEl.textContent = "Combo 0";
  timerEl.textContent = "남은 시간 30초";
  messageEl.textContent = "Press space when the marker crosses the line";
  cancelAnimationFrame(state.rafId);
  state.rafId = requestAnimationFrame(tick);
}

function render() {
  marker.style.transform = `translateY(${state.markerY}px)`;
}

function endGame() {
  if (!state.running) return;

  state.running = false;
  cancelAnimationFrame(state.rafId);
  scoreEl.textContent = `Score ${state.score}`;
  comboEl.textContent = `Combo ${state.combo}`;
  timerEl.textContent = "남은 시간 0초";
  messageEl.textContent = `시간 종료! 최종 점수: ${state.score}`;

  if (window.GameBoot && window.GameBoot.isMultiplayer) {
    window.GameBoot.submitResult({ score: state.score });
    state.exitTimeoutId = window.setTimeout(() => {
      window.GameBoot.exit();
    }, 1800);
  }
}

function tick() {
  if (!state.running) return;

  const lane = marker.parentElement.getBoundingClientRect();
  const maxY = lane.height - 36;
  const elapsed = (performance.now() - state.startedAt) / 1000;

  state.timeLeft = Math.max(0, 30 - elapsed);
  timerEl.textContent = `남은 시간 ${Math.ceil(state.timeLeft)}초`;

  if (state.timeLeft === 0) {
    endGame();
    return;
  }

  state.markerY += state.speed * state.direction;

  if (state.markerY <= 0 || state.markerY >= maxY) {
    state.direction *= -1;
    state.markerY = Math.max(0, Math.min(maxY, state.markerY));
  }

  render();
  state.rafId = requestAnimationFrame(tick);
}

function judgeHit() {
  if (!state.running) return;

  const lane = marker.parentElement.getBoundingClientRect();
  const centerY = lane.height / 2 - 18;
  const distance = Math.abs(state.markerY - centerY);

  if (distance < 18) {
    state.combo += 1;
    state.score += 100 + state.combo * 20;
    state.speed = Math.min(state.speed + 0.16, 6.2);
    messageEl.textContent = "Perfect flow";
  } else if (distance < 38) {
    state.combo = 0;
    state.score += 40;
    messageEl.textContent = "Close enough";
  } else {
    state.combo = 0;
    state.score = Math.max(0, state.score - 30);
    messageEl.textContent = "Off beat";
  }

  scoreEl.textContent = `Score ${state.score}`;
  comboEl.textContent = `Combo ${state.combo}`;
}

InputManager.onTap(judgeHit);

restartButton.addEventListener("click", resetGame);

render();
