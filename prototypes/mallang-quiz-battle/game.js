/* ── 상수 ──────────────────────────────────────────── */
const CHAR_IMAGES = {
  'mochi-rabbit':    '/prototypes/jump-climber/assets/토끼 메인 이미지.png',
  'pudding-hamster': '/prototypes/jump-climber/assets/햄스터 메인 이미지.png',
  'peach-chick':     '/prototypes/jump-climber/assets/병아리 메인 이미지.png',
  'latte-puppy':     '/prototypes/jump-climber/assets/라떼 메인 이미지.png',
  'mint-kitten':     '/prototypes/jump-climber/assets/고양이 메인이미지.png',
};

const PLAYER_COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#f59e0b',
  '#a855f7', '#ec4899', '#14b8a6', '#f97316',
];

const OPTION_LABELS = ['A', 'B', 'C', 'D'];

/* ── 상태 ──────────────────────────────────────────── */
const { code, name, playerId, isMultiplayer } = window.GameBoot;
const WORKER_URL = window.WORKER_URL;

let ws;
let players = [];
let selectedChar = 'mochi-rabbit';
let isReady = false;
let currentQuestion = null;
let submittedIds = new Set();
let myAnswer = null;
let timerInterval = null;
let chatVisible = false;
let chatHideTimer = null;
let answerHistory = {}; // { playerId: { questionIndex: true | false | null } }
let reconnectCount = 0;
let gameEnded = false;

/* ── DOM 참조 ──────────────────────────────────────── */
const setupScreen      = document.getElementById('setupScreen');
const gameScreen       = document.getElementById('gameScreen');
const resultScreen     = document.getElementById('resultScreen');
const readyBtn         = document.getElementById('readyBtn');
const scoreBar         = document.getElementById('scoreBar');
const questionProgress = document.getElementById('questionProgress');
const timerDisplay     = document.getElementById('timerDisplay');
const countdownOverlay = document.getElementById('countdownOverlay');
const countdownNumber  = document.getElementById('countdownNumber');
const questionText     = document.getElementById('questionText');
const optionGrid       = document.getElementById('optionGrid');
const revealPanel      = document.getElementById('revealPanel');
const revealResult     = document.getElementById('revealResult');
const revealExplanation = document.getElementById('revealExplanation');
const waitingPlayers   = document.getElementById('waitingPlayers');
const rankingsList     = document.getElementById('rankingsList');
const winnerChar       = document.getElementById('winnerChar');
const winnerName       = document.getElementById('winnerName');
const winnerScore      = document.getElementById('winnerScore');
const chatOverlay      = document.getElementById('chatOverlay');
const chatMessages     = document.getElementById('chatMessages');
const chatToggle       = document.getElementById('chatToggle');
const chatInputWrap    = document.getElementById('chatInputWrap');
const chatInput        = document.getElementById('chatInput');
const chatSend         = document.getElementById('chatSend');

/* ── 캐릭터 선택 ────────────────────────────────────── */
document.querySelectorAll('.character-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.character-card').forEach(c => c.classList.remove('is-selected'));
    card.classList.add('is-selected');
    selectedChar = card.dataset.character;
    sendIfOpen({ type: 'QUIZ_SELECT_CHARACTER', characterId: selectedChar });
  });
});

/* ── Ready 버튼 ─────────────────────────────────────── */
readyBtn.addEventListener('click', () => {
  isReady = !isReady;
  readyBtn.textContent = isReady ? '취소' : 'Ready!';
  readyBtn.classList.toggle('is-ready', isReady);
  sendIfOpen({ type: 'QUIZ_READY', ready: isReady });
});

/* ── WebSocket 연결 ──────────────────────────────────── */
function connect() {
  const wsUrl = WORKER_URL.replace(/^http/, 'ws') + '/api/rooms/' + code;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    reconnectCount = 0;
    ws.send(JSON.stringify({
      type: 'join_game',
      gameId: 'mallang-quiz-battle',
      playerId,
      characterId: selectedChar,
    }));
  };

  ws.onmessage = e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleMessage(msg);
  };

  ws.onclose = (e) => {
    if (gameEnded || e.code === 1000) return;
    reconnectCount++;
    if (reconnectCount > 5) return;
    setTimeout(connect, Math.min(reconnectCount * 2000, 10000));
  };
}

function sendIfOpen(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

/* ── 메시지 디스패처 ─────────────────────────────────── */
function handleMessage(msg) {
  switch (msg.type) {
    case 'QUIZ_JOINED':        onJoined(msg);       break;
    case 'QUIZ_PLAYER_UPDATE': onPlayerUpdate(msg); break;
    case 'QUIZ_COUNTDOWN':     onCountdown(msg);    break;
    case 'QUIZ_QUESTION':      onQuestion(msg);     break;
    case 'QUIZ_SUBMITTED':     onSubmitted(msg);    break;
    case 'QUIZ_REVEAL':        onReveal(msg);       break;
    case 'QUIZ_END':           onEnd(msg);          break;
    case 'chat':               onChat(msg);         break;
  }
}

/* ── 메시지 핸들러 ────────────────────────────────────── */
function onJoined(msg) {
  players = msg.players || [];
  answerHistory = {};
  renderSetupPlayers();
  renderScoreBar();
}

function onPlayerUpdate(msg) {
  players = msg.players || [];
  renderSetupPlayers();
  renderScoreBar();
}

function onCountdown(msg) {
  showScreen('game');
  countdownOverlay.classList.remove('is-hidden');
  countdownNumber.textContent = msg.seconds;
  questionText.textContent = '';
  optionGrid.innerHTML = '';
  revealPanel.classList.add('is-hidden');
  timerDisplay.textContent = '';
  questionProgress.textContent = '';
}

function onQuestion(msg) {
  currentQuestion = msg;
  myAnswer = null;
  submittedIds = new Set();

  countdownOverlay.classList.add('is-hidden');
  revealPanel.classList.add('is-hidden');

  questionProgress.textContent = `Q ${msg.questionIndex + 1} / ${msg.total}`;
  questionText.textContent = msg.question;

  // 보기 버튼 생성
  optionGrid.innerHTML = '';
  msg.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.type = 'button';
    btn.innerHTML =
      `<span class="option-label">${OPTION_LABELS[i]}</span>` +
      `<span class="option-text">${escHtml(opt)}</span>`;
    btn.addEventListener('click', () => submitAnswer(i));
    optionGrid.appendChild(btn);
  });

  // 제출 완료 표시 초기화
  updateSubmittedIndicators();

  // 클라이언트 표시용 타이머 시작
  startTimer(msg.timeLimit);
}

function onSubmitted(msg) {
  submittedIds.add(msg.playerId);
  updateSubmittedIndicators();
}

function onReveal(msg) {
  stopTimer();

  // 점수 업데이트
  players = players.map(p => {
    const entry = msg.scores.find(s => s.id === p.id);
    return entry ? { ...p, score: entry.score } : p;
  });

  // 문항별 O/X 기록
  const qIdx = currentQuestion ? currentQuestion.questionIndex : -1;
  if (qIdx >= 0) {
    players.forEach(p => {
      if (!answerHistory[p.id]) answerHistory[p.id] = {};
      const submitted = msg.submissions ? msg.submissions[p.id] : undefined;
      answerHistory[p.id][qIdx] = submitted !== undefined
        ? submitted === msg.correctIndex
        : null;
    });
  }

  renderScoreBar();

  // 정답/오답 표시
  const btns = [...optionGrid.querySelectorAll('.option-btn')];
  btns.forEach((btn, i) => {
    btn.disabled = true;
    if (i === msg.correctIndex) btn.classList.add('is-correct');
    else if (i === myAnswer)    btn.classList.add('is-wrong');
  });

  const correct = myAnswer === msg.correctIndex;
  revealResult.textContent = myAnswer === null ? '⏱ 시간 초과' : correct ? '🎉 정답!' : '❌ 오답';
  revealResult.className   = 'reveal-result ' + (correct ? 'is-correct' : 'is-wrong');
  revealExplanation.textContent = msg.explanation;
  revealPanel.classList.remove('is-hidden');
}

function onEnd(msg) {
  stopTimer();
  gameEnded = true;
  const winner = msg.rankings[0];

  winnerChar.src = CHAR_IMAGES[winner.characterId] || '';
  winnerChar.alt = winner.name;
  winnerName.textContent = winner.name;
  winnerScore.textContent = winner.score + '점';

  rankingsList.innerHTML = '';
  msg.rankings.forEach(r => {
    const li = document.createElement('li');
    li.className = 'ranking-item';
    const color = PLAYER_COLORS[r.colorIndex % PLAYER_COLORS.length];
    li.innerHTML =
      `<span class="ranking-rank">${r.rank}</span>` +
      `<img class="ranking-char" src="${CHAR_IMAGES[r.characterId] || ''}" alt="${escHtml(r.name)}" />` +
      `<span class="ranking-name" style="color:${color}">${escHtml(r.name)}</span>` +
      `<span class="ranking-score">${r.score}점</span>`;
    rankingsList.appendChild(li);
  });

  showScreen('result');
}

function onChat(msg) {
  const div = document.createElement('div');
  div.className = 'chat-msg';
  const color = PLAYER_COLORS[msg.colorIndex % PLAYER_COLORS.length];
  div.innerHTML =
    `<span class="chat-name" style="color:${color}">${escHtml(msg.name)}</span> ${escHtml(msg.text)}`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  showChatBriefly();
}

/* ── 답 제출 ─────────────────────────────────────────── */
function submitAnswer(index) {
  if (myAnswer !== null) return;
  myAnswer = index;

  [...optionGrid.querySelectorAll('.option-btn')].forEach((btn, i) => {
    btn.disabled = true;
    if (i === index) btn.classList.add('is-selected');
  });

  sendIfOpen({
    type: 'QUIZ_ANSWER',
    questionIndex: currentQuestion.questionIndex,
    answerIndex: index,
  });
}

/* ── 타이머 ──────────────────────────────────────────── */
function startTimer(seconds) {
  stopTimer();
  let remaining = seconds;
  timerDisplay.textContent = remaining;
  timerDisplay.className = 'timer-display';

  timerInterval = setInterval(() => {
    remaining -= 1;
    timerDisplay.textContent = Math.max(0, remaining);
    if (remaining <= 3) timerDisplay.classList.add('is-urgent');
    if (remaining <= 0) stopTimer();
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

/* ── 렌더링 ──────────────────────────────────────────── */
function renderSetupPlayers() {
  waitingPlayers.innerHTML = '';
  players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'waiting-player' + (p.ready ? ' is-ready' : '');
    const color = PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length];
    div.innerHTML =
      `<img class="waiting-char" src="${CHAR_IMAGES[p.characterId] || ''}" alt="${escHtml(p.name)}" />` +
      `<span class="waiting-name" style="color:${color}">${escHtml(p.name)}</span>` +
      `<span class="waiting-status">${p.ready ? '✅' : '⏳'}</span>`;
    waitingPlayers.appendChild(div);
  });
}

function renderScoreBar() {
  scoreBar.innerHTML = '';
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const total  = (currentQuestion && currentQuestion.total) || 10;
  const curIdx = currentQuestion ? currentQuestion.questionIndex : -1;

  const table = document.createElement('table');
  table.className = 'score-table';

  // 헤더
  const hRow = document.createElement('tr');
  hRow.appendChild(Object.assign(document.createElement('th'), { className: 'st-name' }));
  for (let i = 0; i < total; i++) {
    const th = document.createElement('th');
    th.className = 'st-q' + (i === curIdx ? ' st-current' : '');
    th.textContent = i + 1;
    hRow.appendChild(th);
  }
  hRow.appendChild(Object.assign(document.createElement('th'), { className: 'st-score', textContent: '점수' }));
  table.appendChild(hRow);

  // 플레이어 행
  sorted.forEach(p => {
    const color = PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length];
    const tr = document.createElement('tr');
    tr.dataset.playerId = p.id;

    const nameTd = document.createElement('td');
    nameTd.className = 'st-name';
    nameTd.innerHTML = `<span class="st-player-name" style="color:${color}">${escHtml(p.name)}</span>`;
    tr.appendChild(nameTd);

    const history = answerHistory[p.id] || {};
    for (let i = 0; i < total; i++) {
      const td = document.createElement('td');
      td.className = 'st-q' + (i === curIdx ? ' st-current' : '');
      if (i in history) {
        const ok = history[i];
        td.textContent = ok === null ? '—' : ok ? 'O' : 'X';
        td.classList.add(ok === null ? 'st-timeout' : ok ? 'st-correct' : 'st-wrong');
      } else if (i === curIdx) {
        td.textContent = submittedIds.has(p.id) ? '✓' : '·';
        td.classList.add(submittedIds.has(p.id) ? 'st-submitted' : 'st-pending');
      }
      tr.appendChild(td);
    }

    const scoreTd = document.createElement('td');
    scoreTd.className = 'st-score';
    scoreTd.textContent = p.score;
    tr.appendChild(scoreTd);

    table.appendChild(tr);
  });

  scoreBar.appendChild(table);
}

function updateSubmittedIndicators() {
  const curIdx = currentQuestion ? currentQuestion.questionIndex : -1;
  if (curIdx < 0) return;
  scoreBar.querySelectorAll('tr[data-player-id]').forEach(tr => {
    const pid = tr.dataset.playerId;
    if (answerHistory[pid] && curIdx in answerHistory[pid]) return;
    const cells = tr.querySelectorAll('.st-q');
    const cell  = cells[curIdx];
    if (!cell) return;
    const submitted = submittedIds.has(pid);
    cell.textContent = submitted ? '✓' : '·';
    cell.className = 'st-q st-current ' + (submitted ? 'st-submitted' : 'st-pending');
  });
}

/* ── 화면 전환 ───────────────────────────────────────── */
function showScreen(name) {
  setupScreen.classList.remove('is-active');
  gameScreen.classList.remove('is-active');
  resultScreen.classList.remove('is-active');
  if (name === 'setup')  setupScreen.classList.add('is-active');
  if (name === 'game')   gameScreen.classList.add('is-active');
  if (name === 'result') resultScreen.classList.add('is-active');
}

/* ── 채팅 ────────────────────────────────────────────── */
chatToggle.addEventListener('click', () => {
  chatVisible = !chatVisible;
  chatInputWrap.classList.toggle('is-visible', chatVisible);
  chatOverlay.classList.toggle('is-hidden', false);
  if (chatVisible) {
    chatInput.focus();
    clearTimeout(chatHideTimer);
  } else {
    chatOverlay.classList.add('is-hidden');
  }
});

chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
chatSend.addEventListener('click', sendChat);

function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  sendIfOpen({ type: 'chat', text });
  chatInput.value = '';
}

function showChatBriefly() {
  chatOverlay.classList.remove('is-hidden');
  clearTimeout(chatHideTimer);
  if (!chatVisible) {
    chatHideTimer = setTimeout(() => {
      if (!chatVisible) chatOverlay.classList.add('is-hidden');
    }, 3500);
  }
}

/* ── 로비로 돌아가기 ─────────────────────────────────── */
document.getElementById('exitBtn').addEventListener('click', () => {
  window.GameBoot.exit();
});

/* ── 유틸 ────────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── 초기화 ──────────────────────────────────────────── */
if (code) {
  connect();
} else {
  // 솔로 테스트: 방 코드 없이 실행 시 셋업 화면 유지
  document.querySelector('.setup-copy').textContent =
    '방 코드 없이 실행 중입니다. 로비에서 입장해 주세요.';
  readyBtn.disabled = true;
}
