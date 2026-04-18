/* Canonical game registry — single source of truth for all game metadata.
 * Loaded as a plain script tag; sets window.GAME_REGISTRY.
 * Any page that lists or routes to games should load this first.
 * worker/src/room.js mirrors the paths — keep them in sync manually. */

window.GAME_REGISTRY = [
  {
    id: 'dodge-square',
    title: '닷지 스퀘어',
    description: '끝까지 살아남는 쪽이 이깁니다',
    type: 'SOLO',
    recommendedPlayers: '1명',
    supportedPlayers: '1명',
    playMode: '개인 기록',
    durationSeconds: 60,
    status: 'PLAYABLE',
    icon: 'DS',
    accentColor: '#e74c3c',
    path: '/prototypes/dodge-square/index.html',
  },
  {
    id: 'rhythm-tap',
    title: '리듬 탭',
    description: '타이밍이 정확할수록 점수가 올라갑니다',
    type: 'PARTY_ASYNC',
    recommendedPlayers: '2~4명',
    supportedPlayers: '1~4명',
    playMode: '기록 경쟁',
    durationSeconds: 30,
    status: 'PLAYABLE',
    icon: 'RT',
    accentColor: '#ffb845',
    path: '/prototypes/rhythm-tap/index.html',
  },
  {
    id: 'jump-climber',
    title: '말티쬬 점프점프',
    description: '발판을 밟으며 끝없이 올라가세요',
    type: 'SOLO',
    recommendedPlayers: '1명',
    supportedPlayers: '1명',
    playMode: '개인 기록',
    durationSeconds: 0,
    status: 'PLAYABLE',
    icon: 'JC',
    accentColor: '#59c98a',
    path: '/prototypes/jump-climber/index.html',
  },
];
