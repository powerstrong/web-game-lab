/* World client — Commit 3 scope.
 *
 * Responsibilities of this file in this commit:
 *   - Character/name picker UI -> WS connect to /api/world/:loungeId
 *   - Receive `welcome` and render YOUR character on the canvas
 *   - Local-only WASD/arrow movement (no broadcast yet)
 *   - Periodic pong heartbeat so the DO does not GC the session
 *
 * NOT in this commit:
 *   - Sending `move` to the server (Commit 4)
 *   - Rendering other players (Commit 4)
 *   - Chat / reactions / zone matching (later commits)
 */

(function () {
  const PROTOCOL_VERSION = 1;
  const HEARTBEAT_MS = 15_000;
  const MOVE_SPEED = 180; // px/sec
  const LOUNGE_ID = readLoungeId();

  const CHAT_BUBBLE_MS = 5000;
  const REACTION_MS = 1500;
  const REACTIONS = [
    { key: 'wave',  glyph: '👋' },
    { key: 'heart', glyph: '❤️' },
    { key: 'lol',   glyph: '😂' },
    { key: 'wow',   glyph: '😮' },
    { key: 'party', glyph: '🎉' },
    { key: 'sleep', glyph: '😴' },
  ];
  const REACTION_GLYPHS = Object.fromEntries(REACTIONS.map((r) => [r.key, r.glyph]));

  // ── DOM references ──────────────────────────────────────────────────────────
  const joinPanel = document.getElementById('join-panel');
  const worldPanel = document.getElementById('world-panel');
  const nameInput = document.getElementById('name-input');
  const picker = document.getElementById('character-picker');
  const joinBtn = document.getElementById('join-btn');
  const joinStatus = document.getElementById('join-status');
  const connStatus = document.getElementById('conn-status');
  const worldIdLabel = document.getElementById('world-id-label');
  const canvas = document.getElementById('world-canvas');
  const ctx = canvas.getContext('2d');
  const reactionBar = document.getElementById('reaction-bar');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const matchModal = document.getElementById('match-modal');
  const matchTitle = document.getElementById('match-title');
  const matchStatus = document.getElementById('match-status');
  const matchMembers = document.getElementById('match-members');
  const matchAcceptBtn = document.getElementById('match-accept');
  const matchDeclineBtn = document.getElementById('match-decline');
  const matchCountdown = document.getElementById('match-countdown');

  worldIdLabel.textContent = LOUNGE_ID;

  // shared/input.js only binds arrow keys. Add WASD locally so this page
  // matches the on-screen hint without touching shared input used by games.
  const wasd = { up: false, down: false, left: false, right: false };
  function isTypingTarget(t) {
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }
  window.addEventListener('keydown', (e) => {
    if (isTypingTarget(e.target)) return;
    const k = e.key.toLowerCase();
    if (k === 'w') { wasd.up    = true; e.preventDefault(); }
    if (k === 's') { wasd.down  = true; e.preventDefault(); }
    if (k === 'a') { wasd.left  = true; e.preventDefault(); }
    if (k === 'd') { wasd.right = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => {
    if (isTypingTarget(e.target)) return;
    const k = e.key.toLowerCase();
    if (k === 'w') wasd.up    = false;
    if (k === 's') wasd.down  = false;
    if (k === 'a') wasd.left  = false;
    if (k === 'd') wasd.right = false;
  });
  function isHeld(dir) {
    return wasd[dir] || (window.InputManager && window.InputManager.isHeld(dir));
  }

  // ── Picker state ────────────────────────────────────────────────────────────
  let selectedCharacterId = null;
  buildPicker();
  restoreSavedName();

  nameInput.addEventListener('input', updateJoinButton);
  joinBtn.addEventListener('click', tryJoin);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !joinBtn.disabled) tryJoin();
  });

  // ── World state ─────────────────────────────────────────────────────────────
  let ws = null;
  let me = null;        // { id, name, characterId, x, y, dir, moving }
  let peers = new Map(); // id -> { id, name, characterId, x, y, dir, moving }
  let zonesCatalog = []; // [{ id, gameId, title, rect, minPlayers, maxPlayers, holdMs }]
  let zoneStates = new Map(); // zoneId -> { count, ready, minPlayers, maxPlayers }
  let myZoneProgress = null;  // { zoneId, candidateSince, holdMs, ready, serverNow, clientAt }
  let bounds = { width: canvas.width, height: canvas.height };
  let lastFrameAt = 0;
  let heartbeatTimer = null;
  let rafHandle = null;
  let lastMoveSentAt = 0;
  let lastSentSnap = null; // { x, y, dir, moving } — last move we actually sent

  // Per-player ephemeral overlays. Keyed by player id.
  const bubbles = new Map();    // id -> { text, until }
  const reactions = new Map();  // id -> { glyph, until }

  // Active match proposal awaiting our response.
  let activeProposal = null; // { matchId, gameId, title, members, deadline, responded }
  let matchCountdownTimer = null;

  // ── Picker UI ───────────────────────────────────────────────────────────────
  function buildPicker() {
    if (!Array.isArray(window.CHARACTERS)) {
      joinStatus.textContent = '캐릭터 카탈로그를 불러올 수 없습니다.';
      joinStatus.classList.add('error');
      return;
    }
    picker.innerHTML = '';
    for (const c of window.CHARACTERS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'character-card';
      btn.dataset.worldId = c.worldId;
      btn.innerHTML = `
        <div class="preview" aria-hidden="true">${characterEmoji(c.worldId)}</div>
        <span class="label">${escapeHtml(c.label)}</span>
      `;
      btn.addEventListener('click', () => selectCharacter(c.worldId));
      picker.appendChild(btn);
    }
  }

  function selectCharacter(worldId) {
    selectedCharacterId = worldId;
    for (const card of picker.querySelectorAll('.character-card')) {
      card.classList.toggle('selected', card.dataset.worldId === worldId);
    }
    try { localStorage.setItem('world_character', worldId); } catch { /* ignore */ }
    updateJoinButton();
  }

  function updateJoinButton() {
    const okName = nameInput.value.trim().length > 0;
    const okChar = !!selectedCharacterId;
    joinBtn.disabled = !(okName && okChar);
  }

  function restoreSavedName() {
    try {
      const saved = localStorage.getItem('world_name');
      if (saved) nameInput.value = saved;
      const savedChar = localStorage.getItem('world_character');
      if (savedChar) selectCharacter(savedChar);
    } catch { /* ignore */ }
    updateJoinButton();
  }

  // ── WS connect ──────────────────────────────────────────────────────────────
  function tryJoin() {
    if (joinBtn.disabled) return;
    joinBtn.disabled = true;
    joinStatus.classList.remove('error');
    joinStatus.textContent = '연결 중...';

    const name = nameInput.value.trim().slice(0, 16);
    try { localStorage.setItem('world_name', name); } catch { /* ignore */ }

    const base = (window.WORKER_URL || window.location.origin).replace(/^http/, 'ws');
    const url = `${base}/api/world/${encodeURIComponent(LOUNGE_ID)}`;

    try {
      ws = new WebSocket(url);
    } catch (err) {
      showJoinError(`연결 실패: ${err.message}`);
      return;
    }

    ws.addEventListener('open', () => {
      send({ t: 'join_world', d: { name, characterId: selectedCharacterId } });
    });
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', () => showJoinError('연결 오류가 발생했습니다.'));
  }

  function showJoinError(msg) {
    joinStatus.textContent = msg;
    joinStatus.classList.add('error');
    joinBtn.disabled = false;
    if (ws) {
      try { ws.close(); } catch { /* ignore */ }
      ws = null;
    }
  }

  function onMessage(ev) {
    let env;
    try { env = JSON.parse(ev.data); } catch { return; }
    if (!env || env.v !== PROTOCOL_VERSION) return;

    switch (env.t) {
      case 'welcome': return handleWelcome(env.d);
      case 'error': return handleServerError(env.d);
      case 'player_joined': return handlePlayerJoined(env.d);
      case 'player_left': return handlePlayerLeft(env.d);
      case 'tick': return handleTick(env.d);
      case 'chat': return handleChat(env.d);
      case 'reaction': return handleReaction(env.d);
      case 'zone_state': return handleZoneState(env.d);
      case 'zone_progress': return handleZoneProgress(env.d);
      case 'match_proposal': return handleMatchProposal(env.d);
      case 'match_confirmed': return handleMatchConfirmed(env.d);
      case 'match_cancelled': return handleMatchCancelled(env.d);
      default:
        // Quietly ignore unknown types so future server messages don't break us.
        return;
    }
  }

  function handleWelcome(d) {
    if (!d || !d.you) return;
    me = { ...d.you };
    bounds = d.bounds || bounds;
    canvas.width = bounds.width;
    canvas.height = bounds.height;

    peers = new Map();
    if (Array.isArray(d.players)) {
      for (const p of d.players) {
        if (p && p.id && p.id !== me.id) peers.set(p.id, { ...p });
      }
    }

    zonesCatalog = Array.isArray(d.zones) ? d.zones : [];
    zoneStates = new Map(zonesCatalog.map((z) => [z.id, {
      count: numOr(z.count, 0),
      ready: numOr(z.ready, 0),
      minPlayers: z.minPlayers,
      maxPlayers: z.maxPlayers,
    }]));
    myZoneProgress = null;

    joinPanel.classList.add('hidden');
    worldPanel.classList.remove('hidden');
    setConnStatus(true);

    buildReactionBar();
    bindChatForm();
    bindMatchModal();

    startHeartbeat();
    startRenderLoop();
  }

  function buildReactionBar() {
    if (reactionBar.childElementCount > 0) return;
    for (const r of REACTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.key = r.key;
      btn.textContent = r.glyph;
      btn.setAttribute('aria-label', `리액션 ${r.glyph}`);
      btn.addEventListener('click', () => sendReaction(r.key));
      reactionBar.appendChild(btn);
    }
  }

  function bindMatchModal() {
    matchAcceptBtn.addEventListener('click', () => respondToMatch(true));
    matchDeclineBtn.addEventListener('click', () => respondToMatch(false));
  }

  function bindChatForm() {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = chatInput.value;
      if (!text.trim()) return;
      send({ t: 'chat', d: { text } });
      chatInput.value = '';
    });
  }

  function sendReaction(key) {
    if (!REACTION_GLYPHS[key]) return;
    send({ t: 'reaction', d: { emoji: key } });
  }

  function handlePlayerJoined(d) {
    const p = d?.player;
    if (!p || !p.id || (me && p.id === me.id)) return;
    peers.set(p.id, { ...p });
  }

  function handlePlayerLeft(d) {
    if (!d?.id) return;
    peers.delete(d.id);
    bubbles.delete(d.id);
    reactions.delete(d.id);
  }

  function handleTick(d) {
    const updates = Array.isArray(d?.players) ? d.players : [];
    for (const u of updates) {
      if (!u || !u.id) continue;
      // Server may send a correction for self when it rejects a move.
      if (me && u.id === me.id) {
        me.x = numOr(u.x, me.x);
        me.y = numOr(u.y, me.y);
        me.dir = u.dir || me.dir;
        me.moving = !!u.moving;
        continue;
      }
      const existing = peers.get(u.id);
      if (existing) {
        existing.x = numOr(u.x, existing.x);
        existing.y = numOr(u.y, existing.y);
        existing.dir = u.dir || existing.dir;
        existing.moving = !!u.moving;
      }
      // If we receive a tick for an unknown id, it'll arrive via player_joined
      // in normal flow. Ignore otherwise — no point creating a phantom.
    }
  }

  function numOr(v, fallback) { return Number.isFinite(v) ? v : fallback; }

  function handleChat(d) {
    if (!d?.id || typeof d.text !== 'string') return;
    bubbles.set(d.id, { text: d.text.slice(0, 120), until: performance.now() + CHAT_BUBBLE_MS });
  }

  function handleReaction(d) {
    if (!d?.id || !REACTION_GLYPHS[d.emoji]) return;
    reactions.set(d.id, { glyph: REACTION_GLYPHS[d.emoji], until: performance.now() + REACTION_MS });
  }

  function handleZoneState(d) {
    if (!d?.zoneId) return;
    zoneStates.set(d.zoneId, {
      count: numOr(d.count, 0),
      ready: numOr(d.ready, 0),
      minPlayers: numOr(d.minPlayers, 1),
      maxPlayers: numOr(d.maxPlayers, 99),
    });
  }

  function handleMatchProposal(d) {
    if (!d?.matchId || !Array.isArray(d.players)) return;
    activeProposal = {
      matchId: d.matchId,
      gameId: d.gameId,
      title: d.title || d.gameId,
      members: d.players,
      deadline: numOr(d.deadline, Date.now() + 7000),
      responded: null,
    };
    openMatchModal();
  }

  function handleMatchConfirmed(d) {
    if (!d?.matchId) return;
    if (!activeProposal || activeProposal.matchId !== d.matchId) return;
    matchStatus.textContent = '확정됨 — 잠시 후 게임이 시작됩니다.';
    matchAcceptBtn.disabled = true;
    matchDeclineBtn.disabled = true;
    setMemberStatuses(d.accepted || [], d.declined || []);
    stopMatchCountdown();
    matchCountdown.textContent = '';
    // The actual redirect to the game URL is wired in a later commit.
    // For now we just keep the modal informing the user.
  }

  function handleMatchCancelled(d) {
    if (!d?.matchId) return;
    if (!activeProposal || activeProposal.matchId !== d.matchId) {
      // Could be a stale message; close any modal anyway if it matches our id.
      return;
    }
    const reasonText = ({
      declined: '다른 플레이어가 매칭을 취소했습니다.',
      timeout: '시간 초과로 매칭이 취소되었습니다.',
      invalid: '매칭이 취소되었습니다.',
    })[d.reason] || '매칭이 취소되었습니다.';
    matchStatus.textContent = reasonText;
    matchAcceptBtn.disabled = true;
    matchDeclineBtn.disabled = true;
    matchCountdown.textContent = '';
    stopMatchCountdown();
    setTimeout(closeMatchModal, 1200);
  }

  function openMatchModal() {
    if (!activeProposal) return;
    matchTitle.textContent = activeProposal.title;
    matchStatus.textContent = '참가하시겠어요?';
    matchAcceptBtn.disabled = false;
    matchDeclineBtn.disabled = false;
    matchMembers.innerHTML = '';
    for (const m of activeProposal.members) {
      const li = document.createElement('li');
      if (me && m.id === me.id) li.classList.add('is-self');
      li.dataset.id = m.id;
      const glyph = document.createElement('span');
      glyph.className = 'glyph';
      glyph.textContent = characterEmoji(m.characterId);
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = m.name || '익명';
      li.append(glyph, name);
      matchMembers.appendChild(li);
    }
    matchModal.classList.remove('hidden');
    matchModal.setAttribute('aria-hidden', 'false');
    startMatchCountdown();
  }

  function closeMatchModal() {
    matchModal.classList.add('hidden');
    matchModal.setAttribute('aria-hidden', 'true');
    stopMatchCountdown();
    activeProposal = null;
  }

  function setMemberStatuses(accepted, declined) {
    const a = new Set(accepted), dc = new Set(declined);
    for (const li of matchMembers.children) {
      li.classList.remove('accepted', 'declined');
      if (a.has(li.dataset.id)) li.classList.add('accepted');
      if (dc.has(li.dataset.id)) li.classList.add('declined');
    }
  }

  function startMatchCountdown() {
    stopMatchCountdown();
    const tick = () => {
      if (!activeProposal) return;
      const remain = Math.max(0, activeProposal.deadline - Date.now());
      matchCountdown.textContent = `${(remain / 1000).toFixed(1)}초 남음`;
      if (remain <= 0) {
        // Auto-decline on timeout (matches server behavior).
        respondToMatch(false);
      }
    };
    tick();
    matchCountdownTimer = setInterval(tick, 100);
  }

  function stopMatchCountdown() {
    if (matchCountdownTimer) {
      clearInterval(matchCountdownTimer);
      matchCountdownTimer = null;
    }
  }

  function respondToMatch(accept) {
    if (!activeProposal || activeProposal.responded != null) return;
    activeProposal.responded = !!accept;
    matchAcceptBtn.disabled = true;
    matchDeclineBtn.disabled = true;
    matchStatus.textContent = accept ? '참가 의사 전송 — 다른 플레이어 응답 대기...' : '취소를 보내는 중...';
    send({ t: 'match_response', d: { matchId: activeProposal.matchId, accept: !!accept } });
  }

  function handleZoneProgress(d) {
    if (!d || !d.zoneId) {
      myZoneProgress = null;
      return;
    }
    myZoneProgress = {
      zoneId: d.zoneId,
      candidateSince: numOr(d.candidateSince, Date.now()),
      holdMs: numOr(d.holdMs, 3000),
      ready: !!d.ready,
      serverNow: numOr(d.serverNow, Date.now()),
      clientAt: performance.now(),
    };
  }

  function handleServerError(d) {
    const msg = d?.message || '서버 오류';
    if (!me) {
      showJoinError(msg);
    } else {
      // Already in the world — surface but keep the session alive.
      console.warn('[world] server error:', d);
    }
  }

  function onClose() {
    setConnStatus(false);
    stopHeartbeat();
    if (rafHandle) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
    if (!me) {
      showJoinError('서버 연결이 끊겼습니다.');
    } else {
      joinStatus.textContent = '서버 연결이 끊겼습니다. 새로고침 해주세요.';
    }
  }

  function setConnStatus(ok) {
    connStatus.textContent = ok ? '연결됨' : '연결 끊김';
    connStatus.classList.toggle('ok', ok);
    connStatus.classList.toggle('bad', !ok);
  }

  function send(msg) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ v: PROTOCOL_VERSION, ts: Date.now(), ...msg })); } catch { /* closed */ }
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => send({ t: 'pong', d: {} }), HEARTBEAT_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  // ── Render loop ─────────────────────────────────────────────────────────────
  function startRenderLoop() {
    lastFrameAt = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.1, (now - lastFrameAt) / 1000);
      lastFrameAt = now;
      step(dt);
      draw();
      rafHandle = requestAnimationFrame(loop);
    };
    rafHandle = requestAnimationFrame(loop);
  }

  function step(dt) {
    if (!me) return;
    let dx = 0, dy = 0;
    if (isHeld('left'))  dx -= 1;
    if (isHeld('right')) dx += 1;
    if (isHeld('up'))    dy -= 1;
    if (isHeld('down'))  dy += 1;

    const moving = dx !== 0 || dy !== 0;
    me.moving = moving;

    if (moving) {
      // Normalize so diagonal isn't faster.
      const len = Math.hypot(dx, dy);
      const vx = (dx / len) * MOVE_SPEED * dt;
      const vy = (dy / len) * MOVE_SPEED * dt;
      me.x = clamp(me.x + vx, 16, bounds.width  - 16);
      me.y = clamp(me.y + vy, 16, bounds.height - 16);
      me.dir = pickDirection(dx, dy, me.dir);
    }

    maybeSendMove();
  }

  function maybeSendMove() {
    if (!me) return;
    const now = performance.now();
    // Throttle to 50ms while moving. Always send a final stationary snapshot
    // when the moving flag goes false so peers don't see us "stuck walking".
    const snap = { x: Math.round(me.x), y: Math.round(me.y), dir: me.dir, moving: me.moving };
    const stoppedSinceLast = lastSentSnap && lastSentSnap.moving && !snap.moving;
    if (!stoppedSinceLast && now - lastMoveSentAt < 50) return;

    if (lastSentSnap &&
        lastSentSnap.x === snap.x && lastSentSnap.y === snap.y &&
        lastSentSnap.dir === snap.dir && lastSentSnap.moving === snap.moving) {
      return; // nothing changed
    }

    send({ t: 'move', d: snap });
    lastSentSnap = snap;
    lastMoveSentAt = now;
  }

  function pickDirection(dx, dy, prev) {
    if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
    if (dy !== 0) return dy < 0 ? 'up' : 'down';
    return prev;
  }

  function draw() {
    ctx.fillStyle = '#1f2c47';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid for visual reference.
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += 60) {
      ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, canvas.height); ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += 60) {
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(canvas.width, y + 0.5); ctx.stroke();
    }

    drawZones();

    // Draw peers behind me so my avatar sits on top when overlapping.
    for (const p of peers.values()) drawAvatar(p, /* isYou */ false);
    if (me) drawAvatar(me, /* isYou */ true);

    // Overlays on top of everything.
    const now = performance.now();
    drawOverlays(now);
  }

  function drawZones() {
    for (const z of zonesCatalog) {
      const st = zoneStates.get(z.id) || { count: 0, ready: 0 };
      const r = z.rect;
      const inHere = me && myZoneProgress && myZoneProgress.zoneId === z.id;

      ctx.save();
      ctx.fillStyle = inHere ? 'rgba(255,185,107,0.18)' : 'rgba(107,188,255,0.10)';
      ctx.strokeStyle = inHere ? 'rgba(255,185,107,0.85)' : 'rgba(107,188,255,0.55)';
      ctx.lineWidth = 2;
      ctx.setLineDash(inHere ? [] : [6, 4]);
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      ctx.setLineDash([]);

      ctx.fillStyle = '#f0f4ff';
      ctx.font = 'bold 14px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(z.title, r.x + r.w / 2, r.y + 8);

      ctx.font = '12px -apple-system, system-ui, sans-serif';
      ctx.fillStyle = '#cfd8f7';
      ctx.fillText(`${st.count}/${z.maxPlayers} (최소 ${z.minPlayers})`, r.x + r.w / 2, r.y + 26);

      if (inHere) drawZoneCountdown(z, r);
      ctx.restore();
    }
  }

  function drawZoneCountdown(zone, r) {
    if (!myZoneProgress) return;
    const elapsedClient = performance.now() - myZoneProgress.clientAt;
    // serverNow - candidateSince = elapsed at the moment server stamped this
    const baseElapsed = Math.max(0, myZoneProgress.serverNow - myZoneProgress.candidateSince);
    const elapsed = baseElapsed + elapsedClient;
    const remain = Math.max(0, myZoneProgress.holdMs - elapsed);
    const ratio = clamp(elapsed / myZoneProgress.holdMs, 0, 1);

    ctx.fillStyle = '#1a1410';
    ctx.font = 'bold 13px -apple-system, system-ui, sans-serif';
    const status = myZoneProgress.ready ? '준비 완료 — 모이는 중...' : `참가 준비 ${(remain / 1000).toFixed(1)}초`;
    ctx.fillText(status, r.x + r.w / 2, r.y + r.h - 32);

    // Progress bar
    const padX = 14;
    const barW = r.w - padX * 2;
    const barH = 6;
    const barX = r.x + padX;
    const barY = r.y + r.h - 14;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = myZoneProgress.ready ? '#6bdfa1' : '#ffb96b';
    ctx.fillRect(barX, barY, barW * ratio, barH);
  }

  function drawOverlays(now) {
    const drawForPlayer = (p) => {
      const b = bubbles.get(p.id);
      if (b) {
        if (b.until <= now) bubbles.delete(p.id);
        else drawBubble(p.x, p.y, b.text, Math.min(1, (b.until - now) / 600));
      }
      const r = reactions.get(p.id);
      if (r) {
        if (r.until <= now) reactions.delete(p.id);
        else drawReaction(p.x, p.y, r.glyph, Math.min(1, (r.until - now) / 400));
      }
    };
    if (me) drawForPlayer(me);
    for (const p of peers.values()) drawForPlayer(p);
  }

  function drawBubble(cx, cy, text, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '13px -apple-system, system-ui, sans-serif';
    const padX = 8, padY = 6, lineH = 16;
    const lines = wrapText(text, 220);
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2;
    const h = lines.length * lineH + padY * 2;
    const top = cy - 14 - 24 - h;

    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    roundRect(cx - w / 2, top, w, h, 10);
    ctx.fill();

    // Tail
    ctx.beginPath();
    ctx.moveTo(cx - 6, top + h);
    ctx.lineTo(cx, top + h + 8);
    ctx.lineTo(cx + 6, top + h);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#1a1410';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => ctx.fillText(line, cx, top + padY + i * lineH));
    ctx.restore();
  }

  function drawReaction(cx, cy, glyph, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '24px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(glyph, cx, cy - 30);
    ctx.restore();
  }

  function wrapText(text, maxWidth) {
    const out = [];
    let line = '';
    for (const ch of text) {
      const candidate = line + ch;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        out.push(line);
        line = ch;
      } else {
        line = candidate;
      }
      if (out.length >= 3) { out[2] = line; break; }
    }
    if (out.length < 3 && line) out.push(line);
    return out.length ? out : [''];
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawAvatar(p, isYou) {
    const r = 14;
    ctx.save();
    ctx.translate(p.x, p.y);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, r + 4, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body — emoji-on-disk placeholder until sprite sheets land.
    ctx.fillStyle = isYou ? '#ffb96b' : '#6bbcff';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '22px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#1a1410';
    ctx.fillText(characterEmoji(p.characterId), 0, 1);

    // Direction arrow indicator.
    const arrowOffset = { up: [0, -r - 6], down: [0, r + 6], left: [-r - 6, 0], right: [r + 6, 0] }[p.dir] || [0, r + 6];
    ctx.fillStyle = isYou ? '#ffb96b' : '#6bbcff';
    ctx.beginPath();
    ctx.arc(arrowOffset[0], arrowOffset[1], 3, 0, Math.PI * 2);
    ctx.fill();

    // Name tag.
    ctx.font = '12px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = '#f0f4ff';
    ctx.textBaseline = 'bottom';
    ctx.fillText(p.name || '', 0, -r - 8);

    ctx.restore();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function readLoungeId() {
    const raw = new URLSearchParams(window.location.search).get('worldId');
    if (raw && /^lounge-[a-z0-9-]{1,32}$/.test(raw)) return raw;
    return 'lounge-1';
  }

  function characterEmoji(worldId) {
    switch (worldId) {
      case 'latte_puppy': return '🐶';
      case 'mochi_rabbit': return '🐰';
      case 'pudding_hamster': return '🐹';
      case 'mint_kitten': return '🐱';
      case 'peach_chick': return '🐤';
      default: return '⭐';
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
})();
