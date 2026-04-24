/* Canonical game registry — single source of truth for all game metadata.
 * Loaded as a plain script tag; sets window.GAME_REGISTRY.
 * Any page that lists or routes to games should load this first.
 * worker/src/room.js mirrors the paths — keep them in sync manually. */

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
  {
    id: 'mallang-factory',
    title: '말랑프렌즈 팩토리',
    description: '2인 협동으로 부품을 모아 미니봇을 만들고 납품하세요! QTE 타이밍으로 보너스 획득',
    type: 'DUEL_LIVE',
    recommendedPlayers: '2명',
    supportedPlayers: '2명',
    playMode: '로컬 협동',
    durationSeconds: 240,
    status: 'PLAYABLE',
    icon: '🤖',
    accentColor: '#7ecfff',
    resultLabel: '최종 코인',
    resultUnit: '코인',
    resultScale: 1,
    resultDecimals: 0,
    path: '/prototypes/mallang-factory/index.html',
  },
];
