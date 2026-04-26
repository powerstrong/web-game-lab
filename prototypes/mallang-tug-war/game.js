// === 부트 ===
const boot = window.GameBoot;
let ws = null;
let myPlayerId = boot?.playerId || null;
let myRole = null;
let mySide = null;
let clientSeq = 0;

// === 캐릭터 메타 (jump-climber 자산 재사용) ===
const TUG_CHARACTERS = {
  'mochi-rabbit':    { name: '모찌 토끼',   asset: '토끼 메인 이미지.png' },
  'pudding-hamster': { name: '푸딩 햄스터', asset: '햄스터 메인 이미지.png' },
  'peach-chick':     { name: '말랑 병아리', asset: '병아리 메인 이미지.png' },
};
const TUG_DEFAULT_CHARACTER = 'mochi-rabbit';

function characterAssetPath(characterId) {
  const meta = TUG_CHARACTERS[characterId] || TUG_CHARACTERS[TUG_DEFAULT_CHARACTER];
  return `../jump-climber/assets/${encodeURIComponent(meta.asset)}`;
}

// === 리듬/풀 상수 (서버 SPEC v0.6과 일치) ===
const TUG_RHYTHM_CONFIG = {
  ringIntervalMs: 900,
  ringShrinkDurationMs: 700,
  perfectWindowMs: 120,
  goodWindowMs: 280,
};

const TUG_PULL_POWER = {
  perfect: 0.040,
  good: 0.018,
  miss: -0.005,
};

// === 클라 상태 (서버 권위 상태의 미러) ===
const state = {
  phase: 'waiting',
  durationMs: 30000,
  timeLeftMs: 30000,
  countdownMsLeft: null,
  startedAt: null,
  ropePos: 0,
  players: [],
  myCharacter: TUG_DEFAULT_CHARACTER,
  iAmReady: false,
  winnerId: null,
  endReason: null,
  // Phase C: 리듬 링 + 서버 시각 보정 + 마지막 판정 텍스트
  currentRing: null,             // { id, spawnedAt, centerAt, expiresAt }
  serverClockOffsetMs: 0,        // serverTimeMs - clientNow (로컬 ring 진행도 계산용)
  resolvedRingIds: new Set(),    // 이미 탭한 ring (이중 탭 차단)
  lastJudgement: null,           // { judgement, at, byPlayerId }
};

// === DOM 캐시 ===
const dom = {
  setupScreen: () => document.getElementById('setupScreen'),
  playScreen: () => document.getElementById('playScreen'),
  resultScreen: () => document.getElementById('resultScreen'),
  characterCards: () => Array.from(document.querySelectorAll('[data-character]')),
  readyBtn: () => document.getElementById('tug-ready-btn'),
  readyStatus: () => document.getElementById('readyStatus'),
  connectionStatus: () => document.getElementById('connectionStatus'),
  countdownOverlay: () => document.getElementById('countdownOverlay'),
  countdownLabel: () => document.getElementById('countdownLabel'),
  characterLeft: () => document.getElementById('tugCharLeft'),
  characterRight: () => document.getElementById('tugCharRight'),
  charLeftLabel: () => document.getElementById('tugCharLeftLabel'),
  charRightLabel: () => document.getElementById('tugCharRightLabel'),
  charLeftYou: () => document.getElementById('tugCharLeftYou'),
  charRightYou: () => document.getElementById('tugCharRightYou'),
  timerLabel: () => document.getElementById('tugTimer'),
  rhythmHint: () => document.getElementById('rhythmHint'),
};

// === WebSocket ===
function buildWsUrl(code) {
  const base = (window.WORKER_URL || window.location.origin).replace(/^http/, 'ws');
  return `${base}/api/rooms/${encodeURIComponent(code)}`;
}

function connect() {
  if (!boot?.code) {
    console.warn('[tug-war] GameBoot 없음. 로비 경유 필요.');
    setConnectionStatus('로비에서 입장해 주세요');
    return;
  }

  ws = new WebSocket(buildWsUrl(boot.code));
  ws.addEventListener('open', () => {
    setConnectionStatus('연결됨');
    sendRaw({
      type: 'join_game',
      gameId: 'mallang-tug-war',
      code: boot.code,
      name: boot.name,
      playerId: boot.playerId,
    });
  });
  ws.addEventListener('message', (e) => {
    try {
      handleMessage(JSON.parse(e.data));
    } catch {
      /* ignore malformed messages */
    }
  });
  ws.addEventListener('close', () => {
    setConnectionStatus('연결 끊김');
  });
}

function sendRaw(msg) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function sendSeq(msg) {
  if (ws?.readyState !== WebSocket.OPEN) return null;
  const seq = ++clientSeq;
  ws.send(JSON.stringify({ ...msg, clientSeq: seq }));
  return seq;
}

// clientSeq → 예측 판정. TAP_RESULT 도착 시 동일 판정이면 popup 재시작 생략.
const pendingPredictions = new Map();

function handleMessage(msg) {
  switch (msg.type) {
    case 'TUG_JOINED':
      myRole = msg.role;
      mySide = msg.side || null;
      setConnectionStatus(myRole === 'spectator' ? '관전 중' : `${mySide === 'left' ? '왼쪽' : '오른쪽'} 진영`);
      break;
    case 'TUG_STATE_SYNC':
      applyStateSync(msg.state);
      break;
    case 'TUG_TAP_RESULT':
      handleTapResult(msg);
      break;
    case 'TUG_ITEM_RESULT':
      // TODO: Phase E
      break;
    case 'TUG_GAME_END':
      handleGameEnd(msg);
      break;
    case 'error':
      showToast(msg.message || '오류가 발생했습니다.');
      break;
  }
}

function handleTapResult(msg) {
  // 서버 권위 — ropePos는 서버 값으로 정정 (낙관적 예측 보정)
  if (Number.isFinite(msg.newRopePos)) {
    state.ropePos = msg.newRopePos;
    renderRope();
  }
  // 내 탭에 대한 응답이면 pending 예측을 꺼내서 동일하면 popup 재시작 생략 (Minor 4 회피)
  if (msg.playerId === myPlayerId && msg.clientSeq != null) {
    const predicted = pendingPredictions.get(msg.clientSeq);
    pendingPredictions.delete(msg.clientSeq);
    if (predicted === msg.judgement) {
      // 예측 일치 — UI 재시작 생략. ropePos 보정만 (위에서 이미 처리)
      return;
    }
  }
  showJudgement(msg.judgement, msg.playerId);
}

// === STATE_SYNC 적용 + 화면 전환 ===
function applyStateSync(serverState) {
  if (!serverState) return;

  state.phase = serverState.phase;
  state.durationMs = serverState.durationMs ?? state.durationMs;
  state.timeLeftMs = serverState.timeLeftMs ?? state.timeLeftMs;
  state.countdownMsLeft = serverState.countdownMsLeft ?? null;
  state.startedAt = serverState.startedAt ?? null;
  state.ropePos = serverState.ropePos ?? 0;
  state.players = Array.isArray(serverState.players) ? serverState.players : [];
  state.winnerId = serverState.winnerId ?? null;
  state.endReason = serverState.endReason ?? null;

  // 서버 시각 오프셋 — ring 진행도/판정 예측에 사용 (단순 sample, RTT 절반 미보정).
  if (Number.isFinite(serverState.serverTimeMs)) {
    state.serverClockOffsetMs = serverState.serverTimeMs - Date.now();
  }

  // currentRing 미러. id가 바뀌면 resolvedRingIds 청소.
  const incomingRing = serverState.currentRing || null;
  const prevRingId = state.currentRing?.id || null;
  state.currentRing = incomingRing;
  if (prevRingId && prevRingId !== (incomingRing?.id || null)) {
    state.resolvedRingIds.delete(prevRingId);
  }

  const me = state.players.find((p) => p.id === myPlayerId);
  if (me) {
    state.myCharacter = me.characterId || state.myCharacter;
    state.iAmReady = !!me.ready;
  }

  switch (state.phase) {
    case 'waiting':
      showSetupScreen();
      renderSetup();
      break;
    case 'countdown':
    case 'playing':
      showPlayScreen();
      renderPlay();
      break;
    case 'finished':
      showResultScreen();
      renderResult();
      break;
  }
}

function handleGameEnd(msg) {
  state.phase = 'finished';
  state.winnerId = msg.winnerId ?? null;
  state.endReason = msg.reason ?? null;
  showResultScreen();
  renderResult();
}

function renderResult() {
  const titleEl = document.getElementById('resultTitle');
  const detailEl = document.getElementById('resultDetail');
  if (!titleEl) return;

  let title = '결과';
  if (state.endReason === 'abandoned') {
    title = '상대가 나갔습니다';
  } else if (state.endReason === 'ko') {
    title = state.winnerId === myPlayerId ? 'KO 승!' : 'KO 패배';
  } else if (state.endReason === 'timeout') {
    if (state.winnerId == null) title = '무승부';
    else title = state.winnerId === myPlayerId ? '시간 종료 — 승리' : '시간 종료 — 패배';
  }
  titleEl.textContent = title;

  if (detailEl) {
    if (state.endReason == null) {
      detailEl.textContent = '결과를 불러오는 중...';
    } else {
      const winner = state.players.find((p) => p.id === state.winnerId);
      const me = state.players.find((p) => p.id === myPlayerId);
      const opponent = state.players.find((p) => p.id !== myPlayerId);
      const ropePosText = `최종 줄 위치: ${state.ropePos.toFixed(2)}`;
      const winnerText = winner
        ? `${winner.name} 승`
        : state.endReason === 'abandoned'
          ? '상대 이탈'
          : '무승부';
      const youText = me ? `당신: ${me.name}${opponent ? ` · 상대: ${opponent.name}` : ''}` : '';
      detailEl.textContent = `${winnerText} · ${ropePosText}${youText ? ` · ${youText}` : ''}`;
    }
  }
}

// === Setup 화면 렌더 ===
function renderSetup() {
  const opponent = state.players.find((p) => p.id !== myPlayerId);

  dom.characterCards().forEach((card) => {
    const id = card.dataset.character;
    card.classList.toggle('is-selected', id === state.myCharacter);
  });

  const readyBtn = dom.readyBtn();
  if (readyBtn) {
    if (myRole === 'spectator') {
      readyBtn.disabled = true;
      readyBtn.textContent = '관전 중';
    } else if (state.iAmReady) {
      readyBtn.disabled = true;
      readyBtn.textContent = '대기 중...';
    } else {
      readyBtn.disabled = false;
      readyBtn.textContent = 'Ready';
    }
  }

  const status = dom.readyStatus();
  if (status) {
    if (myRole === 'spectator') {
      status.textContent = '플레이어가 모두 Ready 하면 시작합니다.';
    } else if (!opponent) {
      status.textContent = '상대 입장 대기 중...';
    } else {
      const oppReady = opponent.ready ? 'Ready ✅' : '대기 중';
      const oppName = opponent.name || '상대';
      status.textContent = `${oppName}: ${oppReady}`;
    }
  }
}

// === Play 화면 렌더 ===
function renderPlay() {
  const left = state.players.find((p) => p.side === 'left');
  const right = state.players.find((p) => p.side === 'right');

  paintCharacterSlot(dom.characterLeft(), dom.charLeftLabel(), dom.charLeftYou(), left);
  paintCharacterSlot(dom.characterRight(), dom.charRightLabel(), dom.charRightYou(), right);

  const overlay = dom.countdownOverlay();
  const label = dom.countdownLabel();
  if (overlay && label) {
    if (state.phase === 'countdown' && state.countdownMsLeft != null) {
      overlay.classList.add('is-visible');
      const sec = Math.max(1, Math.ceil(state.countdownMsLeft / 1000));
      label.textContent = String(sec);
    } else {
      overlay.classList.remove('is-visible');
    }
  }

  const timer = dom.timerLabel();
  if (timer) {
    const seconds = Math.max(0, Math.ceil(state.timeLeftMs / 1000));
    timer.textContent = state.phase === 'playing' ? `${seconds}s` : '00';
  }

  const hint = dom.rhythmHint();
  if (hint) {
    if (state.phase === 'playing') {
      hint.textContent = state.currentRing ? '탭!' : '대기...';
    } else {
      hint.textContent = '곧 시작합니다';
    }
  }

  renderRope();
}

// 줄 위치 시각화 — ropePos에 따라 캐릭터/줄 마커를 평행 이동.
// ropePos > 0 (left 우세) → 양쪽 모두 right 방향으로 이동 (right가 화면 끝쪽으로 끌려감 효과)
function renderRope() {
  const arena = document.querySelector('.arena');
  if (!arena) return;
  const arenaWidth = arena.clientWidth || 360;
  const offsetPx = state.ropePos * arenaWidth * 0.32;

  const charLeftWrap = document.querySelector('.tug-character--left');
  const charRightWrap = document.querySelector('.tug-character--right');
  const ropeMark = document.querySelector('.tug-rope span');

  if (charLeftWrap) charLeftWrap.style.transform = `translateX(${offsetPx}px)`;
  if (charRightWrap) charRightWrap.style.transform = `translateX(${offsetPx}px)`;
  if (ropeMark) ropeMark.style.transform = `translate(calc(-50% + ${offsetPx}px), -50%)`;
}

// 리듬 링 시각화 — 매 프레임 호출. 가이드(고정 작은 원) + 수축 링(큰 → 작아짐).
// SVG 없이 div 두 개의 width/height transition으로 표현.
function renderRing() {
  const guide = document.getElementById('rhythmGuide');
  const shrink = document.getElementById('rhythmShrink');
  const container = document.getElementById('rhythmRing');
  if (!container || !guide || !shrink) return;

  if (state.phase !== 'playing' || !state.currentRing) {
    container.classList.remove('is-active');
    shrink.style.transform = 'translate(-50%, -50%) scale(2)';
    shrink.style.opacity = '0';
    return;
  }

  container.classList.add('is-active');
  const ring = state.currentRing;
  const serverNow = Date.now() + state.serverClockOffsetMs;
  const total = ring.centerAt - ring.spawnedAt;
  let t;
  if (serverNow <= ring.spawnedAt) t = 0;
  else if (serverNow >= ring.expiresAt) t = 1.4;
  else if (serverNow <= ring.centerAt) t = (serverNow - ring.spawnedAt) / total;
  else {
    // centerAt 이후 — good window 동안 가이드 안쪽으로 사그라듦
    const tail = (serverNow - ring.centerAt) / (ring.expiresAt - ring.centerAt);
    t = 1 + tail * 0.4;
  }

  // t=0: 큰 외곽(scale 2.0) / t=1: 가이드와 일치(scale 1.0) / t>1: 안쪽(scale<1)
  const scale = Math.max(0.4, 2 - t);
  shrink.style.transform = `translate(-50%, -50%) scale(${scale})`;
  shrink.style.opacity = String(Math.max(0, 1 - Math.max(0, t - 1) / 0.4));

  // 퍼펙트 윈도우 근처에서 가이드 글로우
  const delta = Math.abs(serverNow - ring.centerAt);
  if (delta <= TUG_RHYTHM_CONFIG.perfectWindowMs) {
    guide.classList.add('is-perfect');
  } else {
    guide.classList.remove('is-perfect');
  }
}

// 판정 텍스트 popup — 0.6초 fade.
function showJudgement(judgement, byPlayerId) {
  const popup = document.querySelector('.judgement-popup');
  if (!popup) return;
  const isMine = byPlayerId === myPlayerId;
  const text = judgement === 'perfect'
    ? 'PERFECT!'
    : judgement === 'good'
      ? 'GOOD'
      : 'MISS';
  popup.textContent = text;
  popup.dataset.judgement = judgement;
  popup.dataset.owner = isMine ? 'me' : 'opp';
  popup.classList.remove('is-active');
  // reflow → re-trigger CSS animation
  void popup.offsetWidth;
  popup.classList.add('is-active');
}

// 클라 낙관적 판정 — 서버 응답 전 즉시 텍스트 표시. 결과는 TUG_TAP_RESULT가 권위.
function predictJudgement(ring, tapNow) {
  const delta = Math.abs(tapNow - ring.centerAt);
  if (delta <= TUG_RHYTHM_CONFIG.perfectWindowMs) return 'perfect';
  if (delta <= TUG_RHYTHM_CONFIG.goodWindowMs) return 'good';
  return 'miss';
}

// 탭 핸들러 — playing이고 currentRing이 있고 아직 안 탭한 경우 송신 + 즉시 표시.
function handleTapInput(event) {
  if (state.phase !== 'playing') return;
  if (myRole === 'spectator') return;
  if (!myPlayerId) return;
  if (event && event.target && event.target.closest('button, input, [data-no-tap]')) return;

  const ring = state.currentRing;
  const clientNow = Date.now();
  const serverNow = clientNow + state.serverClockOffsetMs;

  if (!ring) {
    // 활성 ring 없을 때 탭 — 서버에 전달, 즉시 miss 표시 (서버도 miss로 응답)
    const seq = sendSeq({ type: 'TUG_TAP', ringId: null, clientTapAt: clientNow });
    if (seq != null) pendingPredictions.set(seq, 'miss');
    showJudgement('miss', myPlayerId);
    return;
  }

  if (state.resolvedRingIds.has(ring.id)) return; // 한 ring 한 탭

  state.resolvedRingIds.add(ring.id);
  const predicted = predictJudgement(ring, serverNow);
  showJudgement(predicted, myPlayerId);

  // 낙관적 ropePos 살짝 적용 — 서버 정정으로 부드럽게 보간됨
  const me = state.players.find((p) => p.id === myPlayerId);
  if (me) {
    const power = TUG_PULL_POWER[predicted] || 0;
    const signed = me.side === 'right' ? -power : power;
    state.ropePos = Math.max(-1, Math.min(1, state.ropePos + signed));
    renderRope();
  }

  const seq = sendSeq({ type: 'TUG_TAP', ringId: ring.id, clientTapAt: clientNow });
  if (seq != null) pendingPredictions.set(seq, predicted);
}

function paintCharacterSlot(imgEl, labelEl, youEl, player) {
  if (!imgEl || !labelEl) return;
  if (!player) {
    imgEl.removeAttribute('src');
    imgEl.style.visibility = 'hidden';
    labelEl.textContent = '대기 중';
    if (youEl) youEl.hidden = true;
    return;
  }
  imgEl.style.visibility = 'visible';
  imgEl.src = characterAssetPath(player.characterId);
  imgEl.alt = TUG_CHARACTERS[player.characterId]?.name || player.characterId;
  labelEl.textContent = player.name || '플레이어';
  if (youEl) youEl.hidden = player.id !== myPlayerId;
}

// === 시간 카운트 갱신 (서버 STATE_SYNC 사이의 보간) ===
let lastTickAt = null;
function localTick(now) {
  if (lastTickAt == null) lastTickAt = now;
  const dt = now - lastTickAt;
  lastTickAt = now;

  if (state.phase === 'countdown' && state.countdownMsLeft != null) {
    state.countdownMsLeft = Math.max(0, state.countdownMsLeft - dt);
    renderPlay();
  } else if (state.phase === 'playing' && state.timeLeftMs > 0) {
    state.timeLeftMs = Math.max(0, state.timeLeftMs - dt);
    // ring/timer만 매 프레임 갱신. 캐릭터/줄은 ropePos 변화 시점에 renderRope()로 따로.
    const timer = dom.timerLabel();
    if (timer) timer.textContent = `${Math.max(0, Math.ceil(state.timeLeftMs / 1000))}s`;
  }

  if (state.phase === 'playing') {
    renderRing();
  }

  requestAnimationFrame(localTick);
}

// === 화면 전환 ===
function showSetupScreen() {
  setActiveScreen('setupScreen');
}

function showPlayScreen() {
  setActiveScreen('playScreen');
}

function showResultScreen() {
  setActiveScreen('resultScreen');
}

function setActiveScreen(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('is-active'));
  document.getElementById(id)?.classList.add('is-active');
}

function setConnectionStatus(text) {
  const el = dom.connectionStatus();
  if (el) el.textContent = text;
}

function showToast(text) {
  console.warn('[tug-war]', text);
  alert(text);
}

// === 부트 ===
document.addEventListener('DOMContentLoaded', () => {
  dom.characterCards().forEach((button) => {
    button.addEventListener('click', () => {
      if (myRole === 'spectator') return;
      if (state.phase !== 'waiting') return;
      const id = button.dataset.character || TUG_DEFAULT_CHARACTER;
      state.myCharacter = id;
      // 서버 권위 — 즉시 UI 반영하되 권위는 STATE_SYNC가 결정
      dom.characterCards().forEach((el) => el.classList.toggle('is-selected', el === button));
      sendRaw({ type: 'TUG_SELECT_CHARACTER', characterId: id });
    });
  });

  const readyBtn = dom.readyBtn();
  if (readyBtn) {
    readyBtn.addEventListener('click', () => {
      if (myRole === 'spectator') return;
      if (state.phase !== 'waiting') return;
      if (state.iAmReady) return;
      sendRaw({ type: 'TUG_READY', ready: true });
      readyBtn.disabled = true;
      readyBtn.textContent = '대기 중...';
    });
  }

  // 화면 어디든 탭 → 리듬 판정 (단, 캐릭터 카드/Ready 버튼/UI 요소는 제외)
  const arena = document.querySelector('.arena');
  if (arena) {
    arena.addEventListener('pointerdown', (e) => {
      // 카운트다운 중에는 무시
      if (state.phase !== 'playing') return;
      handleTapInput(e);
    });
  }
  // 키보드 탭 (Space) — 데스크톱 테스트 편의용
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    if (state.phase !== 'playing') return;
    e.preventDefault();
    handleTapInput(e);
  });

  connect();
  requestAnimationFrame(localTick);
});
