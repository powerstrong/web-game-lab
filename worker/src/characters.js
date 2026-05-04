/* Server mirror of shared/character_sprites.js for the world matcher.
 * Keep these two files in sync. Asset paths are not used on the server.
 */

export const CHARACTERS = [
  { worldId: 'latte_puppy',     label: '라떼강아지', gameIds: { 'jump-climber': 'latte-puppy',     'mallang-quiz-battle': 'latte-puppy',     'mallang-tug-war': 'latte-puppy' } },
  { worldId: 'mochi_rabbit',    label: '토끼',       gameIds: { 'jump-climber': 'mochi-rabbit',    'mallang-quiz-battle': 'mochi-rabbit',    'mallang-tug-war': 'mochi-rabbit' } },
  { worldId: 'pudding_hamster', label: '햄스터',     gameIds: { 'jump-climber': 'pudding-hamster', 'mallang-quiz-battle': 'pudding-hamster', 'mallang-tug-war': 'pudding-hamster' } },
  { worldId: 'mint_kitten',     label: '고양이',     gameIds: { 'jump-climber': 'mint-kitten',     'mallang-quiz-battle': 'mint-kitten',     'mallang-tug-war': 'mint-kitten' } },
  { worldId: 'peach_chick',     label: '병아리',     gameIds: { 'jump-climber': 'peach-chick',     'mallang-quiz-battle': 'peach-chick',     'mallang-tug-war': 'peach-chick' } },
];

const BY_WORLD_ID = new Map(CHARACTERS.map((c) => [c.worldId, c]));

export function isValidCharacterId(worldId) {
  return BY_WORLD_ID.has(worldId);
}

export function toGameCharacterId(worldId, gameId) {
  const entry = BY_WORLD_ID.get(worldId);
  if (!entry) return null;
  return entry.gameIds[gameId] || null;
}

export function randomCharacterId() {
  return CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)].worldId;
}
