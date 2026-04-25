// === 부트 ===
const boot = window.GameBoot;
let ws = null;
let myPlayerId = boot?.playerId || null;
let clientSeq = 0;

// === 상태 ===
const state = {
  phase: 'waiting',
  ropePos: 0,
  myCharacter: 'mochi-rabbit',
  players: [],
};

// === WebSocket ===
function buildWsUrl(code) {
  const base = (window.WORKER_URL || window.location.origin).replace(/^http/, 'ws');
  return `${base}/api/rooms/${encodeURIComponent(code)}`;
}

function connect() {
  if (!boot?.code) {
    console.warn('[tug-war] GameBoot 없음. 로비 경유 필요.');
    return;
  }

  ws = new WebSocket(buildWsUrl(boot.code));
  ws.addEventListener('open', () => {
    send({
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
    console.log('[tug-war] WebSocket closed');
  });
}

function send(msg) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ ...msg, clientSeq: ++clientSeq }));
  }
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'TUG_JOINED':
      console.log('[tug-war] joined as', msg.role, 'side:', msg.side);
      setConnectionStatus(msg.role === 'spectator' ? '관전 중' : `${msg.side || 'player'} 준비`);
      showSetupScreen();
      break;
    case 'TUG_STATE_SYNC':
      // TODO: Phase B
      break;
    case 'TUG_TAP_RESULT':
      // TODO: Phase C
      break;
    case 'TUG_ITEM_RESULT':
      // TODO: Phase E
      break;
    case 'TUG_GAME_END':
      // TODO: Phase E
      break;
    case 'error':
      showToast(msg.message || '오류가 발생했습니다.');
      break;
  }
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
  const el = document.getElementById('connectionStatus');
  if (el) el.textContent = text;
}

// === 임시 토스트 ===
function showToast(text) {
  console.warn('[tug-war]', text);
  alert(text);
}

// === 임시 Ready 버튼 핸들러 (placeholder UI) ===
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-character]').forEach((button) => {
    button.addEventListener('click', () => {
      state.myCharacter = button.dataset.character || 'mochi-rabbit';
      document.querySelectorAll('[data-character]').forEach((el) => el.classList.remove('is-selected'));
      button.classList.add('is-selected');
    });
  });

  const readyBtn = document.getElementById('tug-ready-btn');
  if (readyBtn) {
    readyBtn.addEventListener('click', () => {
      send({ type: 'TUG_READY', ready: true });
      readyBtn.disabled = true;
      readyBtn.textContent = '대기 중...';
    });
  }

  connect();
});
