import test from 'node:test';
import assert from 'node:assert/strict';

const { GameRoom } = await import(new URL('../src/room.js', import.meta.url));

function createSocket(player) {
  let attachment = player;
  return {
    sent: [],
    send(text) {
      this.sent.push(JSON.parse(text));
    },
    deserializeAttachment() {
      return attachment;
    },
    serializeAttachment(next) {
      attachment = next;
    },
  };
}

function createHarness({ storageData = {}, sockets } = {}) {
  const socketList = sockets || [
    createSocket({
      id: 'p1',
      role: 'game',
      gameId: 'jump-climber',
      isSpectator: false,
    }),
  ];

  const state = {
    getWebSockets() {
      return socketList;
    },
    storage: {
      async get(key) {
        return storageData[key] ?? null;
      },
      async put(key, value) {
        storageData[key] = value;
      },
      async delete(key) {
        delete storageData[key];
      },
    },
  };

  return {
    sockets: socketList,
    room: new GameRoom(state, {}),
  };
}

function seedJumpGame(room) {
  room.jumpGame = {
    roster: [{ id: 'p1' }],
    expectedPlayers: 1,
    players: {
      p1: {
        id: 'p1',
        name: 'Player 1',
        slot: 0,
        colorIndex: 0,
        characterId: 'mochi-rabbit',
        connected: true,
        inputDirection: 0,
        x: 120,
        y: 480,
        width: 46,
        height: 46,
        vx: 0,
        vy: -11.8,
        bestHeight: 12,
        alive: true,
      },
    },
    platforms: [
      {
        id: 'platform-1',
        kind: 'leaf',
        width: 100,
        height: 18,
        x: 136,
        y: 540,
        baseX: 120,
        rotation: 2.5,
        motion: {
          type: 'drift',
          amplitude: 16,
          speed: 0.5,
          phase: 0.25,
          rotateAmplitude: 3,
        },
      },
    ],
    boosts: [
      {
        id: 'boost-1',
        x: 150,
        y: 472,
        size: 60,
        kind: 'rocket',
      },
    ],
    monsters: [],
    cameraY: -32,
    elapsedMs: 250,
    nextPlatformId: 2,
    nextBoostId: 2,
    messageSeq: 7,
    running: true,
    worldDirty: false,
  };

  return room.jumpGame;
}

test('jump_init sends full world metadata without per-tick platform transforms', () => {
  const { room } = createHarness();
  const game = seedJumpGame(room);

  const message = room._buildJumpStateMessage('jump_init');

  assert.equal(message.mode, 'full');
  assert.equal(message.elapsedMs, game.elapsedMs);
  assert.deepEqual(message.platforms, [
    {
      id: 'platform-1',
      kind: 'leaf',
      width: 100,
      height: 18,
      y: 540,
      baseX: 120,
      motion: {
        type: 'drift',
        amplitude: 16,
        speed: 0.5,
        phase: 0.25,
        rotateAmplitude: 3,
      },
    },
  ]);
  assert.equal('x' in message.platforms[0], false);
  assert.equal('rotation' in message.platforms[0], false);
  assert.deepEqual(message.boosts, game.boosts);
});

test('jump_patch omits world payload when platform topology is unchanged', () => {
  const { room, sockets } = createHarness();
  seedJumpGame(room);

  room._broadcastJumpPatch();

  const patch = sockets[0].sent.at(-1);
  assert.equal(patch.mode, 'patch');
  assert.equal(patch.seq, 8);
  assert.equal(patch.elapsedMs, 250);
  assert.equal('platforms' in patch, false);
  assert.equal('boosts' in patch, false);
  assert.equal(room.jumpGame.worldDirty, false);
});

test('jump_patch includes world payload when the world membership changes', () => {
  const { room, sockets } = createHarness();
  seedJumpGame(room);
  room.jumpGame.worldDirty = true;

  room._broadcastJumpPatch();

  const patch = sockets[0].sent.at(-1);
  assert.equal(patch.mode, 'patch');
  assert.equal(patch.seq, 8);
  assert.deepEqual(patch.platforms, [
    {
      id: 'platform-1',
      kind: 'leaf',
      width: 100,
      height: 18,
      y: 540,
      baseX: 120,
      motion: {
        type: 'drift',
        amplitude: 16,
        speed: 0.5,
        phase: 0.25,
        rotateAmplitude: 3,
      },
    },
  ]);
  assert.deepEqual(patch.boosts, room.jumpGame.boosts);
  assert.equal(room.jumpGame.worldDirty, false);
});

test('ping echoes pong metadata for RTT measurement', async () => {
  const { room } = createHarness();
  seedJumpGame(room);
  const socket = createSocket(null);

  await room.webSocketMessage(
    socket,
    JSON.stringify({ type: 'ping', pingId: 17, clientTimeMs: 1234.5 })
  );

  assert.deepEqual(socket.sent, [
    {
      type: 'pong',
      pingId: 17,
      clientTimeMs: 1234.5,
      elapsedMs: 250,
    },
  ]);
});

test('jump_patch keeps player cadence but slows spectator cadence', () => {
  const playerSocket = createSocket({
    id: 'p1',
    role: 'game',
    gameId: 'jump-climber',
    isSpectator: false,
  });
  const spectatorSocket = createSocket({
    id: 's1',
    role: 'game',
    gameId: 'jump-climber',
    isSpectator: true,
  });
  const { room } = createHarness({ sockets: [playerSocket, spectatorSocket] });
  seedJumpGame(room);

  room._broadcastJumpPatch();
  room._broadcastJumpPatch();
  room._broadcastJumpPatch();
  room._broadcastJumpPatch();

  assert.deepEqual(playerSocket.sent.map((msg) => msg.seq), [8, 9, 10, 11]);
  assert.deepEqual(spectatorSocket.sent.map((msg) => msg.seq), [9]);
});

test('jump_patch still pushes world changes to spectators immediately', () => {
  const playerSocket = createSocket({
    id: 'p1',
    role: 'game',
    gameId: 'jump-climber',
    isSpectator: false,
  });
  const spectatorSocket = createSocket({
    id: 's1',
    role: 'game',
    gameId: 'jump-climber',
    isSpectator: true,
  });
  const { room } = createHarness({ sockets: [playerSocket, spectatorSocket] });
  seedJumpGame(room);
  room.jumpGame.messageSeq = 8;
  room.jumpGame.worldDirty = true;

  room._broadcastJumpPatch();

  assert.equal(playerSocket.sent.length, 1);
  assert.equal(spectatorSocket.sent.length, 1);
  assert.equal(spectatorSocket.sent[0].seq, 9);
  assert.deepEqual(spectatorSocket.sent[0].platforms, [
    {
      id: 'platform-1',
      kind: 'leaf',
      width: 100,
      height: 18,
      y: 540,
      baseX: 120,
      motion: {
        type: 'drift',
        amplitude: 16,
        speed: 0.5,
        phase: 0.25,
        rotateAmplitude: 3,
      },
    },
  ]);
});

test('join_game rejects spectators beyond the two-seat cap', async () => {
  const joiningSocket = createSocket({
    id: 's3',
    name: 'Spectator 3',
    colorIndex: 4,
    role: 'lobby',
  });
  const { room } = createHarness({
    storageData: {
      currentGame: 'jump-climber',
      phase: 'playing',
      gameRoster: [
        { id: 'p1', name: 'Player 1', colorIndex: 0, color: '#ef4444' },
        { id: 'p2', name: 'Player 2', colorIndex: 1, color: '#3b82f6' },
        { id: 's1', name: 'Spectator 1', colorIndex: 2, color: '#22c55e' },
        { id: 's2', name: 'Spectator 2', colorIndex: 3, color: '#f59e0b' },
        { id: 's3', name: 'Spectator 3', colorIndex: 4, color: '#a855f7' },
      ],
    },
    sockets: [
      createSocket({
        id: 's1',
        name: 'Spectator 1',
        colorIndex: 2,
        role: 'game',
        gameId: 'jump-climber',
        isSpectator: true,
      }),
      createSocket({
        id: 's2',
        name: 'Spectator 2',
        colorIndex: 3,
        role: 'game',
        gameId: 'jump-climber',
        isSpectator: true,
      }),
      joiningSocket,
    ],
  });

  await room._handleJoinGame(joiningSocket, { gameId: 'jump-climber', playerId: 's3' });

  assert.deepEqual(joiningSocket.sent.at(-1), {
    type: 'error',
    message: '관전 자리가 꽉 찼습니다. 최대 2명까지 관전 가능합니다.',
  });
  assert.equal(joiningSocket.deserializeAttachment().role, 'lobby');
});
