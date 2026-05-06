import test from 'node:test';
import assert from 'node:assert/strict';

const { GameRoom } = await import(new URL('../src/room.js', import.meta.url));
const rescueTest = typeof GameRoom.prototype._initRescueGame === 'function' ? test : test.skip;

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

function createHarness() {
  const sockets = [
    createSocket({ id: 'p1', name: 'Air', role: 'game', gameId: 'mallang-rescue' }),
    createSocket({ id: 'p2', name: 'Ground', role: 'game', gameId: 'mallang-rescue' }),
  ];
  const storageData = {};
  const state = {
    getWebSockets() {
      return sockets;
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
  const room = new GameRoom(state, {});
  room._initRescueGame([
    { id: 'p1', name: 'Air', color: '#38bdf8', colorIndex: 0 },
    { id: 'p2', name: 'Ground', color: '#45c46f', colorIndex: 1 },
  ]);
  room.rescueGame.players.forEach((player) => {
    player.connected = true;
    player.ready = true;
  });
  room.rescueGame.phase = 'playing';
  room.rescueGame.startedAt = Date.now();
  return { room, sockets, storageData };
}

rescueTest('mallang-rescue rejects tools outside the player role', () => {
  const { room, sockets } = createHarness();

  room._handleRescuePlaceTool(sockets[0].deserializeAttachment(), { toolId: 'cushion', lane: 0 });

  assert.equal(room.rescueGame.tools.length, 0);
  assert.equal(sockets[0].sent.at(-1).type, 'ERROR');
});

rescueTest('mallang-rescue awards co-op rescue bonus for balloon plus cushion', () => {
  const { room, sockets } = createHarness();
  const now = Date.now();

  room._handleRescuePlaceTool(sockets[0].deserializeAttachment(), { toolId: 'balloon', lane: 0 });
  room._handleRescuePlaceTool(sockets[1].deserializeAttachment(), { toolId: 'cushion', lane: 0 });
  room.rescueGame.fallers = [{
    id: 'f1',
    type: 'rabbit',
    name: '토끼',
    icon: '🐰',
    lane: 0,
    y: 47,
    speed: 0.1,
    baseSpeed: 0.1,
    baseScore: 100,
    weight: 'normal',
    slowedByBalloon: false,
    spawnedAt: now,
  }];

  room._updateRescueFallers(now, 20);
  assert.equal(room.rescueGame.fallers[0].slowedByBalloon, true);

  room._updateRescueFallers(now + 1200, 1200);

  assert.equal(room.rescueGame.fallers.length, 0);
  assert.equal(room.rescueGame.coopCount, 1);
  assert.equal(room.rescueGame.rescuedCount, 1);
  assert.equal(room.rescueGame.score, 150);
  assert.equal(room.rescueGame.lastEvent.type, 'COOP_RESCUE');
});
