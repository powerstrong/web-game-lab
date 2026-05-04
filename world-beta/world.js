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

  worldIdLabel.textContent = LOUNGE_ID;

  // shared/input.js only binds arrow keys. Add WASD locally so this page
  // matches the on-screen hint without touching shared input used by games.
  const wasd = { up: false, down: false, left: false, right: false };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'w') { wasd.up    = true; e.preventDefault(); }
    if (k === 's') { wasd.down  = true; e.preventDefault(); }
    if (k === 'a') { wasd.left  = true; e.preventDefault(); }
    if (k === 'd') { wasd.right = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => {
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
  let bounds = { width: canvas.width, height: canvas.height };
  let lastFrameAt = 0;
  let heartbeatTimer = null;
  let rafHandle = null;

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
      case 'player_joined':
      case 'player_left':
        // Ignored in this commit — Commit 4 will render peers.
        return;
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

    joinPanel.classList.add('hidden');
    worldPanel.classList.remove('hidden');
    setConnStatus(true);

    startHeartbeat();
    startRenderLoop();
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

    if (me) drawAvatar(me, /* isYou */ true);
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
