/**
 * room.js — 텐텐오락실 Room Page
 * Plain ES6, no framework, no bundler.
 */

'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

const PLAYER_COLORS = [
  '#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff',
  '#ff6bff', '#ff9a3c', '#00d4ff', '#c084fc',
];

const GAME_META = {
  'dodge-square': { label: 'Dodge Square', icon: '🕹️', path: '../prototypes/dodge-square/' },
  'rhythm-tap':   { label: 'Rhythm Tap',   icon: '🎵', path: '../prototypes/rhythm-tap/'   },
};

const MAX_RECONNECT = 3;
const RECONNECT_DELAY_MS = 2000;

// ── State ─────────────────────────────────────────────────────────────────────

let ws = null;
let roomCode = '';
let playerName = '';
let myId = null;          // assigned by server on join_ack
let reconnectAttempts = 0;
let reconnectTimer = null;
let myGameVote = null;    // game id this player voted for
let myStartVote = false;  // whether this player voted to start
let currentGameVotes = {};  // { gameId: count }
let currentStartVotes = { count: 0, total: 0 };
let currentGame = null;   // game id chosen for start (from game_start msg)

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  roomCode = params.get('code') || '';
  playerName = params.get('name') || sessionStorage.getItem('playerName') || '플레이어';

  if (!roomCode) {
    showDisconnectOverlay('방 코드가 없습니다. 로비로 돌아가세요.');
    return;
  }

  // Show room code
  document.getElementById('room-code-display').textContent = roomCode;

  // Wire up UI
  document.getElementById('copy-btn').addEventListener('click', copyRoomCode);
  document.getElementById('start-btn').addEventListener('click', voteStart);
  document.getElementById('send-btn').addEventListener('click', sendChat);
  document.getElementById('reconnect-btn').addEventListener('click', () => {
    hideDisconnectOverlay();
    reconnectAttempts = 0;
    connect(roomCode, playerName);
  });

  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
  });

  // Game card clicks
  document.querySelectorAll('.game-card').forEach((card) => {
    card.addEventListener('click', () => voteGame(card.dataset.game));
  });

  connect(roomCode, playerName);
});

// ── WebSocket ─────────────────────────────────────────────────────────────────

function connect(code, name) {
  setConnStatus('connecting', '연결 중...');

  const base = (window.WORKER_URL || window.location.origin)
    .replace(/^http/, 'ws');
  const url = `${base}/api/rooms/${encodeURIComponent(code)}?name=${encodeURIComponent(name)}`;

  try {
    ws = new WebSocket(url);
  } catch (err) {
    onConnectFailed();
    return;
  }

  ws.addEventListener('open', onOpen);
  ws.addEventListener('message', onMessage);
  ws.addEventListener('close', onClose);
  ws.addEventListener('error', () => { /* close fires after error */ });
}

function onOpen() {
  reconnectAttempts = 0;
  setConnStatus('connected', '연결됨');
  send({ type: 'join', name: playerName });
}

function onMessage(event) {
  let msg;
  try { msg = JSON.parse(event.data); }
  catch { return; }
  handleMessage(msg);
}

function onClose(event) {
  setConnStatus('disconnected', '연결 끊김');
  ws = null;

  if (reconnectAttempts < MAX_RECONNECT) {
    reconnectAttempts++;
    setConnStatus('connecting', `재연결 중... (${reconnectAttempts}/${MAX_RECONNECT})`);
    reconnectTimer = setTimeout(() => connect(roomCode, playerName), RECONNECT_DELAY_MS);
  } else {
    showDisconnectOverlay('연결이 끊어졌습니다.\n재연결에 실패했습니다.');
  }
}

function onConnectFailed() {
  setConnStatus('disconnected', '연결 실패');
  if (reconnectAttempts < MAX_RECONNECT) {
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => connect(roomCode, playerName), RECONNECT_DELAY_MS);
  } else {
    showDisconnectOverlay('서버에 연결할 수 없습니다.');
  }
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// ── Message handler ───────────────────────────────────────────────────────────

function handleMessage(msg) {
  switch (msg.type) {

    case 'welcome':
      myId = msg.playerId;
      renderPlayers(msg.players || [], msg.gameVotes || {});
      renderGameVotes(msg.gameVotes || {});
      (msg.chatLog || []).forEach(m => appendChat(m.name, m.text, m.colorIndex));
      currentStartVotes = { count: 0, total: (msg.players || []).length };
      renderStartTally();
      break;

    case 'join_ack':
      myId = msg.id;
      break;

    case 'room_state':
      renderPlayers(msg.players, msg.gameVotes || {});
      renderGameVotes(msg.gameVotes || {});
      if (msg.startVotes !== undefined) {
        currentStartVotes = { count: msg.startVotes, total: (msg.players || []).length };
        renderStartTally();
      }
      break;

    case 'player_joined':
      appendSystemChat(`${msg.name} 님이 입장했습니다.`);
      break;

    case 'player_left':
      appendSystemChat(`${msg.name} 님이 퇴장했습니다.`);
      break;

    case 'players_update':
      renderPlayers(msg.players, msg.gameVotes || currentGameVotes);
      currentStartVotes.total = (msg.players || []).length;
      renderStartTally();
      break;

    case 'game_vote_update':
      renderGameVotes(msg.votes || {});
      break;

    case 'start_vote_update':
      currentStartVotes = { count: msg.count, total: msg.total };
      renderStartTally();
      break;

    case 'chat':
      appendChat(msg.name, msg.text, msg.colorIndex);
      break;

    case 'game_start':
      currentGame = msg.gameId;
      startCountdown(3);
      break;

    case 'error':
      appendSystemChat(`오류: ${msg.message}`);
      break;
  }
}

// ── Render: Players ───────────────────────────────────────────────────────────

function renderPlayers(players, gameVotes) {
  currentGameVotes = gameVotes || {};
  const list = document.getElementById('player-list');
  list.innerHTML = '';

  (players || []).forEach((p) => {
    const colorIdx = typeof p.colorIndex === 'number' ? p.colorIndex % PLAYER_COLORS.length : 0;
    const votedGame = gameVotes[p.id];
    const meta = votedGame ? GAME_META[votedGame] : null;

    const item = document.createElement('div');
    item.className = 'player-item';

    const dot = document.createElement('div');
    dot.className = 'player-color';
    dot.dataset.color = colorIdx;

    const nameEl = document.createElement('div');
    nameEl.className = 'player-name' + (p.id === myId || p.name === playerName ? ' is-self' : '');
    nameEl.textContent = p.name;

    item.appendChild(dot);
    item.appendChild(nameEl);

    if (meta) {
      const icon = document.createElement('span');
      icon.className = 'player-vote-icon';
      icon.title = meta.label;
      icon.textContent = meta.icon;
      item.appendChild(icon);
    }

    list.appendChild(item);
  });
}

// ── Render: Game votes ────────────────────────────────────────────────────────

function renderGameVotes(votes) {
  currentGameVotes = votes || {};
  Object.keys(GAME_META).forEach((gameId) => {
    const badge = document.getElementById(`badge-${gameId}`);
    if (!badge) return;
    const count = votes[gameId] || 0;
    badge.textContent = count;
    badge.classList.toggle('visible', count > 0);
  });
}

// ── Render: Start tally ───────────────────────────────────────────────────────

function renderStartTally() {
  const tally = document.getElementById('start-tally');
  tally.textContent = `${currentStartVotes.count} / ${currentStartVotes.total} 시작 동의`;

  const btn = document.getElementById('start-btn');
  btn.classList.toggle('voted-start', myStartVote);
  btn.textContent = myStartVote ? '시작 취소' : '게임 시작!';
}

// ── Actions ───────────────────────────────────────────────────────────────────

function voteGame(gameId) {
  if (!GAME_META[gameId]) return;

  // Toggle off if already voted for same game
  const newVote = myGameVote === gameId ? null : gameId;
  myGameVote = newVote;

  // Update card highlight
  document.querySelectorAll('.game-card').forEach((card) => {
    card.classList.toggle('voted', card.dataset.game === myGameVote);
  });

  send({ type: 'vote_game', gameId: newVote });
}

function voteStart() {
  myStartVote = !myStartVote;
  send({ type: 'vote_start', vote: myStartVote });
  renderStartTally();
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  send({ type: 'chat', text });
  input.value = '';
}

function copyRoomCode() {
  const btn = document.getElementById('copy-btn');
  navigator.clipboard.writeText(roomCode).then(() => {
    btn.textContent = '복사됨!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = '복사';
      btn.classList.remove('copied');
    }, 1500);
  }).catch(() => {
    // Fallback for older browsers / insecure contexts
    const el = document.createElement('textarea');
    el.value = roomCode;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    btn.textContent = '복사됨!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = '복사';
      btn.classList.remove('copied');
    }, 1500);
  });
}

// ── Countdown ─────────────────────────────────────────────────────────────────

function startCountdown(from) {
  const overlay = document.getElementById('countdown-overlay');
  const numEl = document.getElementById('countdown-number');
  const gameNameEl = document.getElementById('countdown-game-name');

  // Show game name if known
  const meta = currentGame ? GAME_META[currentGame] : null;
  gameNameEl.textContent = meta ? `${meta.icon} ${meta.label}` : '';

  overlay.classList.add('active');
  let current = from;

  function tick() {
    if (current > 0) {
      numEl.textContent = current;
      numEl.classList.add('pop');
      setTimeout(() => numEl.classList.remove('pop'), 150);
      current--;
      setTimeout(tick, 900);
    } else {
      numEl.textContent = 'GO!';
      numEl.classList.add('pop');
      setTimeout(() => {
        overlay.classList.remove('active');
        numEl.classList.remove('pop');
        redirectToGame();
      }, 1000);
    }
  }

  tick();
}

function redirectToGame() {
  if (!currentGame || !GAME_META[currentGame]) return;
  const target = GAME_META[currentGame].path;
  window.location.href = `${target}?code=${encodeURIComponent(roomCode)}&name=${encodeURIComponent(playerName)}`;
}

// ── Chat helpers ──────────────────────────────────────────────────────────────

function appendChat(name, text, colorIndex) {
  const msgs = document.getElementById('chat-messages');
  const color = PLAYER_COLORS[typeof colorIndex === 'number' ? colorIndex % PLAYER_COLORS.length : 0];

  const div = document.createElement('div');
  div.className = 'chat-message';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'msg-name';
  nameSpan.style.color = color;
  nameSpan.textContent = name + ':';

  const textNode = document.createTextNode(' ' + text);

  div.appendChild(nameSpan);
  div.appendChild(textNode);
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function appendSystemChat(text) {
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-message system';
  div.textContent = text;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

// ── Connection status UI ──────────────────────────────────────────────────────

function setConnStatus(state, label) {
  const dot = document.getElementById('conn-indicator');
  const lbl = document.getElementById('conn-label');
  dot.className = `conn-indicator ${state}`;
  lbl.textContent = label;
}

// ── Disconnect overlay ────────────────────────────────────────────────────────

function showDisconnectOverlay(msg) {
  const overlay = document.getElementById('disconnect-overlay');
  document.getElementById('disconnect-msg').textContent = msg;
  overlay.classList.add('active');
}

function hideDisconnectOverlay() {
  document.getElementById('disconnect-overlay').classList.remove('active');
}
