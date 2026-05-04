/* Pure functions for world-channel matching.
 *
 * No I/O, no Date.now() — every entry point takes the values it needs so that
 * the unit tests can drive the state machine deterministically.
 */

export const PLAYER_STATUS = Object.freeze({
  ROAM: 'roam',
  CANDIDATE: 'candidate',
  INTENT_READY: 'intent_ready',
  PROPOSED: 'proposed',
  IN_GAME: 'in_game',
});

/* Update one player's zone-related status given their current position.
 * Returns the next player snapshot (does not mutate the input).
 *
 *   prev      : player snapshot { status, currentZoneId, candidateSince }
 *   zone      : zone the player is currently inside, or null
 *   now       : monotonic timestamp in ms
 *   holdMs    : dwell time required to reach intent_ready
 */
export function applyZonePresence(prev, zone, now, holdMs) {
  // proposed/in_game are managed by the match lifecycle, never demoted by
  // movement alone. The world channel must clear them via clearProposed/etc.
  if (prev.status === PLAYER_STATUS.PROPOSED || prev.status === PLAYER_STATUS.IN_GAME) {
    return prev;
  }

  if (!zone) {
    if (prev.status === PLAYER_STATUS.ROAM && prev.currentZoneId == null) return prev;
    return { ...prev, status: PLAYER_STATUS.ROAM, currentZoneId: null, candidateSince: null };
  }

  if (prev.currentZoneId !== zone.id) {
    return {
      ...prev,
      status: PLAYER_STATUS.CANDIDATE,
      currentZoneId: zone.id,
      candidateSince: now,
    };
  }

  if (prev.status === PLAYER_STATUS.INTENT_READY) return prev;

  const elapsed = now - (prev.candidateSince ?? now);
  if (elapsed >= holdMs) {
    return { ...prev, status: PLAYER_STATUS.INTENT_READY };
  }
  return { ...prev, status: PLAYER_STATUS.CANDIDATE };
}

/* Pull a single match group out of the players currently intent_ready in a
 * zone. Returns null if not enough players, otherwise an object describing
 * the group (caller is responsible for transitioning the players to PROPOSED
 * and removing them from the queue).
 *
 *   players   : array of player snapshots (any status)
 *   zone      : zone definition with min/maxPlayers
 */
export function tryFormMatch(players, zone) {
  const ready = players
    .filter((p) => p.status === PLAYER_STATUS.INTENT_READY && p.currentZoneId === zone.id)
    .sort((a, b) => (a.candidateSince ?? 0) - (b.candidateSince ?? 0));

  if (ready.length < zone.minPlayers) return null;
  const take = Math.min(ready.length, zone.maxPlayers);
  return { zoneId: zone.id, gameId: zone.gameId, players: ready.slice(0, take).map((p) => p.id) };
}

/* Resolve a proposal once every accept is in or the deadline has passed.
 *
 *   proposal  : { players, accepted, declined, deadline }
 *   now       : current time in ms
 *
 * Returns one of:
 *   { kind: 'pending' }
 *   { kind: 'launch', players: [...] }
 *   { kind: 'cancel', reason: 'declined'|'timeout' }
 */
export function resolveProposal(proposal, now) {
  if (proposal.declined.length > 0) {
    return { kind: 'cancel', reason: 'declined' };
  }
  const allAccepted = proposal.players.every((id) => proposal.accepted.includes(id));
  if (allAccepted) {
    return { kind: 'launch', players: [...proposal.players] };
  }
  if (now >= proposal.deadline) {
    return { kind: 'cancel', reason: 'timeout' };
  }
  return { kind: 'pending' };
}
