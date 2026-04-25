/* Canonical game registry: single source of truth for browser-facing metadata.
 * Loaded as a plain script tag; sets window.GAME_REGISTRY.
 * worker/src/room.js mirrors the playable paths, so keep them in sync. */

window.GAME_REGISTRY = [
  {
    id: 'jump-climber',
    title: '말랑프렌즈 점프',
    description: '세 귀요미 중 하나를 골라 얼굴 커스터마이즈와 2인 점프를 즐겨보세요',
    type: 'DUEL_LIVE',
    recommendedPlayers: '1~2명',
    supportedPlayers: '1~2명',
    playMode: '로컬 동시 플레이',
    durationSeconds: 0,
    status: 'PLAYABLE',
    icon: 'MJ',
    accentColor: '#ff7ea8',
    resultLabel: '최고 높이',
    resultUnit: 'm',
    resultScale: 1,
    resultDecimals: 0,
    path: '/prototypes/jump-climber/index.html',
  },
];
