import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PLAYER_STATUS, applyZonePresence, tryFormMatch, resolveProposal } from '../src/matcher.js';
import { GAME_ZONES, getZone, findZoneAt, pointInRect } from '../src/worldZones.js';
import { isValidCharacterId, toGameCharacterId } from '../src/characters.js';

const HOLD = 3000;
const JUMP = getZone('jump-climber');
const TUG = getZone('mallang-tug-war');

function fresh(id, overrides = {}) {
  return { id, status: PLAYER_STATUS.ROAM, currentZoneId: null, candidateSince: null, ...overrides };
}

// ── applyZonePresence ───────────────────────────────────────────────────────

test('roam player stepping into a zone becomes candidate', () => {
  const next = applyZonePresence(fresh('a'), JUMP, 1000, HOLD);
  assert.equal(next.status, PLAYER_STATUS.CANDIDATE);
  assert.equal(next.currentZoneId, 'jump-climber');
  assert.equal(next.candidateSince, 1000);
});

test('candidate that has not held long enough stays candidate', () => {
  const after1s = applyZonePresence(
    { id: 'a', status: PLAYER_STATUS.CANDIDATE, currentZoneId: 'jump-climber', candidateSince: 1000 },
    JUMP, 2999, HOLD
  );
  assert.equal(after1s.status, PLAYER_STATUS.CANDIDATE);
});

test('candidate that has held >= holdMs becomes intent_ready', () => {
  const ready = applyZonePresence(
    { id: 'a', status: PLAYER_STATUS.CANDIDATE, currentZoneId: 'jump-climber', candidateSince: 1000 },
    JUMP, 4000, HOLD
  );
  assert.equal(ready.status, PLAYER_STATUS.INTENT_READY);
});

test('intent_ready player stays intent_ready while inside the zone', () => {
  const stay = applyZonePresence(
    { id: 'a', status: PLAYER_STATUS.INTENT_READY, currentZoneId: 'jump-climber', candidateSince: 1000 },
    JUMP, 9000, HOLD
  );
  assert.equal(stay.status, PLAYER_STATUS.INTENT_READY);
});

test('leaving the zone immediately demotes any non-proposed status', () => {
  const out = applyZonePresence(
    { id: 'a', status: PLAYER_STATUS.INTENT_READY, currentZoneId: 'jump-climber', candidateSince: 1000 },
    null, 5000, HOLD
  );
  assert.equal(out.status, PLAYER_STATUS.ROAM);
  assert.equal(out.currentZoneId, null);
  assert.equal(out.candidateSince, null);
});

test('switching zones resets the candidate timer', () => {
  const switched = applyZonePresence(
    { id: 'a', status: PLAYER_STATUS.INTENT_READY, currentZoneId: 'jump-climber', candidateSince: 1000 },
    TUG, 5000, HOLD
  );
  assert.equal(switched.status, PLAYER_STATUS.CANDIDATE);
  assert.equal(switched.currentZoneId, 'mallang-tug-war');
  assert.equal(switched.candidateSince, 5000);
});

test('proposed status is not affected by movement updates', () => {
  const proposed = { id: 'a', status: PLAYER_STATUS.PROPOSED, currentZoneId: 'jump-climber', candidateSince: 1000 };
  assert.deepEqual(applyZonePresence(proposed, null, 9999, HOLD), proposed);
  assert.deepEqual(applyZonePresence(proposed, TUG, 9999, HOLD), proposed);
});

test('in_game status is not affected by movement updates', () => {
  const inGame = { id: 'a', status: PLAYER_STATUS.IN_GAME, currentZoneId: 'jump-climber', candidateSince: 1000 };
  assert.deepEqual(applyZonePresence(inGame, JUMP, 9999, HOLD), inGame);
});

// ── tryFormMatch ────────────────────────────────────────────────────────────

test('tryFormMatch returns null when below minPlayers', () => {
  const players = [];
  assert.equal(tryFormMatch(players, TUG), null);
  players.push({ id: 'a', status: PLAYER_STATUS.INTENT_READY, currentZoneId: TUG.id, candidateSince: 1000 });
  assert.equal(tryFormMatch(players, TUG), null);
});

test('tryFormMatch slices to maxPlayers in candidateSince order', () => {
  const players = [
    { id: 'late', status: PLAYER_STATUS.INTENT_READY, currentZoneId: 'mallang-quiz-battle', candidateSince: 5000 },
    { id: 'early', status: PLAYER_STATUS.INTENT_READY, currentZoneId: 'mallang-quiz-battle', candidateSince: 1000 },
    { id: 'mid', status: PLAYER_STATUS.INTENT_READY, currentZoneId: 'mallang-quiz-battle', candidateSince: 3000 },
  ];
  const QUIZ = getZone('mallang-quiz-battle');
  // Quiz max is 6 → all three fit
  const m = tryFormMatch(players, QUIZ);
  assert.deepEqual(m.players, ['early', 'mid', 'late']);
});

test('tryFormMatch ignores candidates and players in other zones', () => {
  const players = [
    { id: 'a', status: PLAYER_STATUS.INTENT_READY, currentZoneId: 'jump-climber', candidateSince: 1000 },
    { id: 'b', status: PLAYER_STATUS.CANDIDATE,    currentZoneId: 'jump-climber', candidateSince: 2000 },
    { id: 'c', status: PLAYER_STATUS.INTENT_READY, currentZoneId: 'mallang-tug-war', candidateSince: 500 },
  ];
  const m = tryFormMatch(players, JUMP);
  assert.deepEqual(m.players, ['a']);
});

test('tryFormMatch caps at maxPlayers and leaves the rest queued', () => {
  const players = Array.from({ length: 4 }, (_, i) => ({
    id: `p${i}`,
    status: PLAYER_STATUS.INTENT_READY,
    currentZoneId: 'mallang-tug-war',
    candidateSince: 1000 + i,
  }));
  const m = tryFormMatch(players, TUG);
  assert.deepEqual(m.players, ['p0', 'p1']);
});

// ── resolveProposal ─────────────────────────────────────────────────────────

const baseProposal = (overrides = {}) => ({
  players: ['a', 'b'],
  accepted: [],
  declined: [],
  deadline: 7000,
  ...overrides,
});

test('proposal with all accepts launches', () => {
  const r = resolveProposal(baseProposal({ accepted: ['a', 'b'] }), 5000);
  assert.equal(r.kind, 'launch');
  assert.deepEqual(r.players, ['a', 'b']);
});

test('proposal with any decline cancels even before deadline', () => {
  const r = resolveProposal(baseProposal({ accepted: ['a'], declined: ['b'] }), 1000);
  assert.equal(r.kind, 'cancel');
  assert.equal(r.reason, 'declined');
});

test('proposal still pending before deadline', () => {
  const r = resolveProposal(baseProposal({ accepted: ['a'] }), 5000);
  assert.equal(r.kind, 'pending');
});

test('proposal at or past deadline without full accept cancels as timeout', () => {
  const r = resolveProposal(baseProposal({ accepted: ['a'] }), 7000);
  assert.equal(r.kind, 'cancel');
  assert.equal(r.reason, 'timeout');
});

// ── zone geometry ───────────────────────────────────────────────────────────

test('pointInRect handles edges (right/bottom exclusive)', () => {
  const r = { x: 10, y: 10, w: 100, h: 50 };
  assert.equal(pointInRect(10, 10, r), true);
  assert.equal(pointInRect(109, 59, r), true);
  assert.equal(pointInRect(110, 60, r), false);
  assert.equal(pointInRect(9, 10, r), false);
});

test('findZoneAt returns the matching zone or null', () => {
  const z = findZoneAt(JUMP.rect.x + 10, JUMP.rect.y + 10);
  assert.equal(z.id, 'jump-climber');
  assert.equal(findZoneAt(0, 0), null);
});

test('every zone has a registered gameId path', () => {
  const known = new Set(['jump-climber', 'mallang-tug-war', 'mallang-quiz-battle']);
  for (const zone of GAME_ZONES) {
    assert.ok(known.has(zone.gameId), `unknown gameId: ${zone.gameId}`);
    assert.ok(zone.minPlayers >= 1);
    assert.ok(zone.maxPlayers >= zone.minPlayers);
    assert.ok(zone.holdMs > 0);
  }
});

// ── characters ──────────────────────────────────────────────────────────────

test('character ids round-trip world → game', () => {
  assert.equal(isValidCharacterId('latte_puppy'), true);
  assert.equal(isValidCharacterId('latte-puppy'), false); // game id is not a world id
  assert.equal(isValidCharacterId('not_a_thing'), false);

  assert.equal(toGameCharacterId('mochi_rabbit', 'jump-climber'), 'mochi-rabbit');
  assert.equal(toGameCharacterId('mint_kitten', 'mallang-quiz-battle'), 'mint-kitten');
  assert.equal(toGameCharacterId('peach_chick', 'mallang-tug-war'), 'peach-chick');
  assert.equal(toGameCharacterId('not_a_thing', 'jump-climber'), null);
});
