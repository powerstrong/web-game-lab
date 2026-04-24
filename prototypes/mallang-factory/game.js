/* ===================================================
   말랑프렌즈 팩토리 — game.js
   Phase 1: 기본 뼈대 + 설정 화면 전환
   =================================================== */

'use strict';

// ── 밸런스 설정 (수치 조정은 여기서만) ──────────────────
const GAME_CONFIG = {
  roundDurationSec: 240,
  targetCoins: 800,

  canvas: { width: 800, height: 500 },

  deliveryReward: { normal: 100, good: 110, perfect: 125, miss: 90 },

  assemblyTimeMs: { base: 3000, perfect: 1800, good: 2400, normal: 3000, miss: 3600 },

  qte: {
    // 게이지 0~1 기준 판정 구간 (중앙 기준 대칭)
    perfectWindow: 0.10,
    goodWindow:    0.20,
    normalWindow:  0.35,
    // hamsterQteWindowMultiplier 만큼 각 구간을 넓힘
  },

  helperRobot: {
    level1: { assemblySpeedBonus: 0, upgradeCost: 0 },
    level2: { assemblySpeedBonus: 0.15, upgradeCost: 300 },
  },

  player: {
    baseSpeed: 160,           // px/sec
    interactRange: 52,        // 상호작용 인식 거리 (px)
    rabbit:   { speedMultiplier: 1.05, qteWindowMultiplier: 1.00 },
    hamster:  { speedMultiplier: 1.00, qteWindowMultiplier: 1.05 },
  },

  // 맵 오브젝트 위치 (canvas 800×500 기준)
  map: {
    frameBox:    { x: 60,  y: 180, w: 90, h: 90 },
    circuitBox:  { x: 60,  y: 320, w: 90, h: 90 },
    assemblyTable: { x: 340, y: 220, w: 120, h: 90 },
    deliveryZone:  { x: 630, y: 200, w: 110, h: 120 },
    helperRobot:   { x: 340, y: 380 },
    upgradePanel:  { x: 600, y: 380, w: 130, h: 60 },
  },
};

// ── 에셋 경로 ─────────────────────────────────────────
const ASSETS = {
  rabbit: {
    left:  '/assets/토끼 왼쪽 점프.png',
    right: '/assets/토끼 오른쪽 점프.png',
    up:    '/assets/토끼 점프 위로.png',
    idle:  '/assets/토끼 점프 위로.png',
  },
  hamster: {
    left:  '/assets/햄스터 왼쪽.png',
    right: '/assets/햄스터 오른쪽.png',
    up:    '/assets/햄스터 점프 위로.png',
    idle:  '/assets/햄스터 오른쪽.png',
  },
};

// ── 이미지 프리로드 ───────────────────────────────────
const images = {};
function loadImages(onDone) {
  const entries = [
    ['rabbit_left',   ASSETS.rabbit.left],
    ['rabbit_right',  ASSETS.rabbit.right],
    ['rabbit_idle',   ASSETS.rabbit.idle],
    ['hamster_left',  ASSETS.hamster.left],
    ['hamster_right', ASSETS.hamster.right],
    ['hamster_idle',  ASSETS.hamster.idle],
  ];
  let remaining = entries.length;
  entries.forEach(([key, src]) => {
    const img = new Image();
    img.onload = img.onerror = () => { if (--remaining === 0) onDone(); };
    img.src = src;
    images[key] = img;
  });
}

// ── 게임 상태 ─────────────────────────────────────────
function createGameState() {
  return {
    phase: 'ready',      // ready | playing | success | failed
    timeLeft: GAME_CONFIG.roundDurationSec,
    coins: 0,
    targetCoins: GAME_CONFIG.targetCoins,
    deliveredCount: 0,
    qteStats: { perfect: 0, good: 0, normal: 0, miss: 0 },

    players: [
      createPlayer(0, 'rabbit',  200, 250, { up:'w', down:'s', left:'a', right:'d', action:' ' }),
      createPlayer(1, 'hamster', 560, 250, { up:'arrowup', down:'arrowdown', left:'arrowleft', right:'arrowright', action:'enter' }),
    ],

    items: [],        // { id, type:'frame'|'circuit'|'minibot', x, y, state:'world'|'held'|'placed' }
    nextItemId: 0,

    assemblyTable: {
      slots: { frame: null, circuit: null },  // item id or null
      state: 'empty',   // empty | partial | ready | assembling | done
      assemblyProgress: 0,   // 0..1
      assemblyTimeMs: GAME_CONFIG.assemblyTimeMs.base,
      lastQteGrade: null,    // 'perfect'|'good'|'normal'|'miss'
      resultItem: null,      // completed minibot item id
    },

    qte: {
      active: false,
      gauge: 0,       // 0..1, oscillates
      direction: 1,
      speed: 0.8,     // full sweep per second
      triggerPlayer: null,   // player id who triggered
    },

    helperRobot: {
      level: 1,
      upgrading: false,  // upgrade animation flag
      glowAlpha: 0,
    },

    // 팝업 메시지 (QTE 판정, 이벤트 등)
    popups: [],   // { text, x, y, alpha, vy, color }
  };
}

function createPlayer(id, characterType, x, y, keys) {
  const cfg = GAME_CONFIG.player;
  const charCfg = cfg[characterType];
  return {
    id,
    characterType,
    x,
    y,
    w: 48,
    h: 48,
    speed: cfg.baseSpeed * charCfg.speedMultiplier,
    qteWindowMultiplier: charCfg.qteWindowMultiplier,
    keys,
    facing: 'right',
    carryingItemId: null,
  };
}

// ── 입력 상태 ─────────────────────────────────────────
const keys = {};
const justPressed = {};   // 이번 프레임에 막 눌린 키

window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (!keys[k]) justPressed[k] = true;
  keys[k] = true;
  // 브라우저 기본 동작 방지 (방향키 스크롤 등)
  if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k)) e.preventDefault();
});
window.addEventListener('keyup', e => {
  keys[e.key.toLowerCase()] = false;
});

function consumeJustPressed(key) {
  const k = key.toLowerCase();
  if (justPressed[k]) { delete justPressed[k]; return true; }
  return false;
}

// ── 화면 참조 ─────────────────────────────────────────
const screens = {
  setup:  document.getElementById('setupScreen'),
  game:   document.getElementById('gameScreen'),
  result: document.getElementById('resultScreen'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('is-active'));
  screens[name].classList.add('is-active');
}

// ── HUD 업데이트 ──────────────────────────────────────
function updateHUD(state) {
  const t = state.timeLeft;
  const min = Math.floor(t / 60);
  const sec = Math.floor(t % 60);
  document.getElementById('hudTimer').textContent = `${min}:${sec.toString().padStart(2,'0')}`;
  document.getElementById('hudCoins').textContent = state.coins;
  document.getElementById('hudHelperLevel').textContent = `Lv.${state.helperRobot.level}`;

  // 시간 촉박 경고
  const timerEl = document.getElementById('hudTimer');
  timerEl.style.color = state.timeLeft <= 30 ? '#e05050' : '#4a6fa5';
}

// ── 결과 화면 ─────────────────────────────────────────
function showResult(state) {
  const success = state.phase === 'success';
  document.getElementById('resultBadge').textContent = success ? '🎉' : '😢';
  document.getElementById('resultTitle').textContent  = success ? '성공!' : '아쉽게도 실패...';
  document.getElementById('resFinalCoins').textContent = state.coins;
  document.getElementById('resDelivered').textContent  = state.deliveredCount;
  document.getElementById('resPerfect').textContent    = state.qteStats.perfect;
  document.getElementById('resGood').textContent       = state.qteStats.good;
  showScreen('result');

  if (window.GameBoot?.isMultiplayer) {
    window.GameBoot.submitResult({ score: state.coins });
    setTimeout(() => window.GameBoot.exit(), 3000);
  }
}

// ── 게임 루프 ─────────────────────────────────────────
let gameState = null;
let lastTs = 0;
let rafId = 0;
let canvas, ctx;

function startGame() {
  gameState = createGameState();
  gameState.phase = 'playing';
  showScreen('game');
  lastTs = performance.now();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
}

function tick(ts) {
  const dt = Math.min((ts - lastTs) / 1000, 0.05);  // 최대 50ms cap
  lastTs = ts;

  update(gameState, dt);
  render(gameState);
  updateHUD(gameState);
  clearJustPressed();  // update 이후 소비 안 된 키 정리

  if (gameState.phase === 'playing') {
    rafId = requestAnimationFrame(tick);
  } else {
    showResult(gameState);
  }
}

function clearJustPressed() {
  // justPressed는 keydown에서 세팅, 여기서 매 프레임 초기화
  // (실제 소비는 consumeJustPressed로 함)
  Object.keys(justPressed).forEach(k => delete justPressed[k]);
}

// ── 업데이트 (게임 로직) ──────────────────────────────
function update(state, dt) {
  updateTimer(state, dt);
  state.players.forEach(p => updatePlayer(state, p, dt));
  updateAssembly(state, dt);
  updateQTE(state, dt);
  updatePopups(state, dt);
  updateHelperRobot(state, dt);
}

function updateTimer(state, dt) {
  state.timeLeft -= dt;
  if (state.timeLeft <= 0) {
    state.timeLeft = 0;
    state.phase = state.coins >= state.targetCoins ? 'success' : 'failed';
  }
  if (state.coins >= state.targetCoins && state.phase === 'playing') {
    state.phase = 'success';
  }
}

// ── 플레이어 이동 ─────────────────────────────────────
function updatePlayer(state, player, dt) {
  const { keys: pk, speed } = player;
  let dx = 0, dy = 0;

  if (keys[pk.left])  { dx -= 1; player.facing = 'left'; }
  if (keys[pk.right]) { dx += 1; player.facing = 'right'; }
  if (keys[pk.up])    dy -= 1;
  if (keys[pk.down])  dy += 1;

  if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }

  // QTE 중에는 이동 불가
  if (!state.qte.active || state.qte.triggerPlayer !== player.id) {
    player.x = clamp(player.x + dx * speed * dt, player.w / 2, GAME_CONFIG.canvas.width  - player.w / 2);
    player.y = clamp(player.y + dy * speed * dt, player.h / 2, GAME_CONFIG.canvas.height - player.h / 2);
  }

  // 상호작용 키
  if (consumeJustPressed(pk.action)) {
    handleAction(state, player);
  }
}

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

// ── 상호작용 처리 ─────────────────────────────────────
function handleAction(state, player) {
  const cfg = GAME_CONFIG.map;

  // QTE 진행 중이면 QTE 입력으로 처리
  if (state.qte.active && state.qte.triggerPlayer === player.id) {
    resolveQTE(state, player);
    return;
  }

  // 아이템을 들고 있으면 → 가까운 조립대 또는 납품 구역에 놓기
  if (player.carryingItemId !== null) {
    const item = getItem(state, player.carryingItemId);

    // 납품 구역: 미니봇만 납품 가능
    if (item?.type === 'minibot' && nearStation(player, cfg.deliveryZone)) {
      deliverMinibot(state, player, item);
      return;
    }

    // 조립대: 프레임 또는 회로 놓기
    if ((item?.type === 'frame' || item?.type === 'circuit') && nearStation(player, cfg.assemblyTable)) {
      placeOnAssemblyTable(state, player, item);
      return;
    }

    // 아무것도 없으면 그냥 내려놓기
    dropItem(state, player, item);
    return;
  }

  // 아무것도 안 들고 있을 때 → 가까운 오브젝트 상호작용
  // 바닥에 있는 아이템 집기 (minibot 포함, frame/circuit 포함)
  const nearItem = state.items.find(i => i.state === 'world' && dist(player, i) < GAME_CONFIG.player.interactRange);
  if (nearItem) { pickUp(state, player, nearItem); return; }

  // 조립대 상호작용 (조립 시작)
  if (nearStation(player, cfg.assemblyTable) && state.assemblyTable.state === 'ready') {
    startQTE(state, player);
    return;
  }

  // 업그레이드 패널
  if (nearStation(player, cfg.upgradePanel) && canUpgradeHelper(state)) {
    upgradeHelper(state);
    return;
  }

  // 자재함에서 집기 (월드에 같은 타입 아이템이 많으면 생성 억제)
  const MAX_FLOOR_ITEMS = 6;
  const floorItemCount = state.items.filter(i => i.state === 'world').length;
  if (nearStation(player, cfg.frameBox) && floorItemCount < MAX_FLOOR_ITEMS) {
    spawnAndPickItem(state, player, 'frame');
    return;
  }
  if (nearStation(player, cfg.circuitBox) && floorItemCount < MAX_FLOOR_ITEMS) {
    spawnAndPickItem(state, player, 'circuit');
    return;
  }
}

function nearStation(player, station) {
  const cx = station.x + (station.w || 0) / 2;
  const cy = station.y + (station.h || 0) / 2;
  return dist(player, { x: cx, y: cy }) < GAME_CONFIG.player.interactRange + 16;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ── 아이템 유틸 ──────────────────────────────────────
function getItem(state, id) {
  return state.items.find(i => i.id === id) ?? null;
}

function spawnAndPickItem(state, player, type) {
  // 이미 들고 있으면 불가
  if (player.carryingItemId !== null) return;
  const item = { id: state.nextItemId++, type, x: player.x, y: player.y, state: 'held', carriedBy: player.id };
  state.items.push(item);
  player.carryingItemId = item.id;
  spawnPopup(state, player.x, player.y - 40, type === 'frame' ? '🔩 프레임!' : '💡 회로!', '#7ecfff');
}

function pickUp(state, player, item) {
  if (player.carryingItemId !== null) return;
  item.state = 'held';
  item.carriedBy = player.id;
  player.carryingItemId = item.id;
}

function dropItem(state, player, item) {
  item.state = 'world';
  item.x = player.x;
  item.y = player.y + 30;
  item.carriedBy = null;
  player.carryingItemId = null;
}

// ── 조립대 ───────────────────────────────────────────
function placeOnAssemblyTable(state, player, item) {
  const at = state.assemblyTable;

  // 슬롯에 이미 같은 타입이 있으면 불가
  if (at.slots[item.type] !== null) return;

  at.slots[item.type] = item.id;
  item.state = 'placed';
  item.carriedBy = null;
  player.carryingItemId = null;

  // 두 부품이 모두 올라오면 ready
  at.state = (at.slots.frame !== null && at.slots.circuit !== null) ? 'ready' : 'partial';
  spawnPopup(state, player.x, player.y - 40, '조립대에 올렸어요!', '#ffd740');
}

function updateAssembly(state, dt) {
  const at = state.assemblyTable;
  if (at.state !== 'assembling') return;

  at.assemblyProgress += dt / (at.assemblyTimeMs / 1000);
  if (at.assemblyProgress >= 1) {
    at.assemblyProgress = 1;
    finishAssembly(state);
  }
}

function finishAssembly(state) {
  const at = state.assemblyTable;
  const cfg = GAME_CONFIG.map.assemblyTable;

  // 부품 아이템 제거
  [at.slots.frame, at.slots.circuit].forEach(id => {
    const idx = state.items.findIndex(i => i.id === id);
    if (idx !== -1) state.items.splice(idx, 1);
  });

  // 미니봇 생성
  const minibot = {
    id: state.nextItemId++,
    type: 'minibot',
    x: cfg.x + cfg.w / 2,
    y: cfg.y + cfg.h + 30,
    state: 'world',
    grade: at.lastQteGrade,
  };
  state.items.push(minibot);
  at.resultItem = minibot.id;

  // 조립대 초기화
  at.slots = { frame: null, circuit: null };
  at.state = 'done';
  at.assemblyProgress = 0;
  at.lastQteGrade = null;

  spawnPopup(state, minibot.x, minibot.y - 40, '🤖 미니봇 완성!', '#ff7eb9');
}

// ── QTE 시스템 ────────────────────────────────────────
function startQTE(state, player) {
  state.qte.active = true;
  state.qte.gauge = 0;
  state.qte.direction = 1;
  state.qte.triggerPlayer = player.id;
  state.assemblyTable.state = 'assembling_qte';  // QTE 대기
  spawnPopup(state, GAME_CONFIG.map.assemblyTable.x + 60, GAME_CONFIG.map.assemblyTable.y - 20, '타이밍!', '#ff7eb9');
}

function updateQTE(state, dt) {
  if (!state.qte.active) return;
  const qte = state.qte;
  qte.gauge += dt * qte.speed * qte.direction;
  if (qte.gauge >= 1) { qte.gauge = 1; qte.direction = -1; }
  if (qte.gauge <= 0) { qte.gauge = 0; qte.direction = 1; }
}

function resolveQTE(state, player) {
  const qte = state.qte;
  const g = qte.gauge;
  const center = 0.5;
  const dist_ = Math.abs(g - center);
  const mult = player.qteWindowMultiplier;

  const cfg = GAME_CONFIG.qte;
  let grade;
  if (dist_ <= cfg.perfectWindow * mult) grade = 'perfect';
  else if (dist_ <= cfg.goodWindow * mult)    grade = 'good';
  else if (dist_ <= cfg.normalWindow * mult)  grade = 'normal';
  else                                         grade = 'miss';

  state.qteStats[grade]++;
  state.qte.active = false;
  state.qte.triggerPlayer = null;

  const at = state.assemblyTable;
  const helperBonus = state.helperRobot.level >= 2 ? GAME_CONFIG.helperRobot.level2.assemblySpeedBonus : 0;
  const baseMs = GAME_CONFIG.assemblyTimeMs[grade];
  at.assemblyTimeMs = baseMs * (1 - helperBonus);
  at.assemblyProgress = 0;
  at.state = 'assembling';
  at.lastQteGrade = grade;

  const labels = { perfect: '⭐ PERFECT!', good: '✨ GOOD!', normal: '👍 NORMAL', miss: '💫 MISS' };
  const colors  = { perfect: '#ffd740', good: '#7ecfff', normal: '#aaa', miss: '#e08060' };
  const cfg2 = GAME_CONFIG.map.assemblyTable;
  spawnPopup(state, cfg2.x + 60, cfg2.y - 30, labels[grade], colors[grade]);
}

// ── 납품 ─────────────────────────────────────────────
function deliverMinibot(state, player, item) {
  const grade = item.grade ?? 'normal';
  const reward = GAME_CONFIG.deliveryReward[grade] ?? GAME_CONFIG.deliveryReward.normal;
  state.coins += reward;
  state.deliveredCount++;

  // 아이템 제거
  const idx = state.items.indexOf(item);
  if (idx !== -1) state.items.splice(idx, 1);
  player.carryingItemId = null;

  // 조립대 done 상태 리셋 (다음 생산 대기)
  if (state.assemblyTable.state === 'done') state.assemblyTable.state = 'empty';

  spawnPopup(state, GAME_CONFIG.map.deliveryZone.x + 55, GAME_CONFIG.map.deliveryZone.y - 20, `+${reward} 🪙`, '#ffd740');
}

// ── 도우미 로봇 업그레이드 ────────────────────────────
function canUpgradeHelper(state) {
  return state.helperRobot.level === 1 && state.coins >= GAME_CONFIG.helperRobot.level2.upgradeCost;
}

function upgradeHelper(state) {
  const cost = GAME_CONFIG.helperRobot.level2.upgradeCost;
  state.coins -= cost;
  state.helperRobot.level = 2;
  state.helperRobot.glowAlpha = 1;
  const pos = GAME_CONFIG.map.helperRobot;
  spawnPopup(state, pos.x, pos.y - 60, '🤖✨ Lv.2 업그레이드!', '#ff7eb9');
}

function updateHelperRobot(state, dt) {
  if (state.helperRobot.glowAlpha > 0) {
    state.helperRobot.glowAlpha = Math.max(0, state.helperRobot.glowAlpha - dt * 0.5);
  }
}

// ── 팝업 메시지 ──────────────────────────────────────
function spawnPopup(state, x, y, text, color = '#fff') {
  state.popups.push({ text, x, y, alpha: 1, vy: -60, color });
}

function updatePopups(state, dt) {
  state.popups = state.popups.filter(p => {
    p.y += p.vy * dt;
    p.alpha -= dt * 1.5;
    return p.alpha > 0;
  });
}

// ── 렌더링 ────────────────────────────────────────────
function render(state) {
  const W = GAME_CONFIG.canvas.width;
  const H = GAME_CONFIG.canvas.height;
  const cfg = GAME_CONFIG.map;

  ctx.clearRect(0, 0, W, H);

  // 배경
  drawBackground(W, H);

  // 맵 오브젝트
  drawStation(cfg.frameBox,      '🔩', '프레임 자재함', '#b3e5fc');
  drawStation(cfg.circuitBox,    '💡', '회로 자재함',   '#c8e6c9');
  drawAssemblyTable(state);
  drawDeliveryZone(cfg.deliveryZone, state);
  drawHelperRobot(state);
  drawUpgradePanel(state);

  // 플레이어 (아이템보다 먼저 그려 아이템이 항상 위에 보임)
  state.players.forEach(p => drawPlayer(state, p));

  // 바닥 아이템 (플레이어 위에 그려 가시성 확보)
  state.items.filter(i => i.state === 'world').forEach(i => drawWorldItem(i));

  // QTE 오버레이
  if (state.qte.active) drawQTE(state);

  // 팝업
  state.popups.forEach(p => {
    ctx.globalAlpha = p.alpha;
    ctx.font = 'bold 18px sans-serif';
    ctx.fillStyle = p.color;
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 6;
    ctx.fillText(p.text, p.x, p.y);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  });

  // 코인 충분 → 업그레이드 버튼 강조 힌트
  if (canUpgradeHelper(state)) {
    const p = cfg.upgradePanel;
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(Date.now() / 300);
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#ff7eb9';
    ctx.textAlign = 'center';
    ctx.fillText('👆 업그레이드 가능!', p.x + p.w / 2, p.y - 10);
    ctx.globalAlpha = 1;
  }
}

function drawBackground(W, H) {
  // 파스텔 공방 바닥
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#e8f4ff');
  grad.addColorStop(1, '#fce4f0');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // 격자 바닥 패턴
  ctx.strokeStyle = 'rgba(180,200,240,0.3)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
}

function drawStation(s, icon, label, color) {
  // 둥근 사각형 스테이션
  roundRect(ctx, s.x, s.y, s.w, s.h, 14, color, 'rgba(100,160,220,0.3)', 2);

  ctx.font = '2rem sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(icon, s.x + s.w / 2, s.y + s.h / 2 + 4);

  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = '#556';
  ctx.fillText(label, s.x + s.w / 2, s.y + s.h + 16);
}

function drawAssemblyTable(state) {
  const at = state.assemblyTable;
  const s = GAME_CONFIG.map.assemblyTable;

  // 조립 가능 상태이면 반짝임
  let glow = 'rgba(100,160,220,0.3)';
  if (at.state === 'ready' || at.state === 'assembling_qte') {
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 200);
    glow = `rgba(255,200,50,${0.4 + 0.4 * pulse})`;
  }

  roundRect(ctx, s.x, s.y, s.w, s.h, 14, '#fff9e6', glow, 3);

  ctx.font = '1.6rem sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('⚙️', s.x + s.w / 2, s.y + 36);

  // 부품 슬롯 표시
  const slotY = s.y + s.h - 18;
  ctx.font = '1.1rem sans-serif';
  ctx.fillText(at.slots.frame   !== null ? '🔩' : '○', s.x + s.w / 2 - 18, slotY);
  ctx.fillText(at.slots.circuit !== null ? '💡' : '○', s.x + s.w / 2 + 18, slotY);

  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = '#556';
  ctx.fillText('조립대', s.x + s.w / 2, s.y + s.h + 16);

  // 조립 진행 바
  if (at.state === 'assembling') {
    const bx = s.x, by = s.y + s.h + 22;
    ctx.fillStyle = '#eee';
    ctx.fillRect(bx, by, s.w, 8);
    ctx.fillStyle = '#ffd740';
    ctx.fillRect(bx, by, s.w * at.assemblyProgress, 8);
  }
}

function drawDeliveryZone(s, state) {
  const hasBot = state.players.some(p => {
    const item = getItem(state, p.carryingItemId);
    return item?.type === 'minibot';
  });
  const color = hasBot ? '#ffe082' : '#f8bbd0';
  roundRect(ctx, s.x, s.y, s.w, s.h, 14, color, 'rgba(220,100,150,0.3)', 2);

  ctx.font = '2rem sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('📦', s.x + s.w / 2, s.y + s.h / 2 + 4);

  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = '#556';
  ctx.fillText('납품 구역', s.x + s.w / 2, s.y + s.h + 16);
}

function drawHelperRobot(state) {
  const pos = GAME_CONFIG.map.helperRobot;
  const lv  = state.helperRobot.level;
  const glow = state.helperRobot.glowAlpha;

  if (glow > 0) {
    ctx.globalAlpha = glow * 0.6;
    ctx.fillStyle = '#ffd740';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 50, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Lv.1: 작은 꼬마봇
  if (lv === 1) {
    drawRobotLv1(pos.x, pos.y);
  } else {
    drawRobotLv2(pos.x, pos.y);
  }

  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = '#556';
  ctx.textAlign = 'center';
  ctx.fillText(`도우미 로봇 Lv.${lv}`, pos.x, pos.y + 46);
}

function drawRobotLv1(x, y) {
  // 몸통
  ctx.fillStyle = '#b3d9ff';
  roundRectPath(ctx, x - 18, y - 28, 36, 36, 8);
  ctx.fill();
  ctx.strokeStyle = '#7ab3e0';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 머리
  ctx.fillStyle = '#cce8ff';
  roundRectPath(ctx, x - 14, y - 52, 28, 26, 6);
  ctx.fill();
  ctx.stroke();

  // 눈
  ctx.fillStyle = '#4a90d9';
  ctx.beginPath(); ctx.arc(x - 5, y - 40, 4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 5, y - 40, 4, 0, Math.PI * 2); ctx.fill();

  // 다리
  ctx.fillStyle = '#7ab3e0';
  ctx.fillRect(x - 12, y + 8, 10, 14);
  ctx.fillRect(x + 2,  y + 8, 10, 14);
}

function drawRobotLv2(x, y) {
  // 몸통 (더 크고 노란색 포인트)
  ctx.fillStyle = '#ffd740';
  roundRectPath(ctx, x - 22, y - 32, 44, 40, 10);
  ctx.fill();
  ctx.strokeStyle = '#e6b800';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 몸통 내부 하이라이트
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  roundRectPath(ctx, x - 16, y - 26, 32, 16, 6);
  ctx.fill();

  // 머리 (크고 둥글게)
  ctx.fillStyle = '#ffe780';
  roundRectPath(ctx, x - 18, y - 58, 36, 28, 8);
  ctx.fill();
  ctx.strokeStyle = '#e6b800';
  ctx.stroke();

  // 안테나
  ctx.strokeStyle = '#ff7eb9';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x, y - 58); ctx.lineTo(x, y - 74); ctx.stroke();
  ctx.fillStyle = '#ff7eb9';
  ctx.beginPath(); ctx.arc(x, y - 76, 5, 0, Math.PI * 2); ctx.fill();

  // 눈 (빛나는 파란색)
  ctx.fillStyle = '#0077ff';
  ctx.beginPath(); ctx.arc(x - 6, y - 44, 5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 6, y - 44, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(x - 5, y - 46, 2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 7, y - 46, 2, 0, Math.PI * 2); ctx.fill();

  // 팔
  ctx.strokeStyle = '#e6b800';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - 22, y - 16); ctx.lineTo(x - 38, y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 22, y - 16); ctx.lineTo(x + 38, y); ctx.stroke();
  ctx.lineCap = 'butt';

  // 다리
  ctx.fillStyle = '#e6b800';
  ctx.fillRect(x - 14, y + 8, 12, 16);
  ctx.fillRect(x + 2,  y + 8, 12, 16);
}

function drawUpgradePanel(state) {
  const s = GAME_CONFIG.map.upgradePanel;
  const can = canUpgradeHelper(state);
  const color = can ? '#ffe082' : '#e0e0e0';
  const stroke = can ? 'rgba(255,180,0,0.5)' : 'rgba(180,180,180,0.3)';

  roundRect(ctx, s.x, s.y, s.w, s.h, 10, color, stroke, 2);
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = can ? '#7a5500' : '#aaa';
  ctx.textAlign = 'center';
  ctx.fillText('⬆️ 업그레이드', s.x + s.w / 2, s.y + 22);
  ctx.font = '11px sans-serif';
  ctx.fillText(`300🪙`, s.x + s.w / 2, s.y + 40);
}

function drawWorldItem(item) {
  const icons = { frame: '🔩', circuit: '💡', minibot: '🤖' };
  ctx.font = '1.5rem sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(icons[item.type] ?? '?', item.x, item.y);
}

function drawPlayer(state, player) {
  // 들고 있는 아이템 표시
  if (player.carryingItemId !== null) {
    const item = getItem(state, player.carryingItemId);
    const icons = { frame: '🔩', circuit: '💡', minibot: '🤖' };
    ctx.font = '1.2rem sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(icons[item?.type] ?? '', player.x, player.y - player.h / 2 - 8);
  }

  // 캐릭터 이미지
  const key = player.characterType + '_' + (player.facing === 'left' ? 'left' : 'right');
  const img = images[key];
  const w = player.w, h = player.h;
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, player.x - w / 2, player.y - h / 2, w, h);
  } else {
    // 이미지 없으면 도형으로 대체
    ctx.fillStyle = player.id === 0 ? '#ff7eb9' : '#7ecfff';
    ctx.beginPath();
    ctx.arc(player.x, player.y, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '1.4rem sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(player.characterType === 'rabbit' ? '🐰' : '🐹', player.x, player.y + 6);
  }

  // 플레이어 레이블
  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = player.id === 0 ? '#ff5fa0' : '#3ba8e0';
  ctx.textAlign = 'center';
  ctx.fillText(`${player.id + 1}P`, player.x, player.y + player.h / 2 + 14);
}

function drawQTE(state) {
  const qte = state.qte;
  const W = GAME_CONFIG.canvas.width;

  // 반투명 오버레이
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(0, 0, W, GAME_CONFIG.canvas.height);

  // QTE 게이지 바
  const bx = 200, by = 210, bw = 400, bh = 40;
  ctx.fillStyle = '#fff';
  roundRectPath(ctx, bx - 4, by - 4, bw + 8, bh + 8, 28);
  ctx.fill();

  // 판정 구간 색상
  const cfg = GAME_CONFIG.qte;
  const player = state.players[qte.triggerPlayer];
  const mult = player?.qteWindowMultiplier ?? 1;

  const center = bx + bw / 2;
  drawQTEZone(center, by, bw, bh, cfg.normalWindow  * mult, '#c8e6c9');
  drawQTEZone(center, by, bw, bh, cfg.goodWindow    * mult, '#fff176');
  drawQTEZone(center, by, bw, bh, cfg.perfectWindow * mult, '#ff8a65');

  // 게이지 커서
  const cursorX = bx + qte.gauge * bw;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cursorX, by + bh / 2, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 안내 텍스트
  ctx.font = 'bold 20px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 8;
  const pLabel = qte.triggerPlayer === 0 ? '1P: Space' : '2P: Enter';
  ctx.fillText(`🎯 ${pLabel} — 중앙에서 누르세요!`, W / 2, by - 20);
  ctx.shadowBlur = 0;
}

function drawQTEZone(centerX, by, bw, bh, halfWidth, color) {
  const w = bw * halfWidth * 2;
  const x = centerX - w / 2;
  ctx.fillStyle = color;
  ctx.fillRect(x, by, w, bh);
}

// ── Canvas 유틸 ──────────────────────────────────────
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function roundRect(ctx, x, y, w, h, r, fill, stroke, lineWidth) {
  roundRectPath(ctx, x, y, w, h, r);
  if (fill)   { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth ?? 1; ctx.stroke(); }
}

// ── 엔트리포인트 ──────────────────────────────────────
canvas = document.getElementById('gameCanvas');
ctx    = canvas.getContext('2d');

document.getElementById('startBtn').addEventListener('click', () => {
  loadImages(startGame);
});

document.getElementById('retryBtn').addEventListener('click', () => {
  showScreen('setup');
});
