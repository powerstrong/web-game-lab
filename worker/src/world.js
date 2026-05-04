/* WorldChannel — Durable Object backing the public 2D lounge.
 *
 * Scope of this commit (scaffold only):
 *   - WebSocket upgrade with Hibernation API
 *   - join_world / heartbeat / disconnect bookkeeping
 *   - server-authoritative roster (players keyed by sessionId)
 *
 * Out of scope (future commits):
 *   - position broadcast tick, chat, reactions, zone state machine,
 *     match proposals, GameRoom launch.
 *
 * The world state lives only in DO memory. Nothing here writes to D1.
 */

import { GAME_ZONES } from './worldZones.js';
import { CHARACTERS, isValidCharacterId, randomCharacterId } from './characters.js';

const PROTOCOL_VERSION = 1;
const MAX_NAME_LEN = 16;
const HEARTBEAT_TIMEOUT_MS = 30_000;

const WORLD_BOUNDS = { width: 960, height: 540 };
const SPAWN_POINT = { x: 480, y: 460 };

// Movement validation. Server is authoritative on bounds and direction.
// Speed cheat-prevention is a soft check: positions are clamped to bounds
// and impossibly large jumps within MOVE_THROTTLE_MS are rejected with
// a correction. Stricter physics validation is a future hardening pass.
const MOVE_SPEED = 180;          // px/sec, must match client world.js
const MOVE_THROTTLE_MS = 40;      // server drops moves arriving faster than this
const MAX_JUMP_PX = 80;           // hard ceiling per accepted move (rejects teleports)
const VALID_DIRS = new Set(['up', 'down', 'left', 'right']);

function safeName(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, MAX_NAME_LEN);
  return trimmed.length > 0 ? trimmed : null;
}

function newSessionId() {
  return 'p_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

export class WorldChannel {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.loungeId = null;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/init')) {
      const body = await request.json().catch(() => ({}));
      if (body.loungeId) await this.state.storage.put('loungeId', String(body.loungeId));
      return new Response('ok');
    }

    const upgrade = request.headers.get('Upgrade');
    if (upgrade !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    if (this.loungeId == null) {
      this.loungeId = (await this.state.storage.get('loungeId')) || 'lounge-1';
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.serializeAttachment({
      sessionId: null,
      joinedAt: Date.now(),
      lastHeartbeat: Date.now(),
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // ── WebSocket Hibernation API handlers ──────────────────────────────────────

  async webSocketMessage(ws, raw) {
    let envelope;
    try {
      envelope = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return this._sendError(ws, 'BAD_JSON', 'message is not valid JSON');
    }

    if (!envelope || typeof envelope !== 'object' || envelope.v !== PROTOCOL_VERSION) {
      return this._sendError(ws, 'VERSION', `expected protocol v${PROTOCOL_VERSION}`);
    }

    const t = envelope.t;
    const d = envelope.d ?? {};
    const attach = ws.deserializeAttachment() || {};

    switch (t) {
      case 'join_world':
        return this._handleJoin(ws, attach, d);
      case 'move':
        return this._handleMove(ws, attach, d);
      case 'pong':
        ws.serializeAttachment({ ...attach, lastHeartbeat: Date.now() });
        return;
      default:
        return this._sendError(ws, 'UNKNOWN_TYPE', `unknown message type: ${String(t)}`);
    }
  }

  async webSocketClose(ws) {
    const attach = ws.deserializeAttachment() || {};
    if (attach.sessionId) {
      this._broadcast({ t: 'player_left', d: { id: attach.sessionId } }, ws);
    }
  }

  async webSocketError(ws) {
    return this.webSocketClose(ws);
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  async _handleJoin(ws, attach, d) {
    if (attach.sessionId) {
      return this._sendError(ws, 'ALREADY_JOINED', 'session already joined');
    }

    const name = safeName(d.name);
    if (!name) return this._sendError(ws, 'BAD_NAME', '닉네임이 필요합니다.');

    const characterId = isValidCharacterId(d.characterId) ? d.characterId : randomCharacterId();
    const sessionId = newSessionId();

    const me = {
      id: sessionId,
      name,
      characterId,
      x: SPAWN_POINT.x,
      y: SPAWN_POINT.y,
      dir: 'down',
      moving: false,
      status: 'roam',
      currentZoneId: null,
      candidateSince: null,
    };

    ws.serializeAttachment({
      ...attach,
      sessionId, name, characterId,
      x: me.x, y: me.y, dir: me.dir, moving: me.moving,
      status: me.status, currentZoneId: me.currentZoneId,
      candidateSince: me.candidateSince,
      lastMoveAt: 0,
    });

    const peers = this._collectPlayers().filter((p) => p.id !== sessionId);
    this._send(ws, {
      t: 'welcome',
      d: {
        youId: sessionId,
        loungeId: this.loungeId,
        bounds: WORLD_BOUNDS,
        characters: CHARACTERS.map((c) => ({ worldId: c.worldId, label: c.label, sheet: null })),
        zones: GAME_ZONES.map((z) => ({
          id: z.id, gameId: z.gameId, title: z.title, rect: z.rect,
          minPlayers: z.minPlayers, maxPlayers: z.maxPlayers, holdMs: z.holdMs,
        })),
        players: peers,
        you: me,
      },
    });

    this._broadcast({ t: 'player_joined', d: { player: me } }, ws);
  }

  async _handleMove(ws, attach, d) {
    if (!attach.sessionId) return; // not joined yet — silently ignore

    const now = Date.now();
    const lastMoveAt = attach.lastMoveAt || 0;

    const x = Number(d?.x), y = Number(d?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const dir = VALID_DIRS.has(d?.dir) ? d.dir : (attach.dir ?? 'down');
    const moving = !!d?.moving;

    // Throttle motion bursts but never drop a stop transition — peers must
    // see moving:false promptly or they'll render this player walking forever.
    const isStopTransition = !moving && !!attach.moving;
    if (!isStopTransition && now - lastMoveAt < MOVE_THROTTLE_MS) return;

    // Clamp to bounds.
    const cx = clamp(x, 16, WORLD_BOUNDS.width  - 16);
    const cy = clamp(y, 16, WORLD_BOUNDS.height - 16);

    // Reject obvious teleports (since-last-accepted distance).
    const px = attach.x ?? SPAWN_POINT.x;
    const py = attach.y ?? SPAWN_POINT.y;
    const dist = Math.hypot(cx - px, cy - py);
    if (dist > MAX_JUMP_PX) {
      // Send a correction so the cheat-attempting client snaps back.
      this._send(ws, { t: 'tick', d: { players: [{ id: attach.sessionId, x: px, y: py, dir, moving: false }], at: now } });
      return;
    }

    ws.serializeAttachment({
      ...attach,
      x: cx, y: cy, dir, moving, lastMoveAt: now,
    });

    this._broadcast({
      t: 'tick',
      d: { players: [{ id: attach.sessionId, x: cx, y: cy, dir, moving }], at: now },
    }, ws);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  _collectPlayers() {
    const out = [];
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (!a || !a.sessionId) continue;
      out.push({
        id: a.sessionId,
        name: a.name,
        characterId: a.characterId,
        x: a.x ?? SPAWN_POINT.x,
        y: a.y ?? SPAWN_POINT.y,
        dir: a.dir ?? 'down',
        moving: !!a.moving,
        status: a.status ?? 'roam',
        currentZoneId: a.currentZoneId ?? null,
        candidateSince: a.candidateSince ?? null,
      });
    }
    return out;
  }

  _send(ws, msg) {
    try { ws.send(JSON.stringify({ ...msg, v: PROTOCOL_VERSION })); } catch { /* closed */ }
  }

  _sendError(ws, code, message) {
    this._send(ws, { t: 'error', d: { code, message } });
  }

  _broadcast(msg, except = null) {
    const text = JSON.stringify({ ...msg, v: PROTOCOL_VERSION });
    for (const ws of this.state.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(text); } catch { /* closed */ }
    }
  }
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
