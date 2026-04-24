'use strict';

const TOOL_META = {
  balloon: { name: '풍선', icon: '🎈', role: 'air' },
  wind: { name: '바람', icon: '💨', role: 'air' },
  cushion: { name: '쿠션', icon: '🟩', role: 'ground' },
  spring: { name: '점프대', icon: '🟨', role: 'ground' },
};

const ROLE_LABELS = {
  air: 'P1 공중 지원',
  ground: 'P2 지상 구조',
};

const EVENT_TEXT = {
  ROUND_START: '구조 시작!',
  RESCUE_SUCCESS: '구조 성공!',
  COOP_RESCUE: '협동 구조!',
  MISS: '놓쳤다!',
  TOOL_PLACED: '도구 설치!',
  ROUND_FINISHED: '라운드 종료!',
};

let ws = null;
let serverState = null;
let myPlayerId = null;
let myRole = null;
let mySelectedTool = null;
let lastEventKey = '';

const $waitScreen = document.getElementById('waitScreen');
const $gameScreen = document.getElementById('gameScreen');
const $resultScreen = document.getElementById('resultScreen');
const $waitStatus = document.getElementById('waitStatus');
const $playerList = document.getElementById('playerList');
const $readyBtn = document.getElementById('readyBtn');
const $timeLeft = document.getElementById('timeLeft');
const $score = document.getElementById('score');
const $combo = document.getElementById('combo');
const $stage = document.getElementById('stage');
const $entityLayer = document.getElementById('entityLayer');
const $toastArea = document.getElementById('toastArea');
const $roleBadge = document.getElementById('roleBadge');
const $selectedToolLabel = document.getElementById('selectedToolLabel');
const $toolButtons = document.getElementById('toolButtons');
const $grade = document.getElementById('grade');
const $resultTitle = document.getElementById('resultTitle');
const $finalScore = document.getElementById('finalScore');
const $rescuedCount = document.getElementById('rescuedCount');
const $missedCount = document.getElementById('missedCount');
const $maxCombo = document.getElementById('maxCombo');
const $coopCount = document.getElementById('coopCount');
const $exitBtn = document.getElementById('exitBtn');

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.lane').forEach((lane) => {
    lane.addEventListener('click', () => placeSelectedTool(Number(lane.dataset.lane)));
  });
  $readyBtn.addEventListener('click', () => {
    send({ type: 'RESCUE_READY', ready: true });
    $readyBtn.disabled = true;
  });
  $exitBtn.addEventListener('click', () => window.GameBoot.exit());
  connect();
});

function showScreen(name) {
  [$waitScreen, $gameScreen, $resultScreen].forEach((screen) => screen.classList.remove('is-active'));
  const target = { wait: $waitScreen, game: $gameScreen, result: $resultScreen }[name];
  if (target) target.classList.add('is-active');
}

function buildWsUrl(code) {
  const base = (window.WORKER_URL || window.location.origin).replace(/^http/, 'ws');
  return `${base}/api/rooms/${encodeURIComponent(code)}`;
}

function connect() {
  const boot = window.GameBoot;
  if (!boot?.isMultiplayer || !boot.code || !boot.playerId) {
    $waitStatus.textContent = '로비에서 방을 만들고 2명이 입장한 뒤 시작해 주세요.';
    return;
  }

  myPlayerId = boot.playerId;
  ws = new WebSocket(buildWsUrl(boot.code));

  ws.addEventListener('open', () => {
    send({
      type: 'join_game',
      gameId: 'mallang-rescue',
      code: boot.code,
      name: boot.name,
      playerId: boot.playerId,
    });
  });

  ws.addEventListener('message', (event) => {
    try {
      handleMessage(JSON.parse(event.data));
    } catch {
      showToast('알 수 없는 메시지를 받았습니다.');
    }
  });

  ws.addEventListener('close', () => {
    $waitStatus.textContent = '연결이 끊겼습니다. 로비에서 다시 입장해 주세요.';
    $readyBtn.disabled = true;
  });
}

function send(message) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function handleMessage(message) {
  switch (message.type) {
    case 'RESCUE_JOINED':
      myRole = message.role;
      renderRole();
      break;
    case 'STATE_SYNC':
      applyState(message.state);
      break;
    case 'EVENT':
      handleEvent(message.event, message.payload);
      break;
    case 'ERROR':
      showToast(message.message || '도구를 사용할 수 없습니다.');
      shakeSelectedTool();
      break;
    default:
      break;
  }
}

function applyState(state) {
  serverState = state;
  const me = state.players?.find((player) => player.id === myPlayerId);
  if (me) {
    myRole = me.role;
    mySelectedTool = me.selectedTool || mySelectedTool || defaultToolForRole(myRole);
  }

  if (state.lastEvent) {
    const key = `${state.lastEvent.type}:${state.lastEvent.at || ''}:${state.lastEvent.fallerId || ''}`;
    if (key !== lastEventKey) {
      lastEventKey = key;
      handleEvent(state.lastEvent.type, state.lastEvent);
    }
  }

  if (state.phase === 'waiting') {
    showScreen('wait');
    renderWaiting(state);
  } else if (state.phase === 'playing') {
    showScreen('game');
    renderGame(state);
  } else if (state.phase === 'finished') {
    renderResult(state);
    showScreen('result');
  }
}

function renderWaiting(state) {
  renderRole();
  const connected = (state.players || []).filter((player) => player.connected).length;
  $waitStatus.textContent = connected < 2
    ? `${connected}/2명 입장. 링크를 공유해 구조대원을 기다리는 중입니다.`
    : '두 명이 모였습니다. Ready를 누르면 75초 구조가 시작됩니다.';

  $playerList.innerHTML = (state.players || []).map((player) => {
    const ready = player.ready ? 'Ready' : player.connected ? '대기 중' : '미접속';
    return `<div class="player-row">
      <strong>${escapeHtml(player.name)}</strong>
      <span class="player-role ${player.role}">${ROLE_LABELS[player.role]} · ${ready}</span>
    </div>`;
  }).join('');

  const me = state.players?.find((player) => player.id === myPlayerId);
  $readyBtn.disabled = !me?.connected || me.ready || connected < 2;
  $readyBtn.textContent = me?.ready ? 'Ready 완료' : 'Ready';
}

function renderGame(state) {
  renderHud(state);
  renderRole();
  renderEntities(state);
  renderToolButtons(state);
}

function renderHud(state) {
  const time = Math.max(0, Math.ceil((state.timeLeftMs || 0) / 1000));
  $timeLeft.textContent = `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`;
  $score.textContent = String(state.score || 0);
  $combo.textContent = String(state.combo || 0);
}

function renderRole() {
  const label = myRole ? ROLE_LABELS[myRole] : '역할 확인 중';
  $roleBadge.textContent = label;
  $roleBadge.classList.toggle('ground', myRole === 'ground');
  const tool = TOOL_META[mySelectedTool];
  $selectedToolLabel.textContent = tool ? `선택: ${tool.icon} ${tool.name}` : '선택 도구 없음';
}

function renderEntities(state) {
  const fallers = (state.fallers || []).map((faller) => {
    const y = clamp(faller.y, -10, 104);
    return `<div class="faller ${faller.slowedByBalloon ? 'slowed' : ''}" style="--lane:${faller.lane};--y:${y};">
      ${faller.icon || fallerIcon(faller.type)}
    </div>`;
  }).join('');

  const tools = (state.tools || []).map((tool) => {
    const meta = TOOL_META[tool.type] || {};
    const mine = tool.ownerPlayerId === myPlayerId ? 'mine' : 'other';
    return `<div class="tool ${tool.type} ${mine}" style="--lane:${tool.lane};" title="${meta.name || tool.type}">
      ${meta.icon || '?'}
    </div>`;
  }).join('');

  $entityLayer.innerHTML = fallers + tools;
}

function renderToolButtons(state) {
  if (!myRole) return;
  const now = Date.now();
  const tools = Object.entries(TOOL_META).filter(([, meta]) => meta.role === myRole);
  const cooldowns = state.cooldowns?.[myPlayerId] || {};

  $toolButtons.innerHTML = tools.map(([id, meta]) => {
    const readyAt = cooldowns[id] || 0;
    const remaining = Math.max(0, readyAt - now);
    const total = id === 'wind' ? 5000 : id === 'spring' ? 6000 : 2500;
    const ratio = clamp(remaining / total, 0, 1);
    const selected = mySelectedTool === id;
    return `<button class="tool-btn ${selected ? 'selected' : ''} ${remaining > 0 ? 'cooling' : ''}" type="button" data-tool="${id}" style="--cooldown:${ratio};">
      <span class="tool-icon">${meta.icon}</span>
      <span class="tool-name">${meta.name}</span>
      <span class="cooldown-text">${remaining > 0 ? `${(remaining / 1000).toFixed(1)}s` : '준비됨'}</span>
    </button>`;
  }).join('');

  $toolButtons.querySelectorAll('.tool-btn').forEach((button) => {
    button.addEventListener('click', () => selectTool(button.dataset.tool));
  });
}

function selectTool(toolId) {
  const meta = TOOL_META[toolId];
  if (!meta || meta.role !== myRole) {
    shakeSelectedTool();
    return;
  }
  mySelectedTool = toolId;
  renderRole();
  send({ type: 'SELECT_TOOL', toolId });
}

function placeSelectedTool(lane) {
  const toolId = mySelectedTool || defaultToolForRole(myRole);
  if (!toolId || !serverState || serverState.phase !== 'playing') {
    shakeLane(lane);
    return;
  }

  const readyAt = serverState.cooldowns?.[myPlayerId]?.[toolId] || 0;
  if (readyAt > Date.now()) {
    shakeSelectedTool();
    showToast('아직 쿨타임입니다.');
    return;
  }

  send({ type: 'PLACE_TOOL', toolId, lane });
}

function handleEvent(event, payload = {}) {
  const base = EVENT_TEXT[event] || event;
  if (event === 'COOP_RESCUE') {
    showToast(`협동 구조! +${payload.scoreGain || 0}`);
  } else if (event === 'RESCUE_SUCCESS') {
    showToast(`구조 성공 +${payload.scoreGain || 0}`);
  } else if (event === 'MISS') {
    showToast('놓쳤다! 콤보 초기화');
    shakeLane(payload.lane);
  } else if (event === 'ROUND_START' || event === 'ROUND_FINISHED') {
    showToast(base);
  }
}

function renderResult(state) {
  const score = state.score || 0;
  $grade.textContent = getGrade(score);
  $resultTitle.textContent = score >= 3500 ? '훌륭한 구조였어요!' : '다음 구조는 더 멀리 갈 수 있어요.';
  $finalScore.textContent = String(score);
  $rescuedCount.textContent = String(state.rescuedCount || 0);
  $missedCount.textContent = String(state.missedCount || 0);
  $maxCombo.textContent = String(state.maxCombo || 0);
  $coopCount.textContent = String(state.coopCount || 0);
}

function defaultToolForRole(role) {
  return role === 'air' ? 'balloon' : role === 'ground' ? 'cushion' : null;
}

function fallerIcon(type) {
  if (type === 'chick') return '🐥';
  if (type === 'rabbit') return '🐰';
  if (type === 'hamster') return '🐹';
  return '☁️';
}

function getGrade(score) {
  if (score >= 5000) return 'S';
  if (score >= 3500) return 'A';
  if (score >= 2200) return 'B';
  return 'C';
}

function showToast(text) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = text;
  $toastArea.appendChild(toast);
  setTimeout(() => toast.remove(), 1300);
}

function shakeSelectedTool() {
  const selected = $toolButtons.querySelector('.tool-btn.selected') || $toolButtons;
  selected.classList.remove('shake');
  void selected.offsetWidth;
  selected.classList.add('shake');
}

function shakeLane(lane) {
  const laneEl = $stage.querySelector(`[data-lane="${lane}"]`);
  if (!laneEl) return;
  laneEl.classList.remove('shake');
  void laneEl.offsetWidth;
  laneEl.classList.add('shake');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
