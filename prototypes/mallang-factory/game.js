'use strict';

// ── 클라이언트 메타데이터 (서버와 동기화 유지) ────────────────────────────
const PART_META = {
  frame:   { name: '프레임', icon: '🔷' },
  circuit: { name: '회로',   icon: '🟩' },
  wheel:   { name: '바퀴',   icon: '🟡' },
  battery: { name: '배터리', icon: '🔋' },
};

const RECIPE_META = {
  mini_bot:     { name: '미니봇',  reward: 100 },
  delivery_bot: { name: '배달봇',  reward: 180 },
  power_bot:    { name: '파워봇',  reward: 200 },
};

const RECIPE_PARTS = {
  mini_bot:     ['frame', 'circuit'],
  delivery_bot: ['frame', 'circuit', 'wheel'],
  power_bot:    ['frame', 'battery', 'wheel'],
};

const PLAYER_COLORS = ['#ff5fa0', '#3baae0'];

// ── 런타임 상태 ────────────────────────────────────────────────────────────
let ws = null;
let serverState = null;
let myPlayerId   = null;
let myPlayerIdx  = 0;   // 0 or 1
let mySelectedOrderId    = null;  // 낙관적 로컬 선택 (ASSIGN 전)
let myActiveWorkbenchId  = null;  // 자재 투입 대상 작업대

let renderFrameId = null;

// ── DOM 참조 ───────────────────────────────────────────────────────────────
const $waitScreen    = document.getElementById('waitScreen');
const $gameScreen    = document.getElementById('gameScreen');
const $resultScreen  = document.getElementById('resultScreen');
const $waitPlayers   = document.getElementById('waitPlayers');
const $waitStatus    = document.getElementById('waitStatus');
const $readyBtn      = document.getElementById('readyBtn');
const $hudTimer      = document.getElementById('hudTimer');
const $hudScore      = document.getElementById('hudScore');
const $hudOrders     = document.getElementById('hudOrders');
const $hudTimerWrap  = $hudTimer.closest('.hud-timer');
const $toastArea     = document.getElementById('toastArea');
const $ordersPanel   = document.getElementById('ordersPanel');
const $workbenchesPanel = document.getElementById('workbenchesPanel');
const $partBtns      = document.querySelectorAll('.part-btn');

// ── 화면 전환 ──────────────────────────────────────────────────────────────
function showScreen(name) {
  [$waitScreen, $gameScreen, $resultScreen].forEach(s => s.classList.remove('is-active'));
  const target = { wait: $waitScreen, game: $gameScreen, result: $resultScreen }[name];
  if (target) target.classList.add('is-active');
}

// ── WebSocket 연결 ─────────────────────────────────────────────────────────
function buildWsUrl(code) {
  const base = (window.WORKER_URL || window.location.origin).replace(/^http/, 'ws');
  return `${base}/api/rooms/${encodeURIComponent(code)}`;
}

function connect() {
  const gameBoot = window.GameBoot;
  if (!gameBoot?.isMultiplayer) {
    $waitStatus.textContent = '로비에서 방 코드로 접속해주세요.';
    return;
  }
  myPlayerId = gameBoot.playerId;

  ws = new WebSocket(buildWsUrl(gameBoot.code));

  ws.addEventListener('open', () => {
    send({
      type: 'join_game',
      gameId: 'mallang-factory',
      code: gameBoot.code,
      name: gameBoot.name,
      playerId: gameBoot.playerId,
    });
  });

  ws.addEventListener('message', e => {
    try { handleMessage(JSON.parse(e.data)); } catch { /* ignore */ }
  });

  ws.addEventListener('close', () => {
    $waitStatus.textContent = '연결이 끊겼습니다. 다시 로비로 돌아가주세요.';
  });
}

function send(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// ── 메시지 수신 ────────────────────────────────────────────────────────────
function handleMessage(msg) {
  switch (msg.type) {
    case 'STATE_SYNC':
      applyState(msg.state);
      break;
    case 'EVENT':
      handleEvent(msg.event, msg.payload);
      break;
    case 'ERROR':
      $waitStatus.textContent = msg.message || '오류가 발생했습니다.';
      break;
  }
}

function applyState(state) {
  serverState = state;

  // 내 플레이어 인덱스 확인
  if (myPlayerId && state.players) {
    const idx = state.players.findIndex(p => p.id === myPlayerId);
    if (idx !== -1) myPlayerIdx = idx;
  }

  switch (state.phase) {
    case 'waiting':
      renderWaiting(state);
      break;
    case 'playing':
      if (!$gameScreen.classList.contains('is-active')) showScreen('game');
      renderGame(state);
      break;
    case 'finished':
      cancelAnimationFrame(renderFrameId);
      renderResult(state);
      showScreen('result');
      break;
  }
}

function handleEvent(event, payload) {
  const messages = {
    ORDER_ASSIGNED: p => `${p.playerName}이 ${p.workbenchId === 'wb1' ? '1번' : '2번'} 작업대에 주문 할당`,
    PART_ADDED:     p => `${p.playerName} → ${PART_META[p.partId]?.icon ?? ''} 투입`,
    HELPED:         p => `${p.playerName} Help!`,
    ASSEMBLY_DONE:  p => `⚙️ ${p.workbenchId === 'wb1' ? '1번' : '2번'} 작업대 조립 완료!`,
    DELIVERED:      p => `✅ ${p.recipeName} 납품 +${p.reward}🪙 [${p.quality}]`,
  };
  const text = messages[event]?.(payload ?? {});
  if (text) {
    const cls = { DELIVERED: 'deliver', HELPED: 'help', ASSEMBLY_DONE: 'event' }[event] || '';
    showToast(text, cls);
  }
}

// ── 대기 화면 렌더링 ────────────────────────────────────────────────────────
function renderWaiting(state) {
  showScreen('wait');
  $readyBtn.disabled = false;

  $waitPlayers.innerHTML = (state.players || []).map((p, i) => {
    const isReady = p.ready;
    return `<div class="wait-player${isReady ? ' wait-player--ready' : ''}">
      <div class="wait-player__dot" style="background:${PLAYER_COLORS[i]};"></div>
      <span>${esc(p.name)}${isReady ? ' ✓' : ''}</span>
    </div>`;
  }).join('');

  const me = state.players?.find(p => p.id === myPlayerId);
  if (me?.ready) {
    $readyBtn.textContent = '대기 중...';
    $readyBtn.disabled = true;
    $waitStatus.textContent = '상대방을 기다리는 중...';
  } else {
    $readyBtn.textContent = '준비 완료!';
    $waitStatus.textContent = `${state.players?.length ?? 0} / 2명 접속됨`;
  }
}

// ── 게임 화면 렌더링 ────────────────────────────────────────────────────────
function renderGame(state) {
  renderHUD(state);
  renderOrders(state);
  renderWorkbenches(state);
  updatePartButtons(state);
}

function renderHUD(state) {
  const t = Math.max(0, Math.ceil(state.timeLeft));
  $hudTimer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  $hudScore.textContent = state.score;
  $hudOrders.textContent = state.ordersCompleted;
  $hudTimerWrap.classList.toggle('is-urgent', state.timeLeft <= 20);
}

function renderOrders(state) {
  if (!state.orders) return;

  const myPlayer    = state.players?.[myPlayerIdx];
  const otherPlayer = state.players?.[myPlayerIdx === 0 ? 1 : 0];

  $ordersPanel.innerHTML = state.orders.map(order => {
    const recipe = RECIPE_META[order.recipeId] ?? {};
    const parts  = RECIPE_PARTS[order.recipeId] ?? [];
    const mySelected    = myPlayer?.selectedOrderId === order.id;
    const otherSelected = otherPlayer?.selectedOrderId === order.id;

    let selClass = '';
    if (mySelected && otherSelected)   selClass = 'is-selected-both';
    else if (mySelected)               selClass = `is-selected-p${myPlayerIdx + 1} is-my-selection`;
    else if (otherSelected)            selClass = `is-selected-p${myPlayerIdx === 0 ? 2 : 1}`;

    const partsHtml = parts.map(p =>
      `<span class="order-card__part">${PART_META[p]?.icon ?? ''} ${PART_META[p]?.name ?? p}</span>`
    ).join('');

    const dotHtml = [
      mySelected ? `<span class="selector-dot" style="background:${PLAYER_COLORS[myPlayerIdx]}"></span>` : '',
      otherSelected ? `<span class="selector-dot" style="background:${PLAYER_COLORS[myPlayerIdx === 0 ? 1 : 0]}"></span>` : '',
    ].join('');

    return `<div class="order-card ${selClass}" data-order-id="${esc(order.id)}">
      <div class="order-card__name">${esc(recipe.name ?? order.recipeId)}</div>
      <div class="order-card__parts">${partsHtml}</div>
      <div class="order-card__reward">🪙 ${recipe.reward ?? '?'}</div>
      <div class="order-card__selector">${dotHtml}</div>
    </div>`;
  }).join('');

  // 이벤트 재바인딩
  $ordersPanel.querySelectorAll('.order-card').forEach(el => {
    el.addEventListener('click', () => onOrderCardTap(el.dataset.orderId));
  });
}

function renderWorkbenches(state) {
  if (!state.workbenches) return;

  const myPlayer    = state.players?.[myPlayerIdx];
  const otherPlayer = state.players?.[myPlayerIdx === 0 ? 1 : 0];
  const now = Date.now();

  $workbenchesPanel.innerHTML = state.workbenches.map(wb => {
    const recipe = wb.recipeId ? RECIPE_META[wb.recipeId] : null;
    const requiredParts = wb.recipeId ? (RECIPE_PARTS[wb.recipeId] ?? []) : [];

    const mySelects    = myPlayer?.selectedWorkbenchId === wb.id;
    const otherSelects = otherPlayer?.selectedWorkbenchId === wb.id;
    const isMyTarget   = myActiveWorkbenchId === wb.id;

    let borderClass = '';
    if (wb.state === 'assembling') borderClass = 'workbench-card--assembling';
    else if (wb.state === 'completed') borderClass = 'workbench-card--completed';
    else if (mySelects && otherSelects) borderClass = '';
    else if (mySelects)  borderClass = `is-selected-p${myPlayerIdx + 1}`;
    else if (otherSelects) borderClass = `is-selected-p${myPlayerIdx === 0 ? 2 : 1}`;

    const myTargetClass = isMyTarget ? 'is-my-target' : '';

    // 자재 체크리스트 렌더
    let partsHtml = '';
    if (wb.recipeId) {
      // 필요 자재별로 체크 상태 계산
      const partsAdded = [...(wb.parts ?? [])];
      partsHtml = `<div class="wb-parts">${requiredParts.map(p => {
        const idx = partsAdded.indexOf(p);
        const filled = idx !== -1;
        if (filled) partsAdded.splice(idx, 1);
        return `<div class="wb-part${filled ? ' is-filled' : ''}">
          <span>${PART_META[p]?.icon ?? ''}</span>
          <span>${PART_META[p]?.name ?? p}</span>
          <span class="wb-part__check">✓</span>
        </div>`;
      }).join('')}</div>`;
    }

    // 조립 진행 바
    let progressHtml = '';
    let progressPct = 0;
    if (wb.state === 'assembling' && wb.assemblyEndsAt && wb.assemblyStartedAt) {
      const total = wb.assemblyEndsAt - wb.assemblyStartedAt;
      const elapsed = now - wb.assemblyStartedAt;
      progressPct = Math.min(100, (elapsed / total) * 100);
    }
    const progressVisible = wb.state === 'assembling' ? 'is-visible' : '';
    progressHtml = `<div class="wb-progress ${progressVisible}">
      <div class="wb-progress__fill" style="width:${progressPct}%"></div>
    </div>`;

    // Help 상태
    const helpVisible = wb.state === 'assembling' ? 'is-visible' : '';
    const helpDots = state.players?.map((p, i) => {
      const helped = wb.helpedBy?.includes(p.id);
      return `<span class="wb-help-dot${helped ? ' is-helped' : ''}" style="${helped ? `background:${PLAYER_COLORS[i]}` : ''}"></span>`;
    }).join('') ?? '';
    const helpHtml = `<div class="wb-help-state ${helpVisible}">
      도움: ${helpDots}
    </div>`;

    // 액션 버튼
    const myHelped = wb.helpedBy?.includes(myPlayerId);
    let actionsHtml = '';
    if (wb.state === 'assembling') {
      actionsHtml = `<div class="wb-actions">
        <button class="wb-btn wb-btn--help${myHelped ? ' is-helped' : ''}" data-wb="${esc(wb.id)}" data-action="help">
          ${myHelped ? '✅ 도움완료' : '🤝 Help'}
        </button>
      </div>`;
    } else if (wb.state === 'completed') {
      actionsHtml = `<div class="wb-actions">
        <button class="wb-btn wb-btn--deliver" data-wb="${esc(wb.id)}" data-action="deliver">
          📦 납품하기
        </button>
      </div>`;
    } else if (wb.state === 'idle' && wb.recipeId) {
      actionsHtml = `<div class="wb-actions">
        <button class="wb-btn wb-btn--clear" data-wb="${esc(wb.id)}" data-action="clear">
          🗑 취소
        </button>
      </div>`;
    }

    // 활성 플레이어 뱃지
    const activeBadge = state.players?.map((p, i) => {
      const active = p.selectedWorkbenchId === wb.id;
      return active ? `<span class="wb-active-dot" style="background:${PLAYER_COLORS[i]}"></span>` : '';
    }).join('') ?? '';

    const label = wb.state === 'idle' && !wb.recipeId
      ? `<div class="workbench-empty">주문 카드를 선택 후 탭하세요</div>`
      : `<div class="workbench-order">${recipe ? esc(recipe.name) : ''}</div>`;

    return `<div class="workbench-card ${borderClass} ${myTargetClass}" data-wb-id="${esc(wb.id)}">
      <div class="workbench-id">${wb.id === 'wb1' ? '1번 작업대' : '2번 작업대'}</div>
      ${label}
      ${partsHtml}
      ${progressHtml}
      ${helpHtml}
      ${actionsHtml}
      <div class="wb-active-players">${activeBadge}</div>
    </div>`;
  }).join('');

  // 이벤트 바인딩
  $workbenchesPanel.querySelectorAll('.workbench-card').forEach(el => {
    el.addEventListener('click', e => {
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        onWorkbenchAction(actionBtn.dataset.action, actionBtn.dataset.wb);
      } else {
        onWorkbenchTap(el.dataset.wbId);
      }
    });
  });
}

// 자재 버튼 활성화/비활성화
function updatePartButtons(state) {
  const wb = state.workbenches?.find(w => w.id === myActiveWorkbenchId);
  const requiredParts = wb?.recipeId ? (RECIPE_PARTS[wb.recipeId] ?? []) : [];
  const addedParts = [...(wb?.parts ?? [])];

  $partBtns.forEach(btn => {
    const partId = btn.dataset.part;
    const isWbReady = wb && wb.state === 'idle';

    if (!isWbReady) {
      btn.disabled = true;
      btn.classList.remove('is-needed');
      return;
    }

    // 이 자재가 레시피에 필요한지 확인
    const idx = requiredParts.indexOf(partId);
    if (idx === -1) {
      btn.disabled = true;
      btn.classList.remove('is-needed');
      return;
    }

    // 이미 채워진 자재인지 확인
    const addedIdx = addedParts.indexOf(partId);
    if (addedIdx !== -1) {
      addedParts.splice(addedIdx, 1);  // 한 개만 소비
      btn.disabled = true;
      btn.classList.remove('is-needed');
      return;
    }

    btn.disabled = false;
    btn.classList.add('is-needed');
  });
}

// ── 결과 화면 렌더링 ───────────────────────────────────────────────────────
function renderResult(state) {
  document.getElementById('resFinalScore').textContent = state.score;
  document.getElementById('resOrders').textContent    = state.ordersCompleted;
  document.getElementById('resPerfect').textContent   = state.perfectCount;
  document.getElementById('resStreak').textContent    = state.maxStreak;

  // 가장 많이 만든 로봇
  const mostMade = state.mostMade ?? {};
  const topRecipe = Object.entries(mostMade).sort((a, b) => b[1] - a[1])[0];
  document.getElementById('resMostMade').textContent = topRecipe
    ? `${RECIPE_META[topRecipe[0]]?.name ?? topRecipe[0]} (${topRecipe[1]}개)`
    : '없음';
}

// ── 사용자 상호작용 ────────────────────────────────────────────────────────
function onOrderCardTap(orderId) {
  // 이미 내 선택이면 해제
  if (mySelectedOrderId === orderId) {
    mySelectedOrderId = null;
    send({ type: 'SELECT_ORDER', orderId: null });
  } else {
    mySelectedOrderId = orderId;
    send({ type: 'SELECT_ORDER', orderId });
  }
}

function onWorkbenchTap(workbenchId) {
  const wb = serverState?.workbenches?.find(w => w.id === workbenchId);
  if (!wb) return;

  // 서버 상태의 내 선택 주문 ID 참조 (로컬보다 서버 기준)
  const myPlayer = serverState?.players?.[myPlayerIdx];
  const pendingOrder = mySelectedOrderId ?? myPlayer?.selectedOrderId;

  if (wb.state === 'idle' && pendingOrder) {
    // 주문 할당 — 단일 메시지로 (레이스컨디션 방지)
    send({ type: 'ASSIGN_ORDER_TO_WORKBENCH', orderId: pendingOrder, workbenchId });
    mySelectedOrderId = null;
    myActiveWorkbenchId = workbenchId;
  } else {
    // 작업대를 자재 투입 대상으로만 설정
    myActiveWorkbenchId = workbenchId;
    send({ type: 'SELECT_WORKBENCH', workbenchId });
  }
  // renderGame은 STATE_SYNC 수신 시 자동 호출 — 낙관적 재렌더 제거
}

function onWorkbenchAction(action, workbenchId) {
  switch (action) {
    case 'help':    send({ type: 'HELP_ASSEMBLY', workbenchId }); break;
    case 'deliver': send({ type: 'DELIVER', workbenchId });       break;
    case 'clear':   send({ type: 'CLEAR_WORKBENCH', workbenchId }); myActiveWorkbenchId = null; break;
  }
}

function onPartTap(partId, btn) {
  if (!myActiveWorkbenchId) {
    showToast('먼저 작업대를 선택하세요!', '');
    return;
  }
  send({ type: 'ADD_PART', workbenchId: myActiveWorkbenchId, partId });
  // 중복 탭 방지: STATE_SYNC가 올 때까지 즉시 비활성화
  if (btn) { btn.disabled = true; btn.classList.remove('is-needed'); }
}

// ── 토스트 메시지 ──────────────────────────────────────────────────────────
function showToast(text, type) {
  const el = document.createElement('div');
  el.className = `toast${type ? ` toast--${type}` : ''}`;
  el.textContent = text;
  $toastArea.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// ── 클라이언트 사이드 렌더 루프 (진행 바만 부드럽게 업데이트) ────────────
function startRenderLoop() {
  function tick() {
    if (serverState?.phase === 'playing') tickProgressBars();
    renderFrameId = requestAnimationFrame(tick);
  }
  cancelAnimationFrame(renderFrameId);
  renderFrameId = requestAnimationFrame(tick);
}

function tickProgressBars() {
  const now = Date.now();
  document.querySelectorAll('.workbench-card').forEach(card => {
    const wbId = card.dataset.wbId;
    const wb = serverState?.workbenches?.find(w => w.id === wbId);
    if (!wb || wb.state !== 'assembling') return;
    const fill = card.querySelector('.wb-progress__fill');
    if (!fill || !wb.assemblyEndsAt || !wb.assemblyStartedAt) return;
    const total = wb.assemblyEndsAt - wb.assemblyStartedAt;
    const elapsed = now - wb.assemblyStartedAt;
    const pct = Math.min(100, (elapsed / total) * 100);
    fill.style.width = `${pct}%`;
  });
}

// ── 유틸 ──────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── 이벤트 바인딩 ──────────────────────────────────────────────────────────
$readyBtn.addEventListener('click', () => {
  $readyBtn.disabled = true;
  $readyBtn.textContent = '대기 중...';
  send({ type: 'FACTORY_READY' });
});

$partBtns.forEach(btn => {
  btn.addEventListener('click', () => onPartTap(btn.dataset.part, btn));
});

document.getElementById('retryBtn').addEventListener('click', () => {
  if (window.GameBoot?.isMultiplayer) {
    window.GameBoot.exit();
  } else {
    showScreen('wait');
  }
});

// ── 시작 ──────────────────────────────────────────────────────────────────
startRenderLoop();
connect();
