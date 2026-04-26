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
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ ...msg, clientSeq: ++clientSeq }));
  }
}

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
      // TODO: Phase C
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
      break;
  }
}

function handleGameEnd(msg) {
  state.phase = 'finished';
  showResultScreen();
  const reasonText = msg.reason === 'abandoned'
    ? '상대가 나갔습니다.'
    : msg.reason === 'ko'
      ? 'KO!'
      : '시간 종료';
  const titleEl = document.getElementById('resultTitle');
  if (titleEl) titleEl.textContent = reasonText;
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
    hint.textContent = state.phase === 'playing'
      ? '리듬 링은 Phase C에서 등장합니다'
      : '곧 시작합니다';
  }
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
    renderPlay();
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

  connect();
  requestAnimationFrame(localTick);
});

// 미사용 변수 경고 무시 — Phase C에서 sendSeq가 TUG_TAP/TUG_ITEM_GRAB에 쓰임
void sendSeq;
