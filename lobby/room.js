/**
 * room.js - Web Game Lab room page
 * Plain ES6, no framework, no bundler.
 */

'use strict';

const PLAYER_COLORS = [
  '#ff7a7a', '#ffbf47', '#59c98a', '#5c8dff',
  '#c977ff', '#ff9f4f', '#39b8ff', '#7ad3d0',
];

// Built from games/registry.js (loaded before this script via room.html)
const GAME_META = Object.fromEntries(
  (window.GAME_REGISTRY || []).map(g => [g.id, {
    label: g.title,
    icon: g.icon,
    path: g.path,
    type: g.type,
    resultLabel: g.resultLabel || '점수',
    resultUnit: g.resultUnit || '점',
    resultScale: typeof g.resultScale === 'number' ? g.resultScale : 1,
    resultDecimals: typeof g.resultDecimals === 'number' ? g.resultDecimals : 0,
  }])
);
const GAME_TYPE_LABELS = {
  SOLO: '솔로',
  PARTY_ASYNC: '파티',
  DUEL_LIVE: '대전',
};

const MAX_RECONNECT = 3;
const RECONNECT_DELAY_MS = 2000;

let ws = null;
let roomCode = '';
let playerName = '';
let preselectedGameId = null;
let myId = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let myGameVote = null;
let myStartVote = false;
let currentGameVotes = {};
let currentStartVotes = { count: 0, total: 0 };
let currentGame = null;

function getCurrentGameMeta() {
  return currentGame ? GAME_META[currentGame] : null;
}

function formatScore(meta, rawScore) {
  const score = typeof rawScore === 'number' ? rawScore : 0;
  const scale = meta?.resultScale ?? 1;
  const decimals = meta?.resultDecimals ?? 0;
  const unit = meta?.resultUnit ?? '점';
  const scaled = score * scale;

  return `${scaled.toFixed(decimals)}${unit}`;
}

function renderGameList() {
  const list = document.getElementById('game-list');
  if (!list) return;
  list.innerHTML = '';
  Object.entries(GAME_META).forEach(([id, meta]) => {
    const typeLabel = GAME_TYPE_LABELS[meta.type] || meta.type;
    const btn = document.createElement('button');
    btn.className = 'game-card';
    btn.id = `card-${id}`;
    btn.dataset.game = id;
    btn.type = 'button';
    btn.innerHTML =
      `<span class="game-badge">${meta.icon}</span>` +
      `<span class="game-text"><strong>${meta.label}<span class="game-type-badge">${typeLabel}</span></strong></span>` +
      `<span class="vote-badge" id="badge-${id}">0</span>`;
    list.appendChild(btn);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  roomCode = params.get('code') || '';
  playerName = params.get('name') || sessionStorage.getItem('playerName') || '플레이어';
  preselectedGameId = params.get('gameId') || null;

  if (!roomCode) {
    showDisconnectOverlay('방 코드가 없습니다. 로비에서 다시 입장해 주세요.');
    return;
  }

  renderGameList();

  document.getElementById('room-code-display').textContent = roomCode;

  document.getElementById('copy-btn').addEventListener('click', copyRoomCode);
  document.getElementById('start-btn').addEventListener('click', voteStart);
  document.getElementById('send-btn').addEventListener('click', sendChat);
  document.getElementById('reconnect-btn').addEventListener('click', () => {
    hideDisconnectOverlay();
    reconnectAttempts = 0;
    connect(roomCode, playerName);
  });
  document.getElementById('home-btn').addEventListener('click', (event) => {
    event.preventDefault();
    if (ws && ws.readyState === WebSocket.OPEN) {
      showExitModal();
      return;
    }
    navigateHome();
  });
  document.getElementById('exit-confirm-btn').addEventListener('click', navigateHome);
  document.getElementById('exit-cancel-btn').addEventListener('click', hideExitModal);

  document.getElementById('rematch-btn').addEventListener('click', () => {
    document.getElementById('scoreboard-overlay').classList.remove('active');
    send({ type: 'rematch' });
    myGameVote = null;
    myStartVote = false;
    currentGame = null;
  });

  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
  });

  document.querySelectorAll('.game-card').forEach((card) => {
    card.addEventListener('click', () => voteGame(card.dataset.game));
  });

  connect(roomCode, playerName);
});

function connect(code, name) {
  setConnStatus('connecting', '연결 중...');

  const base = (window.WORKER_URL || window.location.origin).replace(/^http/, 'ws');
  const url = `${base}/api/rooms/${encodeURIComponent(code)}?name=${encodeURIComponent(name)}`;

  try {
    ws = new WebSocket(url);
  } catch {
    onConnectFailed();
    return;
  }

  ws.addEventListener('open', onOpen);
  ws.addEventListener('message', onMessage);
  ws.addEventListener('close', onClose);
  ws.addEventListener('error', () => {
    // close event follows in the common failure path.
  });
}

function onOpen() {
  reconnectAttempts = 0;
  setConnStatus('connected', '연결됨');

  // 같은 탭 내에서 게임→로비 nav 후 다시 연결될 때 기존 playerId를 복원해
  // 서버 쪽에서 잔존한 옛 ws를 정리하고 동일 식별자를 인계하도록 한다.
  let savedPlayerId = null;
  try {
    savedPlayerId = sessionStorage.getItem(`lobbyPid-${roomCode}`) || null;
  } catch { /* storage unavailable */ }

  send({ type: 'join', name: playerName, playerId: savedPlayerId });

  // If returning from a game with a pending result, submit it now
  let submittedLastResult = false;
  let submittedResult = null;
  try {
    const raw = sessionStorage.getItem('lastGameResult');
    if (raw) {
      const result = JSON.parse(raw);
      if (result.code === roomCode && typeof result.score === 'number') {
        currentGame = result.gameId || currentGame;
        send({ type: 'submit_result', score: result.score, gameId: result.gameId });
        submittedLastResult = true;
        submittedResult = result;
      }
      sessionStorage.removeItem('lastGameResult');
    }
  } catch { /* ignore */ }
  if (submittedLastResult) {
    const meta = getCurrentGameMeta();
    appendSystemChat(
      meta && submittedResult
        ? `${meta.label} 기록 ${formatScore(meta, submittedResult.score)} 제출을 시도했습니다.`
        : '방금 플레이한 결과를 제출했습니다.'
    );
  }

  if (preselectedGameId && GAME_META[preselectedGameId]) {
    myGameVote = preselectedGameId;
    send({ type: 'vote_game', gameId: preselectedGameId });
    document.querySelectorAll('.game-card').forEach((card) => {
      card.classList.toggle('voted', card.dataset.game === preselectedGameId);
    });
  }
}

function onMessage(event) {
  let msg;
  try {
    msg = JSON.parse(event.data);
  } catch {
    return;
  }
  handleMessage(msg);
}

function onClose() {
  ws = null;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  setConnStatus('disconnected', '끊김');

  if (reconnectAttempts < MAX_RECONNECT) {
    reconnectAttempts++;
    setConnStatus('connecting', `재연결 중... (${reconnectAttempts}/${MAX_RECONNECT})`);
    reconnectTimer = setTimeout(() => connect(roomCode, playerName), RECONNECT_DELAY_MS);
  } else {
    showDisconnectOverlay('연결이 끊어졌습니다. 다시 시도해 주세요.');
  }
}

function onConnectFailed() {
  setConnStatus('disconnected', '실패');
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

function handleMessage(msg) {
  switch (msg.type) {
    case 'welcome':
      myId = msg.playerId;
      // 페이지 nav 이후에도 동일 식별자로 재합류할 수 있도록 저장 (탭 단위)
      if (myId) {
        try { sessionStorage.setItem(`lobbyPid-${roomCode}`, myId); } catch { /* ignore */ }
      }
      currentGame = msg.currentGame || currentGame;
      renderPlayers(msg.players || [], msg.gameVotes || {});
      renderGameVotes(msg.gameVotes || {});
      (msg.chatLog || []).forEach((m) => appendChat(m.name, m.text, m.colorIndex, m.ts));
      currentStartVotes = { count: 0, total: (msg.players || []).length };
      renderStartTally();
      if (msg.phase === 'results' && msg.results) {
        renderScoreboard(msg.results, msg.results.length, msg.results.length, true);
      }
      break;

    case 'join_ack':
      myId = msg.id;
      break;

    case 'room_state':
      document.getElementById('scoreboard-overlay')?.classList.remove('active');
      currentGame = msg.currentGame || currentGame;
      renderPlayers(msg.players, msg.gameVotes || {});
      renderGameVotes(msg.gameVotes || {});
      currentStartVotes = { count: msg.startVotes || 0, total: (msg.players || []).length };
      renderStartTally();
      if (msg.phase === 'results' && msg.results) {
        renderScoreboard(msg.results, msg.results.length, msg.results.length, true);
      }
      break;

    case 'player_joined':
      appendSystemChat(`${msg.name} 님이 합류했습니다.`);
      break;

    case 'player_left':
      appendSystemChat(`${msg.name} 님이 방을 나갔습니다.`);
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
      appendChat(msg.name, msg.text, msg.colorIndex, msg.ts);
      break;

    case 'game_start':
      currentGame = msg.gameId;
      {
        const meta = GAME_META[msg.gameId];
        if (meta) appendSystemChat(meta.label + '을(를) 시작합니다!');
      }
      startCountdown(3);
      break;

    case 'scoreboard':
      renderScoreboard(msg.results || [], msg.submitted, msg.total, msg.final);
      break;

    case 'error':
      appendSystemChat(`오류: ${msg.message}`);
      break;
  }
}

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

function renderStartTally() {
  const tally = document.getElementById('start-tally');
  tally.textContent = `${currentStartVotes.count}명 준비 완료`;

  const btn = document.getElementById('start-btn');
  btn.classList.toggle('voted-start', myStartVote);
  btn.textContent = myStartVote
    ? `준비 취소 (${currentStartVotes.count}/${currentStartVotes.total})`
    : `준비 완료 (${currentStartVotes.count}/${currentStartVotes.total})`;
}

function voteGame(gameId) {
  if (!GAME_META[gameId]) return;

  const newVote = myGameVote === gameId ? null : gameId;
  myGameVote = newVote;

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

  function showCopied() {
    btn.textContent = '복사 완료';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = '복사';
      btn.classList.remove('copied');
    }, 1500);
  }

  navigator.clipboard.writeText(roomCode).then(showCopied).catch(() => {
    const el = document.createElement('textarea');
    el.value = roomCode;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showCopied();
  });
}

function startCountdown(from) {
  const overlay = document.getElementById('countdown-overlay');
  const numEl = document.getElementById('countdown-number');
  const gameNameEl = document.getElementById('countdown-game-name');

  const meta = currentGame ? GAME_META[currentGame] : null;
  gameNameEl.textContent = meta ? meta.label : '';

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
  const playerParam = myId ? `&playerId=${encodeURIComponent(myId)}` : '';
  window.location.href =
    `${target}?code=${encodeURIComponent(roomCode)}` +
    `&name=${encodeURIComponent(playerName)}` +
    `&gameId=${encodeURIComponent(currentGame)}` +
    playerParam;
}

function formatChatTime(ts) {
  const date = new Date(typeof ts === 'number' ? ts : Date.now());
  return date.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function appendChat(name, text, colorIndex, ts) {
  const msgs = document.getElementById('chat-messages');
  const color = PLAYER_COLORS[typeof colorIndex === 'number' ? colorIndex % PLAYER_COLORS.length : 0];

  const div = document.createElement('div');
  div.className = 'chat-message';

  const content = document.createElement('div');
  content.className = 'msg-content';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'msg-name';
  nameSpan.style.color = color;
  nameSpan.textContent = `${name}:`;

  const textNode = document.createTextNode(` ${text}`);
  const timeSpan = document.createElement('span');
  timeSpan.className = 'msg-time';
  timeSpan.textContent = formatChatTime(ts);

  content.appendChild(nameSpan);
  content.appendChild(textNode);
  div.appendChild(content);
  div.appendChild(timeSpan);
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

function setConnStatus(state, label) {
  const dot = document.getElementById('conn-indicator');
  const lbl = document.getElementById('conn-label');
  dot.className = `conn-indicator ${state}`;
  lbl.textContent = label;
}

function renderScoreboard(results, submitted, total, final) {
  const overlay = document.getElementById('scoreboard-overlay');
  const list = document.getElementById('scoreboard-list');
  const status = document.getElementById('scoreboard-status');
  const gameName = document.getElementById('scoreboard-game-name');
  const summary = document.getElementById('scoreboard-summary');
  const meta = getCurrentGameMeta();

  list.innerHTML = '';
  results.forEach(entry => {
    const li = document.createElement('li');
    li.className = 'scoreboard-item';
    li.innerHTML =
      `<span class="scoreboard-rank">${entry.rank}</span>` +
      `<span class="scoreboard-name">${entry.name}</span>` +
      `<span class="scoreboard-score">${formatScore(meta, entry.score)}</span>`;
    list.appendChild(li);
  });

  gameName.textContent = meta ? meta.label : '이번 게임 결과';
  summary.textContent = meta
    ? `${meta.resultLabel} 기준으로 순위를 집계합니다.`
    : '이번 게임의 제출 기록을 집계합니다.';

  status.textContent = final
    ? `최종 결과 · ${results.length}명 집계 완료`
    : `${submitted ?? 0} / ${total ?? '?'} 제출 완료`;

  overlay.classList.add('active');
}

function showDisconnectOverlay(msg) {
  const overlay = document.getElementById('disconnect-overlay');
  document.getElementById('disconnect-msg').textContent = msg;
  overlay.classList.add('active');
}

function hideDisconnectOverlay() {
  document.getElementById('disconnect-overlay').classList.remove('active');
}

function showExitModal() {
  document.getElementById('exit-modal')?.classList.add('active');
}

function hideExitModal() {
  document.getElementById('exit-modal')?.classList.remove('active');
}

function navigateHome() {
  window.location.href = '/';
}
