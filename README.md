# 텐텐오락실 — Web Game Lab

로그인 없이 방 코드 하나로 모여 플레이하는 멀티플레이 미니게임 플랫폼.  
빠른 실험과 짧은 판 구조를 유지하면서, 로비 → 게임 → 결과 흐름을 단계적으로 확장합니다.

## 구조

```text
.
├── index.html              # 허브 — 게임 카드 목록 (GAME_REGISTRY 기반)
├── manifest.webmanifest    # PWA manifest
├── sw.js                   # Service worker (cache-first)
├── assets/
│   └── icon.svg
├── styles/
│   └── lab.css
├── games/
│   └── registry.js         # 게임 메타정보 단일 소스 (window.GAME_REGISTRY)
├── shared/
│   ├── bootstrap.js        # 게임 부트스트랩 계약 (window.GameBoot)
│   └── input.js            # 입력 공통 레이어 (window.InputManager)
├── lobby/
│   ├── index.html          # 닉네임 입력 + 방 생성/입장
│   ├── room.html           # 대기실 (게임 투표, 채팅, 카운트다운, 결과)
│   ├── room.js
│   ├── room.css
│   └── config.js           # WORKER_URL 설정
├── worker/
│   └── src/
│       ├── index.js        # Cloudflare Worker 진입점
│       └── room.js         # Durable Object — 방 상태 관리
├── prototypes/
│   ├── _template/
│   ├── dodge-square/       # SOLO — 반사신경 피하기
│   ├── rhythm-tap/         # PARTY_ASYNC — 타이밍 경쟁
│   └── jump-climber/       # DUEL_LIVE — 모찌팡 점프점프
└── docs/
    ├── prototype-brief.md
    ├── experiment-log.md
    └── next-development-goals.md
```

## 게임 타입

| 타입 | 설명 | 진입 방식 |
|------|------|-----------|
| `SOLO` | 혼자 플레이, 개인 기록 | 허브에서 바로 게임 진입 |
| `DUEL_LIVE` | 실시간 대전 | 로비 → 방 → 게임 |
| `PARTY_ASYNC` | 제한 시간 동시 플레이 후 결과 비교 | 로비 → 방 → 게임 → 점수 제출 → 스코어보드 |

## 현재 주력 프로토타입

### `jump-climber` / 모찌팡 점프점프

- 1P 또는 2P 로컬 동시 플레이
- 캐릭터 3종 선택
- 얼굴 사진 업로드와 미리보기
- 플레이어별 최고 높이 기록 HUD
- 낮은 플레이어 기준 카메라 추적
- 모바일 전체 화면 좌/우 터치 입력

## 공통 레이어

### `games/registry.js`
모든 게임 메타정보의 단일 소스. `window.GAME_REGISTRY` 배열로 노출.  
허브, 로비, 워커가 같은 데이터를 참조한다.

### `shared/bootstrap.js`
게임 페이지가 로드하는 공통 계약. `window.GameBoot`로 노출.

```js
GameBoot.code          // 방 코드 (멀티플레이 시)
GameBoot.name          // 플레이어 이름
GameBoot.gameId        // 게임 ID
GameBoot.isMultiplayer // 로비에서 시작했는지 여부
GameBoot.submitResult({ score, duration })  // 점수 제출
GameBoot.exit()        // 허브 또는 로비로 복귀
```

### `shared/input.js`
키보드·터치 통합 입력 레이어. `window.InputManager`로 노출.

```js
InputManager.isHeld('left'|'right'|'up'|'down')  // 폴링 API
InputManager.onTap(fn) / offTap(fn)               // 이벤트 API
InputManager.setMode('auto'|'keyboard'|'touch')   // 수동 전환
```

페이지 우하단에 입력 방식 전환 버튼을 자동으로 주입하며, 마지막 선택은 localStorage에 저장된다.

## 게임 추가 방법

1. `prototypes/_template`을 복사해 새 폴더를 만든다.
2. `games/registry.js`에 게임 항목을 추가한다.
3. `worker/src/room.js`의 `GAME_PATHS`도 동기화한다.
4. 게임 `index.html`에 필요한 공통 스크립트를 로드한다:

```html
<script src="/shared/input.js"></script>    <!-- 입력 레이어 -->
<script src="/shared/bootstrap.js"></script> <!-- 부트스트랩 계약 -->
<script src="./game.js"></script>
```

## 배포

- **프론트엔드**: Cloudflare Pages — 루트 `index.html`이 진입점
- **백엔드**: Cloudflare Workers + Durable Objects

```bash
# 워커 배포
cd worker && npx wrangler deploy

# 배포 후 config.js에 Worker URL 입력
# lobby/config.js: window.WORKER_URL = 'https://...'
```

## 실험 원칙

- 하나의 프로토타입은 하나의 폴더에서 독립 실행된다.
- 완성도보다 실험 속도를 우선한다.
- 재미 포인트 하나만 검증하는 작은 게임을 선호한다.
- 마음에 들지 않으면 버리고 다음 실험으로 넘어간다.
