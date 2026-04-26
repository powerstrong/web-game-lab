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

// === 리듬/풀 상수 (서버 SPEC v0.9와 일치) — phase 1/2로 분리 ===
const TUG_RHYTHM_CONFIG_PHASE1 = {
  ringIntervalMs: 1000,
  ringShrinkDurationMs: 700,
  perfectWindowMs: 120,
  goodWindowMs: 280,
};

const TUG_RHYTHM_CONFIG_PHASE2 = {
  ringIntervalMs: 820,
  ringShrinkDurationMs: 550,
  perfectWindowMs: 110,
  goodWindowMs: 240,
};

// 후방 호환용 — 기존 TUG_RHYTHM_CONFIG 참조는 phase 1을 가리킴.
const TUG_RHYTHM_CONFIG = TUG_RHYTHM_CONFIG_PHASE1;

function getRhythmConfigForStage(stage) {
  return stage === 2 ? TUG_RHYTHM_CONFIG_PHASE2 : TUG_RHYTHM_CONFIG_PHASE1;
}

const TUG_PULL_POWER = {
  perfect: 0.040,
  good: 0.018,
  miss: -0.005,
};

const ROPE_VISUAL_CONFIG = {
  perfectPairWindowMs: 200,
  tensionBoost: 0.3,
  tensionDecayPerFrame: 0.96,
  wobbleDurationMs: 400,
  wobbleFrequency: 0.04,
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
  // Phase D: 페이즈 2 클러치 — 서버 권위 stage(1|2) 미러
  phaseStage: 1,
  // Phase E-1: 아이템 미러
  items: [],            // [{ id, itemType, spawnedAt, expiresAt, ropePosAtSpawn, fallProgress }]
  iceTintUntilMs: 0,    // 얼음별사탕 효과 중인 본인 화면 청록 틴트 만료 시각 (performance.now 기준)
  // Phase E-2: KO 시퀀스 — 서버 finished 도달 후 클라가 1.8초 자체 보류하고 단계별 모션을 보임.
  koSequenceActive: false,
  // Phase E-3: 서버 stats 미러 (명장면 회상 문구 생성용).
  stats: {},          // { [playerId]: PlayerStats }
  // Phase E-4: 사운드 — countdown 마지막 비프 sec (중복 방지)
  lastCountdownSec: null,
  // Phase E-4: rope 상태 사운드 트리거 — 직전 self/other 상태로부터 변화 감지.
  lastSelfRopeState: 'balanced',
};

// SPEC line 491~499: 7단계 KO 시퀀스. 단계별 시작 시각(ms 진행 시간) — CSS animation은
// 통합 keyframe 사용, JS는 단계 클래스만 토글한다.
const TUG_KO_SEQUENCE_TOTAL_MS = 1800;
const TUG_KO_SEQUENCE_RESULT_DELAY_MS = 1800; // 결과 화면 전환은 시퀀스 종료 시점.

// === Phase E-4: WebAudio synth — SPEC line 530~543의 8종 의성어 + 페이즈 2 cue + 카운트다운 비프.
// 자산 없이 즉석 합성. AudioContext는 사용자 첫 인터랙션 후 resume.
const tugSynth = {
  ctx: null,
  master: null,
  enabled: true,
  lastPlayedAt: {}, // throttle 키 → 최근 재생 시각
  ensure() {
    if (this.ctx) return this.ctx;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.4;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  },
  resume() {
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
  },
  setEnabled(on) {
    this.enabled = !!on;
    if (this.master) this.master.gain.value = this.enabled ? 0.4 : 0;
  },
  // throttle: 같은 cue가 minIntervalMs 내 두 번 재생되지 않게.
  canPlay(name, minIntervalMs = 60) {
    const now = performance.now();
    if ((this.lastPlayedAt[name] || 0) + minIntervalMs > now) return false;
    this.lastPlayedAt[name] = now;
    return true;
  },
  // 단발 oscillator + envelope. type/freq/ms/attack/decay 패턴 단순화.
  _blip({ type = 'sine', freq = 440, ms = 100, attack = 4, peak = 0.6, decay = null, sweepTo = null } = {}) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweepTo != null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(0.0001, sweepTo), t0 + ms / 1000);
    }
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + attack / 1000);
    const tail = decay ?? ms;
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + tail / 1000);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + tail / 1000 + 0.02);
  },
  _noise({ ms = 200, peak = 0.4, hpf = 800, lpf = 4000 } = {}) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const buf = ctx.createBuffer(1, Math.ceil((ctx.sampleRate * ms) / 1000), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = hpf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = lpf;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
    src.connect(hp).connect(lp).connect(gain).connect(this.master);
    src.start(t0);
    src.stop(t0 + ms / 1000 + 0.02);
  },
  // === SPEC 사운드 매핑 ===
  perfect() { // 뽕!
    this._blip({ type: 'triangle', freq: 880, sweepTo: 740, ms: 90, attack: 2, peak: 0.6 });
    this._blip({ type: 'sine', freq: 1320, ms: 60, attack: 2, peak: 0.3 });
  },
  good() { // 톡
    this._blip({ type: 'triangle', freq: 660, sweepTo: 580, ms: 70, attack: 2, peak: 0.5 });
  },
  miss() { // 삐끗
    this._blip({ type: 'sawtooth', freq: 320, sweepTo: 180, ms: 200, attack: 4, peak: 0.35 });
  },
  stretch() { // 뿌우욱
    this._blip({ type: 'sawtooth', freq: 180, sweepTo: 240, ms: 320, attack: 30, peak: 0.4 });
  },
  danger() { // 뿌직 / 뿅
    this._blip({ type: 'square', freq: 360, sweepTo: 200, ms: 160, attack: 4, peak: 0.45 });
  },
  iceSlip() { // 스윽
    this._noise({ ms: 280, peak: 0.32, hpf: 1800, lpf: 5200 });
    this._blip({ type: 'sine', freq: 1200, sweepTo: 700, ms: 260, attack: 8, peak: 0.18 });
  },
  koFall() { // 슈우웅
    this._blip({ type: 'sawtooth', freq: 900, sweepTo: 110, ms: 800, attack: 8, peak: 0.5 });
  },
  victoryBurst() { // 펑!
    this._noise({ ms: 180, peak: 0.5, hpf: 600, lpf: 6000 });
    this._blip({ type: 'square', freq: 760, sweepTo: 1200, ms: 220, attack: 2, peak: 0.4 });
  },
  // 페이즈 2 BGM cue — 종소리 ding
  phase2Cue() {
    this._blip({ type: 'sine', freq: 660, ms: 380, attack: 4, peak: 0.5 });
    this._blip({ type: 'sine', freq: 990, ms: 380, attack: 4, peak: 0.3 });
  },
  // 카운트다운 비프 — 3/2/1은 같은 함수 호출, GO! 는 phase2Cue 류.
  countdownTick(numberLeft) {
    const isFinal = numberLeft <= 1;
    this._blip({
      type: 'sine',
      freq: isFinal ? 880 : 520,
      ms: isFinal ? 220 : 140,
      attack: 4,
      peak: 0.45,
    });
  },
  ringTick() { // 미세 틱 (선택 — 매 ring 등장)
    this._blip({ type: 'sine', freq: 1500, ms: 30, attack: 1, peak: 0.18 });
  },
};

const TUG_ITEM_VISUAL = {
  cottoncandy_bomb: { icon: '🍬', name: '솜사탕 폭탄' },
  ice_star:         { icon: '❄️', name: '얼음 별사탕' },
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

const ropeVisual = {
  pos: 0,
  tension: 0,
  wobble: 0,
  stretch: 0,
  lastSampleAt: null,
  lastSamplePos: 0,
  lastWobbleAt: -Infinity,
  wobbleDirection: 1,
  lastPerfectPullAt: {
    left: -Infinity,
    right: -Infinity,
  },
  lastAppliedMotionKey: '',
};

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function classifyRopeState(ropePos) {
  const abs = Math.abs(ropePos);
  if (abs < 0.20) return 'balanced';
  if (abs < 0.45) return 'pushed';
  if (abs < 0.70) return 'struggling';
  if (abs < 0.90) return 'danger';
  return 'critical';
}

function inferPullSide(playerId, ropeDelta) {
  const player = state.players.find((p) => p.id === playerId);
  if (player?.side === 'left' || player?.side === 'right') return player.side;
  if (ropeDelta > 0) return 'left';
  if (ropeDelta < 0) return 'right';
  return null;
}

function recordPerfectPull(playerId, ropeDelta, now = performance.now()) {
  const side = inferPullSide(playerId, ropeDelta);
  ropeVisual.lastWobbleAt = now;
  ropeVisual.wobbleDirection = side === 'right' ? -1 : 1;

  if (!side || Math.abs(ropeDelta) <= 0.0001) return;

  ropeVisual.lastPerfectPullAt[side] = now;
  const otherSide = side === 'left' ? 'right' : 'left';
  const pairedRecently = now - ropeVisual.lastPerfectPullAt[otherSide] <= ROPE_VISUAL_CONFIG.perfectPairWindowMs;
  if (pairedRecently) {
    ropeVisual.tension = clamp01(ropeVisual.tension + ROPE_VISUAL_CONFIG.tensionBoost);
  }
}

function updateRopeVisualState(now = performance.now()) {
  const dt = ropeVisual.lastSampleAt == null ? 16.67 : Math.max(0, now - ropeVisual.lastSampleAt);
  const frameScale = dt > 0 ? dt / 16.67 : 1;
  const posDelta = state.ropePos - ropeVisual.lastSamplePos;

  ropeVisual.tension = clamp01(ropeVisual.tension * Math.pow(ROPE_VISUAL_CONFIG.tensionDecayPerFrame, frameScale));
  ropeVisual.pos = state.ropePos;
  ropeVisual.stretch = clamp01(Math.abs(state.ropePos));

  const wobbleElapsed = now - ropeVisual.lastWobbleAt;
  if (wobbleElapsed >= 0 && wobbleElapsed <= ROPE_VISUAL_CONFIG.wobbleDurationMs) {
    const decay = 1 - wobbleElapsed / ROPE_VISUAL_CONFIG.wobbleDurationMs;
    ropeVisual.wobble = Math.sin(wobbleElapsed * ROPE_VISUAL_CONFIG.wobbleFrequency) * decay * ropeVisual.wobbleDirection;
  } else {
    ropeVisual.wobble = 0;
  }

  if (Math.abs(posDelta) > 0.002) {
    ropeVisual.stretch = clamp01(ropeVisual.stretch + Math.min(0.15, Math.abs(posDelta) * 1.5));
  }

  ropeVisual.lastSampleAt = now;
  ropeVisual.lastSamplePos = state.ropePos;
  return ropeVisual;
}

function setCharacterMotionState(el, side, ropeState, ropePos) {
  if (!el) return;
  delete el.dataset.ropeStateSelf;
  delete el.dataset.ropeStateOther;

  if (ropeState === 'balanced') return;

  const isSelfAdvantaged = side === 'left' ? ropePos > 0 : ropePos < 0;
  if (isSelfAdvantaged) {
    el.dataset.ropeStateSelf = ropeState;
  } else {
    el.dataset.ropeStateOther = ropeState;
  }
}

function applyRopeMotionState(ropeState, ropePos) {
  const sign = ropeState === 'balanced' ? 0 : Math.sign(ropePos);
  const key = `${ropeState}:${sign}`;
  if (ropeVisual.lastAppliedMotionKey === key) return;
  ropeVisual.lastAppliedMotionKey = key;

  // Phase E-4: 자기 진영 기준 위험 상태 진입 시 사운드.
  // me.side가 left면 ropePos<0, right면 ropePos>0이 위험.
  const me = state.players.find((p) => p.id === myPlayerId);
  if (me) {
    const selfDanger = me.side === 'left' ? ropePos < 0 : ropePos > 0;
    let selfState = ropeState;
    if (!selfDanger) selfState = 'balanced'; // 자기에게 우세/균형이면 사운드 없음
    if (selfState !== state.lastSelfRopeState) {
      const prev = state.lastSelfRopeState;
      state.lastSelfRopeState = selfState;
      // danger 진입 또는 critical 진입 시 한 번씩.
      if (selfState === 'danger' && prev !== 'critical' && tugSynth.canPlay('danger', 600)) {
        tugSynth.danger();
      } else if (selfState === 'critical' && prev !== 'critical' && tugSynth.canPlay('critical', 600)) {
        tugSynth.danger();
        tugSynth.stretch();
      }
    }
  }

  const arena = document.querySelector('.arena');
  const charLeftWrap = document.querySelector('.tug-character--left');
  const charRightWrap = document.querySelector('.tug-character--right');

  if (arena) {
    if (ropeState === 'balanced') {
      delete arena.dataset.ropeState;
    } else {
      arena.dataset.ropeState = ropeState;
    }
  }

  setCharacterMotionState(charLeftWrap, 'left', ropeState, ropePos);
  setCharacterMotionState(charRightWrap, 'right', ropeState, ropePos);
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
      handleTapResult(msg);
      break;
    case 'TUG_ITEM_RESULT':
      handleItemResult(msg);
      break;
    case 'TUG_GAME_END':
      handleGameEnd(msg);
      break;
    case 'error':
      showToast(msg.message || '오류가 발생했습니다.');
      break;
  }
}

// Phase E-1: 아이템 효과 결과 — 서버에서 캐릭터에게 적용된 직후 도착.
function handleItemResult(msg) {
  // ropePos 권위 갱신 (cottoncandy_bomb은 즉시 풀 적용)
  if (Number.isFinite(msg.newRopePos)) {
    state.ropePos = msg.newRopePos;
    renderRope();
  }

  if (msg.itemType === 'cottoncandy_bomb') {
    // 풀러진 측 캐릭터 위에 폭발 이펙트 + 줄 wobble.
    flashItemEffect(msg.playerId, 'cottoncandy_bomb');
    // wobble seed 갱신 (강한 풀로 취급)
    if (typeof recordPerfectPull === 'function') {
      recordPerfectPull(msg.playerId, msg.ropeDelta || 0);
    }
    // Phase E-4: 폭발 사운드 (펑! 재활용).
    tugSynth.victoryBurst();
  } else if (msg.itemType === 'ice_star') {
    // 얼음별사탕 — 사용자(grabber)는 가벼운 표시, 타겟(상대)는 청록 틴트.
    flashItemEffect(msg.playerId, 'ice_star');
    if (msg.targetId === myPlayerId) {
      // 본인 화면이 약화 대상 — 청록 오버레이 켜기 (다음 비-perfect 풀까지).
      state.iceTintUntilMs = performance.now() + 4000; // 안전 만료 4초.
      const arena = document.querySelector('.arena');
      if (arena) arena.classList.add('is-ice-tinted');
    }
    // Phase E-4: 미끄러짐 사운드.
    tugSynth.iceSlip();
  }
}

function flashItemEffect(playerId, itemType) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;
  const wrap = document.querySelector(`.tug-character--${player.side}`);
  if (!wrap) return;
  const meta = TUG_ITEM_VISUAL[itemType] || { icon: '✨' };
  const burst = document.createElement('span');
  burst.className = 'tug-item-burst';
  burst.dataset.itemType = itemType;
  burst.textContent = meta.icon;
  wrap.appendChild(burst);
  // 0.9s 후 제거
  setTimeout(() => burst.remove(), 900);
}

function handleTapResult(msg) {
  // 서버 권위 — ropePos는 서버 값으로 정정 (낙관적 예측 보정).
  if (Number.isFinite(msg.newRopePos)) {
    state.ropePos = msg.newRopePos;
    renderRope();
  }
  // perfect tension boost는 서버가 보낸 ropeDelta를 직접 사용 — 클라 낙관 적용 후
  // newRopePos-prevRopePos는 0이 될 수 있어 페어링이 깨지는 race 차단.
  if (msg.judgement === 'perfect') {
    const serverDelta = Number.isFinite(msg.ropeDelta) ? msg.ropeDelta : 0;
    recordPerfectPull(msg.playerId, serverDelta);
  }
  // Phase E-4: 상대 입력에 대한 사운드 (자기 사운드는 handleTapInput 낙관 단계에서 이미 재생).
  if (msg.playerId !== myPlayerId) {
    if (msg.judgement === 'perfect' && tugSynth.canPlay('opp-perfect', 50)) tugSynth.perfect();
    else if (msg.judgement === 'good' && tugSynth.canPlay('opp-good', 50)) tugSynth.good();
    // 상대 miss는 음소거 — 본인 화면 노이즈 회피.
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
  // KO 시퀀스 진행 중에는 winnerId/endReason 갱신 차단 — 후행 abandoned/timeout STATE_SYNC가
  // 시각 연출과 결과 텍스트를 흔들지 않도록 (gemini Major 1).
  if (!state.koSequenceActive) {
    state.winnerId = serverState.winnerId ?? null;
    state.endReason = serverState.endReason ?? null;
  }

  // Phase D: 클러치 stage 미러 + .arena.is-clutch 토글
  const newStage = serverState.phaseStage === 2 ? 2 : 1;
  if (newStage !== state.phaseStage) {
    const wasStage1 = state.phaseStage === 1;
    state.phaseStage = newStage;
    const arena = document.querySelector('.arena');
    if (arena) arena.classList.toggle('is-clutch', newStage === 2);
    // Phase E-4: 1→2 전환 시 BGM cue.
    if (wasStage1 && newStage === 2) tugSynth.phase2Cue();
  }

  // Phase E-4: countdown 비프 — 새로 들어온 sec와 직전 sec가 다르면 한 번 재생.
  if (state.phase === 'countdown' && Number.isFinite(state.countdownMsLeft)) {
    const sec = Math.max(1, Math.ceil(state.countdownMsLeft / 1000));
    if (state.lastCountdownSec !== sec) {
      state.lastCountdownSec = sec;
      tugSynth.countdownTick(sec);
    }
  } else {
    state.lastCountdownSec = null;
  }

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

  // Phase E-1: items 미러
  state.items = Array.isArray(serverState.items) ? serverState.items : [];

  // Phase E-3: stats 미러 (명장면 회상 문구 생성용)
  if (serverState.stats && typeof serverState.stats === 'object') {
    state.stats = serverState.stats;
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
      // KO이면 시퀀스 1.8초 보류 후 결과 화면. 그 외(timeout/abandoned)는 즉시.
      finalizeFinish();
      break;
  }
}

function handleGameEnd(msg) {
  state.phase = 'finished';
  // KO 시퀀스 진행 중에는 endReason/winnerId 권위 덮어쓰기를 차단 — 시퀀스가 절단되거나
  // 결과 텍스트가 시각 연출과 충돌하지 않도록 (gemini Major 1).
  if (!state.koSequenceActive) {
    state.winnerId = msg.winnerId ?? null;
    state.endReason = msg.reason ?? null;
  }
  // 명장면 회상용 stats — TUG_GAME_END가 마지막 권위 stats를 함께 보냄.
  if (msg.stats && typeof msg.stats === 'object') {
    state.stats = msg.stats;
  }
  finalizeFinish();
}

// finished phase 진입 시 — ko면 1.8초 KO 시퀀스 후 결과 화면, 그 외(timeout/abandoned)는 즉시.
function finalizeFinish() {
  if (state.endReason === 'ko' && state.winnerId && !state.koSequenceActive) {
    playKoSequence(state.winnerId);
  } else if (!state.koSequenceActive) {
    showResultScreen();
    renderResult();
  }
  // ko 시퀀스 진행 중이면 무시 (중복 시작 방지).
}

function playKoSequence(winnerId) {
  state.koSequenceActive = true;
  const arena = document.querySelector('.arena');
  const left = state.players.find((p) => p.side === 'left');
  const right = state.players.find((p) => p.side === 'right');
  const winnerSide = left?.id === winnerId ? 'left' : (right?.id === winnerId ? 'right' : null);
  const loserSide = winnerSide === 'left' ? 'right' : (winnerSide === 'right' ? 'left' : null);

  // 진행 중이던 효과/오버레이 정리.
  if (arena) {
    arena.classList.remove('is-ice-tinted');
    arena.classList.remove('is-clutch');
    arena.classList.add('is-ko-sequence');
  }
  state.iceTintUntilMs = 0;

  // 캐릭터 슬롯에 winner/loser 클래스 부여 — CSS가 단계별 애니메이션을 통합 keyframe으로 진행.
  const charLeft = document.querySelector('.tug-character--left');
  const charRight = document.querySelector('.tug-character--right');
  [charLeft, charRight].forEach((el) => {
    if (!el) return;
    el.classList.remove('is-ko-winner', 'is-ko-loser');
    delete el.dataset.ropeStateSelf;
    delete el.dataset.ropeStateOther;
  });
  if (winnerSide && winnerSide === 'left' && charLeft) charLeft.classList.add('is-ko-winner');
  if (winnerSide && winnerSide === 'right' && charRight) charRight.classList.add('is-ko-winner');
  if (loserSide && loserSide === 'left' && charLeft) charLeft.classList.add('is-ko-loser');
  if (loserSide && loserSide === 'right' && charRight) charRight.classList.add('is-ko-loser');

  // Phase E-4: KO 사운드 — 추락(슈우웅) 즉시 + 승리 폭발(펑) 1.5초쯤.
  tugSynth.koFall();
  setTimeout(() => tugSynth.victoryBurst(), 1500);

  setTimeout(() => {
    state.koSequenceActive = false;
    if (arena) {
      arena.classList.remove('is-ko-sequence');
      // ko 클래스는 결과 화면 전환과 함께 정리 — 단, 캐릭터 클래스는 결과 화면에 영향 없으니 그대로 둔다.
    }
    showResultScreen();
    renderResult();
  }, TUG_KO_SEQUENCE_RESULT_DELAY_MS);
}

function renderResult() {
  const titleEl = document.getElementById('resultTitle');
  const detailEl = document.getElementById('resultDetail');
  if (!titleEl) return;

  let title = '결과';
  if (state.endReason === 'abandoned') {
    title = '상대가 나갔습니다';
  } else if (state.endReason === 'ko') {
    // winnerId 미상(서버 정합성 깨짐) 시 일방 패배로 표기하지 않고 중립 fallback (gemini Major 2).
    if (!state.winnerId) title = 'KO!';
    else title = state.winnerId === myPlayerId ? 'KO 승!' : 'KO 패배';
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

  renderHighlightReel();
}

// Phase E-3: 명장면 회상 — 본인 stats 기반 자동 문구 (SPEC line 565~574). 화면당 2~3개만.
// priority가 큰 후보부터 노출 — slice(0,3)에 의해 임팩트 큰 줄이 잘리지 않게 정렬.
function renderHighlightReel() {
  const reelEl = document.getElementById('highlightReel');
  if (!reelEl) return;
  reelEl.innerHTML = '';

  const myStats = state.stats?.[myPlayerId];
  const isWinner = state.winnerId && state.winnerId === myPlayerId;
  const isDraw = state.endReason === 'timeout' && !state.winnerId;
  const candidates = []; // { text, priority } — priority 큰 순으로 정렬.

  // 무승부.
  if (isDraw) {
    candidates.push({ text: '막상막하! 한 판 더?', priority: 60 });
  }

  if (myStats) {
    // KO 결정 시점이 종료 직전 1초 — 가장 임팩트 큼.
    if (isWinner && state.endReason === 'ko' && Number.isFinite(myStats.finalBlowAt)) {
      const finalMs = myStats.finalBlowAt;
      const leftover = state.durationMs - finalMs;
      if (leftover > 0 && leftover <= 1000) {
        const lefts = Math.round(leftover);
        candidates.push({ text: `${lefts}ms 남기고 KO!`, priority: 100 });
      }
      // 라운드 마지막 3초 (1초 이내 케이스보다 우선순위 낮음).
      else if (leftover > 0 && leftover <= 3000) {
        const remainingSec = Math.round((leftover / 1000) * 10) / 10;
        candidates.push({ text: `마지막 ${remainingSec.toFixed(1)}초 Perfect Pull로 결정!`, priority: 90 });
      }
    }
    // comeback 후 승리 — 매우 임팩트.
    if (isWinner && (myStats.comebackFromRopePos || 0) >= 0.7) {
      candidates.push({
        text: `최대 위기 ${(myStats.comebackFromRopePos).toFixed(2)}에서 comeback!`,
        priority: 95,
      });
    }
    // KO 승리 + 한때 위기였음.
    if (isWinner && state.endReason === 'ko' && (myStats.worstRopePos || 0) > 0.7) {
      const dangerSec = Math.round(((myStats.timeInDangerMs || 0) / 1000) * 10) / 10;
      candidates.push({ text: `발끝에서 ${dangerSec.toFixed(1)}초 버티고 역전!`, priority: 80 });
    }
    // 찌부 생존.
    if ((myStats.timeInDangerMs || 0) > 3000) {
      const sec = Math.round((myStats.timeInDangerMs / 1000) * 10) / 10;
      candidates.push({ text: `찌부 상태 ${sec.toFixed(1)}초 생존!`, priority: 70 });
    }
    // 연속 Perfect.
    if ((myStats.longestPerfectStreak || 0) >= 4) {
      candidates.push({
        text: `최고 연속 Perfect ${myStats.longestPerfectStreak}!`,
        priority: 75,
      });
    }
    // 정확도 — 보너스 통계.
    const taps = (myStats.perfects || 0) + (myStats.goods || 0) + (myStats.misses || 0);
    if (taps >= 10) {
      const accuracy = Math.round(((myStats.perfects || 0) / taps) * 100);
      if (accuracy >= 70) {
        candidates.push({ text: `정확도 ${accuracy}%`, priority: 40 });
      }
    }
  }

  if (candidates.length === 0) return;

  // priority 내림차순 정렬 후 상위 3개.
  candidates.sort((a, b) => b.priority - a.priority);
  const top = candidates.slice(0, 3);
  for (const { text } of top) {
    const li = document.createElement('li');
    li.className = 'highlight-line';
    li.textContent = text;
    reelEl.appendChild(li);
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
function renderRope(now = performance.now()) {
  const arena = document.querySelector('.arena');
  if (!arena) return;
  const arenaWidth = arena.clientWidth || 360;
  const offsetPx = state.ropePos * arenaWidth * 0.32;
  const visual = updateRopeVisualState(now);
  const ropeState = classifyRopeState(state.ropePos);

  const charLeftWrap = document.querySelector('.tug-character--left');
  const charRightWrap = document.querySelector('.tug-character--right');
  const ropeMark = document.querySelector('.tug-rope span');
  const ropeBody = document.querySelector('.tug-rope-body');

  applyRopeMotionState(ropeState, state.ropePos);

  if (charLeftWrap) charLeftWrap.style.transform = `translateX(${offsetPx}px)`;
  if (charRightWrap) charRightWrap.style.transform = `translateX(${offsetPx}px)`;
  if (ropeMark) {
    const markX = offsetPx + visual.wobble * 10;
    const markY = visual.wobble * 4;
    const markScaleX = 1 + visual.tension * 0.14 + visual.stretch * 0.06;
    const markScaleY = 1 + visual.tension * 0.06;
    ropeMark.style.transform = `translate(calc(-50% + ${markX}px), calc(-50% + ${markY}px)) scale(${markScaleX}, ${markScaleY})`;
    ropeMark.style.filter = `brightness(${1 + visual.tension * 0.16}) saturate(${1 + visual.tension * 0.35})`;
    ropeMark.style.boxShadow = `0 ${3 + visual.tension * 4}px ${8 + visual.tension * 10}px rgba(122, 51, 24, ${0.18 + visual.tension * 0.25})`;
  }
  if (ropeBody) {
    const bodyX = offsetPx * 0.12;
    const bodyY = visual.wobble * 3;
    const bodyScaleX = 1 + visual.stretch * 0.16 + visual.tension * 0.05;
    ropeBody.style.transformOrigin = state.ropePos >= 0 ? 'left center' : 'right center';
    ropeBody.style.transform = `translate(${bodyX}px, ${bodyY}px) scaleX(${bodyScaleX})`;
    ropeBody.style.filter = `brightness(${1 + visual.tension * 0.12}) saturate(${1 + visual.tension * 0.28})`;
    ropeBody.style.boxShadow = `0 3px 0 rgba(56, 35, 18, 0.18), 0 0 ${4 + visual.tension * 16}px rgba(247, 95, 95, ${0.08 + visual.tension * 0.22})`;
  }
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

  // 퍼펙트 윈도우 근처에서 가이드 글로우 — ring-local window 우선 (페이즈 race 차단).
  const fallback = getRhythmConfigForStage(state.phaseStage);
  const perfectWindow = Number.isFinite(ring.perfectWindowMs) ? ring.perfectWindowMs : fallback.perfectWindowMs;
  const delta = Math.abs(serverNow - ring.centerAt);
  if (delta <= perfectWindow) {
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
// ring-local window를 우선 사용 (페이즈 전환 race 차단). 누락 시 phaseStage 기반 fallback.
function predictJudgement(ring, tapNow) {
  const fallback = getRhythmConfigForStage(state.phaseStage);
  const perfectWindow = Number.isFinite(ring.perfectWindowMs) ? ring.perfectWindowMs : fallback.perfectWindowMs;
  const goodWindow = Number.isFinite(ring.goodWindowMs) ? ring.goodWindowMs : fallback.goodWindowMs;
  const delta = Math.abs(tapNow - ring.centerAt);
  if (delta <= perfectWindow) return 'perfect';
  if (delta <= goodWindow) return 'good';
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
    tugSynth.miss();
    return;
  }

  if (state.resolvedRingIds.has(ring.id)) return; // 한 ring 한 탭

  state.resolvedRingIds.add(ring.id);
  const predicted = predictJudgement(ring, serverNow);
  showJudgement(predicted, myPlayerId);
  // Phase E-4: 낙관적 사운드 — 서버가 다른 판정을 내려도 OK (사운드는 즉각이 손맛에 핵심).
  if (predicted === 'perfect') tugSynth.perfect();
  else if (predicted === 'good') tugSynth.good();
  else tugSynth.miss();

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
    renderRope(now);
    renderItems(now);
    if (state.iceTintUntilMs && now > state.iceTintUntilMs) {
      state.iceTintUntilMs = 0;
      const arena = document.querySelector('.arena');
      if (arena) arena.classList.remove('is-ice-tinted');
    }
  }

  requestAnimationFrame(localTick);
}

// Phase E-1 — 떨어지는 아이템 박스 렌더. server-authoritative items 배열을
// arena 안의 .tug-item DOM과 1:1로 동기화한다 (id 기준 단순 reconciler).
function renderItems(now) {
  const arena = document.querySelector('.arena');
  if (!arena) return;

  const arenaWidth = arena.clientWidth || 360;
  const arenaHeight = arena.clientHeight || 560;
  const ropeOffsetPx = state.ropePos * arenaWidth * 0.32;
  const liveIds = new Set();

  for (const item of state.items) {
    liveIds.add(item.id);
    let el = arena.querySelector(`.tug-item[data-item-id="${item.id}"]`);
    if (!el) {
      el = document.createElement('span');
      el.className = 'tug-item';
      el.dataset.itemId = item.id;
      el.dataset.itemType = item.itemType;
      el.textContent = TUG_ITEM_VISUAL[item.itemType]?.icon || '✨';
      arena.appendChild(el);
    }
    // x: 줄이 움직이면 박스도 같이 — 현재 ropePos에 맞춰 평행 이동 (SPEC line 237).
    const x = arenaWidth / 2 + ropeOffsetPx;
    // y: 0 (arena 상단) → 줄 라인(48% top) 까지 수직 낙하.
    const ropeY = arenaHeight * 0.48;
    const y = -10 + (ropeY + 10) * (item.fallProgress || 0);
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  }

  // 사라진 박스 제거.
  arena.querySelectorAll('.tug-item').forEach((el) => {
    if (!liveIds.has(el.dataset.itemId)) el.remove();
  });
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

  // Phase E-4: 사용자 첫 인터랙션 시 AudioContext resume — autoplay 정책 우회.
  const resumeAudioOnce = () => {
    tugSynth.ensure();
    tugSynth.resume();
    document.removeEventListener('pointerdown', resumeAudioOnce);
    document.removeEventListener('keydown', resumeAudioOnce);
  };
  document.addEventListener('pointerdown', resumeAudioOnce);
  document.addEventListener('keydown', resumeAudioOnce);

  // Phase E-4: 음소거 토글 — play-topbar 우상단 🔊/🔇 버튼.
  const muteBtn = document.getElementById('tugMuteBtn');
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      tugSynth.setEnabled(!tugSynth.enabled);
      muteBtn.textContent = tugSynth.enabled ? '🔊' : '🔇';
      muteBtn.setAttribute('aria-pressed', String(!tugSynth.enabled));
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
