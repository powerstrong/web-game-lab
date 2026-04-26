# 말랑프렌즈 줄다리기 — MVP 스펙 (v0.4)

> 온라인 1v1, 30초 동안 양쪽 플레이어가 거대한 마시멜로 줄을 당긴다.
> 단순 연타가 아니라 **리듬 타이밍**이 핵심. 줄 위에서 떨어지는 아이템과
> 후반 페이즈 변화로 30초 내내 긴장감 유지.

**핵심 검증 질문:** 리듬 링 타이밍에 정확히 탭했을 때 줄이 쑥 당겨지는 손맛이, 단순 연타 게임보다 더 기분 좋은가?

---

## 디자인 철학 (모든 의사결정의 상위 원칙)

> 이 게임의 차별점은 말랑프렌즈의 귀여운 물리 코미디이고,
> 그 코미디를 플레이어가 직접 만들어낸다고 느끼게 하는 엔진은
> 리듬 풀 입력과 마시멜로 띠의 탄성 피드백이다.
>
> 따라서 **캐릭터 코미디, 입력 손맛, 줄 물리 피드백** 셋은 모두 일급(first-class) 요소다.
> 어느 하나라도 약하면 게임의 재미가 무너진다.

### 기능 추가/수정 검증 질문 3종

모든 기능 결정은 아래 3개 질문을 통과해야 한다. 통과 못 하는 기능은 우선순위를 낮춘다.

1. **캐릭터가 더 귀엽게 찌부러지는가?**
2. **내 탭이 줄에 닿는 손맛이 더 선명해지는가?**
3. **밀고 당기는 감정선이 화면에서 더 잘 보이는가?**

---

## 게임 흐름

```
방 생성/입장 → 2명 입장 → 캐릭터 선택 → Ready
→ 3-2-1 카운트다운 → 30초 라운드
   → 페이즈 1 (0~20초): 일반
   → 페이즈 2 (20~30초): 클러치 (낭떠러지 등장)
→ 승부 결정: 시간 종료 시 줄 위치 우세 OR 한쪽이 낭떠러지로 끌려감
→ 결과
```

---

## MVP 핵심 결정 사항 (논쟁 종결용)

| 항목 | 결정 | 이유 |
|------|------|------|
| 인원수 | **1v1** | 2v2는 팀 싱크 동기화 복잡. MVP는 1v1로 손맛 검증 후 확장 |
| 매치 길이 | **30초** | jump-climber/snow-battle과 동일 사이클 |
| 인풋 방식 | **퍼펙트 탭 1종만** | 차징/싱크는 v2. 리듬 링이 핵심 검증 대상 |
| 아이템 | **2종 (솜사탕폭탄, 얼음별사탕)** | 트롤/거꾸로/황금별은 v2 |
| 페이즈 | **2개 (일반/클러치)** | 바람 이벤트는 v2 |
| 캐릭터 능력 차이 | **없음 (외형만)** | snow-battle와 동일 원칙 |
| 승리 조건 | **줄 위치 + KO 동시 채용** | 시간 종료 시 위치 우세 / 중간에 ±1.0 도달 시 즉시 KO |
| 좌우 방향 규칙 | **A안: 모든 유저 동일 좌우 화면** | P1 항상 왼쪽, P2 항상 오른쪽. 관전/리플레이/공유 일관성 |
| P2 자기 식별 | **UI 강화로 해결** | YOU 라벨 + 진영 하이라이트 + 시작 시 말풍선 |

---

## 라운드 구조

```ts
const ROUND_DURATION_MS = 30000;
const PHASE_CLUTCH_START_MS = 20000;

const RHYTHM_CONFIG = {
  ringIntervalMs: 1000,       // 다음 리듬 링 등장 간격 (ring lifetime 980ms보다 약간 길게)
  ringShrinkDurationMs: 700,  // 링이 줄어드는 시간
  perfectWindowMs: 120,       // 퍼펙트 판정 창
  goodWindowMs: 280,          // 굿 판정 창
};

const RHYTHM_CONFIG_CLUTCH = {
  ringIntervalMs: 820,        // ring lifetime 790ms (550+240)보다 약간 길게
  ringShrinkDurationMs: 550,
  perfectWindowMs: 110,
  goodWindowMs: 240,
};

const ITEM_CONFIG = {
  spawnIntervalMs: 4000,       // 평균 4초마다 1개
  spawnIntervalJitterMs: 1500,
  fallDurationMs: 2200,        // 줄 위에서 떨어지는 데 걸리는 시간
};
```

---

## 줄 위치 모델

핵심 상태값은 **단일 스칼라** `ropePos` (-1.0 ~ +1.0).

- `0.0`: 정중앙 (시작 위치)
- `+1.0`: P1 승리 (P2가 낭떠러지로 끌려감 = KO)
- `-1.0`: P2 승리
- 시간 종료 시 `ropePos > 0`이면 P1, `< 0`이면 P2, 정확히 0이면 무승부

### 풀 파워 계산

각 탭 1회마다 줄 위치 변동:

```ts
function computePullDelta(judgement: 'perfect' | 'good' | 'miss'): number {
  switch (judgement) {
    case 'perfect': return 0.040;
    case 'good':    return 0.018;
    case 'miss':    return -0.005;  // 헛스윙 약한 페널티
  }
}
```

- 30초 동안 양쪽이 모두 퍼펙트만 치면 약 33회 탭 가능 → 한쪽이 우세 시 ±1.0 도달 가능
- 양쪽이 비슷하게 잘 치면 ±0 근처에서 시소 → 시간 승부

### ropePos 5단계 상태 버킷 (감정선의 핵심)

`ropePos` 절대값에 따라 캐릭터/줄 시각 상태가 명확히 달라진다.
플레이어가 점수판을 안 봐도 "지금 내가 위험하다"를 즉시 느껴야 한다.

```ts
function classifyRopeState(ropePos: number): RopeState {
  const abs = Math.abs(ropePos);
  if (abs < 0.20) return 'balanced';     // 팽팽함
  if (abs < 0.45) return 'pushed';       // 밀리기 시작
  if (abs < 0.70) return 'struggling';   // 버둥거림
  if (abs < 0.90) return 'danger';       // 발끝, 찌부
  return 'critical';                     // 거의 추락
}
```

| 상태 | 우세한 쪽 | 밀리는 쪽 |
|------|-----------|-----------|
| balanced | 평정 자세 | 평정 자세 |
| pushed | 자신감 어깨 들썩 | 한 발 뒤로 |
| struggling | 두 발 벌리고 당김 | 발 끌리며 버팀 |
| danger | 줄을 더 강하게 잡음 | 얼굴이 줄에 짓눌림, 찌부 |
| critical | 트로피 자세 직전 | 발끝만 걸침, 추락 직전 |

이 상태는 클라가 `ropePos` 값에서 매 프레임 파생. 서버는 별도로 보내지 않는다.

### 줄 시각 상태 (서버 상태와 분리된 클라 전용 레이어)

`ropePos`는 **게임 판정**에 쓰이고, 아래 시각 값들은 **연출**에 쓰인다.
서버에는 없고 클라이언트가 자체 계산한다.

```ts
type RopeVisualState = {
  pos: number;        // = ropePos (서버 권위값을 lerp한 결과)
  tension: number;    // 0~1, 양쪽이 동시에 강한 풀 시 상승
  wobble: number;     // -1~1, 풀 직후 출렁임
  stretch: number;    // 0~1, |ropePos|가 클수록 늘어난 듯 보임
};
```

- **tension**: 양쪽이 비슷한 시각에 Perfect를 치면 상승 → 줄이 더 팽팽하게 보임 (BGM 살짝 변조 가능)
- **wobble**: 강한 풀 직후 0.4초간 사인파로 진동
- **stretch**: `|ropePos|`에 비례. critical 상태에서는 줄이 찢어질 듯 늘어난 모습

---

## 캐릭터 선택

3종. **외형만 다르고 능력 차이 없음** (snow-battle 원칙 일치).

```ts
// jump-climber와 동일한 ID 체계 사용 — 자산 재사용 가능
const TUG_CHARACTERS = {
  'mochi-rabbit':    { id: 'mochi-rabbit',    name: '모찌 토끼'   },
  'pudding-hamster': { id: 'pudding-hamster', name: '푸딩 햄스터' },
  'peach-chick':     { id: 'peach-chick',     name: '말랑 병아리' },
};
```

**중요**: 캐릭터 ID는 jump-climber의 `JUMP_CHARACTERS` 배열과 완전 일치 (`mochi-rabbit / pudding-hamster / peach-chick`). 이렇게 해야 jump-climber 자산(`prototypes/jump-climber/assets/토끼 메인 이미지.png` 등)을 별도 매핑 레이어 없이 참조할 수 있다. 단, jump-climber에는 `latte-puppy / mint-kitten`도 있지만 줄다리기 MVP는 3종만 지원.

캐릭터 미선택 시 자동 배정. 두 명 모두 Ready 시 시작.

---

## 인풋 — 퍼펙트 탭

화면 중앙 또는 자기 진영에 **리듬 링**이 주기적으로 등장.

```
큰 원 (외곽 가이드, 고정)
  ↓ 점점 안쪽으로 줄어드는 작은 원 (수축 링)
  ↓
링이 가이드와 정확히 일치하는 순간 = 퍼펙트
```

- 링이 등장 → 700ms 동안 수축 → 가이드와 일치 → 빠르게 사라짐
- 사라지기 전 **퍼펙트 창(120ms)** 안에 탭하면 퍼펙트
- 그 바깥쪽 **굿 창(280ms)** 안이면 굿
- 너무 일찍/늦게/링 없을 때 탭하면 미스
- **한 링 = 한 판정**. 한 링에 여러 번 탭해도 최초 1회만 유효 (난사 방지)

### 시각적 피드백 (필수)

| 판정 | 효과 |
|------|------|
| 퍼펙트 | "PERFECT!" 텍스트, 캐릭터 강한 당기기 모션, 줄 큰 변동 |
| 굿 | "GOOD" 텍스트, 캐릭터 보통 당기기, 줄 보통 변동 |
| 미스 | 캐릭터 휘청, 살짝 끌려가는 모션 |

---

## 아이템 시스템 (MVP 2종)

줄 중앙선을 따라 위에서 아래로 떨어지는 박스. 닿으면 자기 캐릭터가 자동으로 **줍는다** (별도 인풋 없음).

```ts
const ITEMS = {
  cottoncandy_bomb: {
    id: 'cottoncandy_bomb',
    name: '솜사탕 폭탄',
    icon: '🍬',
    effect: 'instant_pull',
    pullDelta: 0.10,           // 즉시 줄 0.10 당김
    spawnWeight: 70,
  },
  ice_star: {
    id: 'ice_star',
    name: '얼음 별사탕',
    icon: '❄️',
    effect: 'opponent_next_non_perfect_pull_weakened',
    affectedPulls: 1,            // 상대의 다음 1회 풀에만 적용
    multiplier: 0.75,            // Good 이하 풀파워 -25% (초기값. 약하면 0.70까지 조정)
    perfectBypassesEffect: true, // Perfect는 영향 없음 — 실력으로 극복 가능
    visual: 'ice_slip',          // 발밑이 얼어 미끄러지는 코믹 연출만
    spawnWeight: 30,
  },
};
```

### 아이템 등장/획득 규칙

- 평균 4초마다 1개 등장 (지터 ±1.5초)
- 줄 정중앙(`ropePos`가 0인 절대 좌표)에서 떨어지지 않고, **현재 줄 위치(ropePos)** 위에서 떨어진다 → 줄이 자기 진영에 가까울수록 자기가 먹기 쉽다 (이기는 쪽에 보너스, 지는 쪽엔 역전 기회 약함 — 의도적)
- 단, 떨어지는 동안 줄이 움직이면 박스도 같이 움직임 (줄 위에 얹혀있는 것)
- 화면 하단 도달 시 사라짐 (둘 다 못 먹음)
- 캐릭터가 박스에 닿는 순간 즉시 발동

### 아이템 디자인 원칙 (변경 시 항상 검증)

> **방해는 조작을 망치면 안 되고, 결과를 살짝 약화해야 한다.
> 그리고 Perfect는 항상 방해를 뚫어야 한다.**

- 입력 지연, 터치 무시, 링 속도 변화 등 **조작감 자체를 저하시키는 효과는 금지**
- 모든 방해 효과는 "결과값(풀 파워, 점수 등)을 약화"하는 방식으로만 구현
- Perfect 입력은 어떤 상태에서도 정상 효과를 내야 함 — 실력으로 극복 가능해야 한다
- 솜사탕폭탄도 단순 +0.10 풀이 아니라, 캐릭터가 솜사탕처럼 부풀어 오르는 코믹 모션과 함께 적용

---

## 페이즈 — 2개

### 페이즈 1: 일반 (0~20초)
- 리듬 링 900ms 간격
- 평지 배경
- 화면 양 끝은 평범한 구름

### 페이즈 2: 클러치 (20~30초)

**원칙: 연출이 먼저, 룰 변화는 약하게.**

플레이어가 "갑자기 왜 어려워졌지?"라고 느끼면 안 된다. 압박감은 시각/청각으로 만든다.

**연출 (메인):**
- 배경 어두워짐, 양 끝 구름이 **번개 치는 낭떠러지**로 변환
- 마시멜로 띠가 더 팽팽해 보임 (`tension` 시각값 +0.3 베이스 가산)
- 캐릭터 표정 긴장
- BGM BPM 상승, 카운트다운 강조
- 화면 가장자리에 위험 비네팅

**룰 변화 (서브, 약하게):**
- 리듬 링 1000→820ms 간격 (단일 currentRing 정책 + ring lifetime을 고려한 v0.9 갱신값)
- 퍼펙트 창 120→110ms (10ms만, 거의 체감 안 될 정도)
- 풀 파워 수치는 **변경하지 않음**

**KO 조건은 페이즈와 무관하게 항상 활성** (`|ropePos| >= 1.0`)이지만, 페이즈 1에선 도달이 거의 불가능하고 페이즈 2에서 결판이 잘 난다.

---

## 점수/승리 조건

- 게임 종료 트리거: **30초 종료** OR **`|ropePos| >= 1.0` 도달** 둘 중 먼저
- KO 승리: 즉시 종료, 패자 캐릭터가 낭떠러지로 끌려가는 연출 1.5초
- 시간 종료 승리: `ropePos`의 부호로 결정. 0이면 무승부
- 점수 표시: 보조 지표로 **퍼펙트 수, 굿 수, 미스 수, 아이템 획득 수**

---

## 서버 통신 구조

Cloudflare Durable Object가 authoritative.

**메시지 네이밍 규칙**: 줄다리기 게임 전용 메시지는 모두 `TUG_` 프리픽스를 사용한다.
이렇게 해야 worker `webSocketMessage` switch에서 다른 게임의 메시지와 충돌하지 않는다.

### 클라이언트 → DO

```ts
{ type: 'join_game'; gameId: 'mallang-tug-war'; playerId: string; name: string; code: string }
{ type: 'TUG_READY'; ready: boolean }
{ type: 'TUG_SELECT_CHARACTER'; characterId: 'mochi-rabbit' | 'pudding-hamster' | 'peach-chick' }
{ type: 'TUG_TAP'; ringId: string; clientTapAt: number; clientSeq: number }
{ type: 'TUG_ITEM_GRAB'; itemId: string; clientSeq: number }
```

### DO → 클라이언트

```ts
{ type: 'TUG_JOINED'; role: 'player' | 'spectator'; side?: 'left' | 'right' }
{ type: 'TUG_STATE_SYNC'; state: GameState }
{ type: 'TUG_TAP_RESULT'; ringId: string; playerId: string; judgement: 'perfect' | 'good' | 'miss'; ropeDelta: number; newRopePos: number; clientSeq: number }
{ type: 'TUG_ITEM_RESULT'; itemId: string; playerId: string; effect: string; newRopePos?: number; clientSeq: number }
{ type: 'TUG_GAME_END'; reason: 'timeout' | 'ko' | 'abandoned'; winnerId: string | null; finalRopePos: number; stats: Record<string, PlayerStats> }
{ type: 'error'; message: string }    // 공통 에러 (소문자 'error' — jump-climber와 동일)
```

### 서버 TUG_TAP 검증 순서

1. `phase === 'playing'` 확인
2. `ringId` 존재 + 만료 안 됨 확인
3. **해당 ring에 해당 player가 이미 판정 받았는지** 확인 (이중 판정 방지)
4. `clientTapAt`을 서버 기준 시각으로 보정 (RTT 절반 차감)
5. 보정 시각으로 ring center 시각과의 차이 → 판정 (perfect / good / miss)
6. 판정에 따라 `ropePos` 업데이트
7. `TUG_TAP_RESULT` 브로드캐스트 (클라이언트가 final ropePos를 먼저 받게)
8. `|ropePos| >= 1.0` 체크 → KO면 `TUG_GAME_END`

### 서버 TUG_ITEM_GRAB 검증 순서

1. `phase === 'playing'` 확인
2. `itemId` 존재 + 미수령 확인
3. 클라가 보고한 시점에 해당 플레이어가 줄 위치상 닿을 수 있었는지 검증 (관용 ±0.05)
4. 효과 적용 → `TUG_ITEM_RESULT` 브로드캐스트

---

## 클라이언트 즉시 반응 (핵심)

서버 응답을 기다리지 않는다.

**탭 즉시:**
1. 자기 캐릭터 당기기 모션 재생 (강도는 클라가 추정한 판정에 따라)
2. 줄 위치 클라 예측값으로 살짝 이동
3. 판정 텍스트(PERFECT/GOOD/MISS) 즉시 표시

**서버 TUG_TAP_RESULT 수신 후:**
- 판정 일치: 그대로 진행
- 판정 불일치: 자연스럽게 보간으로 보정 (스냅 회피)
- 줄 위치: 서버 권위값으로 부드럽게 lerp

**클라 예측 한계**: 클라는 자기 탭만 예측. 상대 탭은 서버 브로드캐스트 받은 시점에 표시.

---

## 데이터 모델

```ts
type GameState = {
  phase: 'waiting' | 'countdown' | 'playing' | 'finished';
  players: Player[];
  startedAt?: number;
  durationMs: number;
  timeLeftMs: number;
  ropePos: number;              // -1.0 ~ +1.0, P1 기준 양수
  currentRing: Ring | null;
  items?: Item[];               // Phase E (아이템 시스템) 도입 후 활성. 그 전엔 미송출.
  stats: Record<string, PlayerStats>;
  winnerId?: string | null;
  endReason?: 'timeout' | 'ko' | 'abandoned';
  phaseStage?: 1 | 2;            // Phase D — 1=일반, 2=클러치(라운드 시작 후 20초~)
};

type Player = {
  id: string;
  name: string;
  side: 'left' | 'right';        // P1=left(+ pull), P2=right(- pull)
  characterId?: 'mochi-rabbit' | 'pudding-hamster' | 'peach-chick';
  ready: boolean;
  connected: boolean;
};

type Ring = {
  id: string;
  spawnedAt: number;
  centerAt: number;              // 정확한 일치 시각 (서버 기준)
  expiresAt: number;
  resolvedBy: Record<string, 'perfect' | 'good' | 'miss'>;  // 플레이어별 판정 기록 (서버 전용)
  // ring-local cfg snapshot — 페이즈 1→2 전환 시 활성 ring이 spawn 시점 cfg로 끝까지 판정되도록.
  perfectWindowMs: number;
  goodWindowMs: number;
  shrinkDurationMs: number;
};

type Item = {
  id: string;
  itemType: 'cottoncandy_bomb' | 'ice_star';
  spawnedAt: number;
  expiresAt: number;
  ropePosAtSpawn: number;        // 떨어지기 시작한 줄 위치
  fallProgress: number;          // 0~1, 1이면 화면 하단 도달
  grabbed: boolean;
  grabbedBy?: string;
};

type PlayerStats = {
  // Phase C부터 활성 — 매 탭마다 갱신.
  perfects: number;
  goods: number;
  misses: number;
  itemsGrabbed: number;              // Phase E까지는 항상 0.
  totalPullContribution: number;     // 누적 풀 기여도 (|ropeDelta| 합).
  longestPerfectStreak: number;      // 최대 연속 Perfect 수.
  currentPerfectStreak: number;      // 진행 중 streak (현재 perfect 연속 횟수). good/miss 시 0 리셋.
  // Phase E (결과 화면 명장면 회상) 도입 후 활성. 그 전엔 미송출/undefined.
  worstRopePos?: number;             // 게임 중 가장 위험했던 ropePos (자기 기준 절대값 최대).
  timeInDangerMs?: number;           // danger/critical 상태 누적 체류 시간 (찌부 버틴 시간).
  comebackFromRopePos?: number;      // 가장 깊이 밀렸다가 균형/우세로 복귀한 시점의 위치.
  finalBlowAt?: number;              // KO/우세 결정 시점의 게임 시각 (ms).
};

type RopeState = 'balanced' | 'pushed' | 'struggling' | 'danger' | 'critical';
```

---

## 화면 구성 (세로 모바일)

```
┌────────────────────┐
│ P1점수  남은시간  P2점수 │  ← HUD
├────────────────────┤
│   ☁️ 구름 / 낭떠러지  │  ← 페이즈 따라 변화
│                    │
│  P1 캐릭터 [-----] P2 │  ← 줄 시각화 (가로)
│  (줄 위에 떨어지는 🍬)  │
│                    │
│   ⭕ 리듬 링 영역    │  ← 화면 중앙 큰 영역
│      (탭 위치)       │
│                    │
│   퍼펙트/굿/미스     │
│      텍스트 팝업      │
└────────────────────┘
```

- 줄은 **가로**로 화면을 가로지름. 양 끝에 캐릭터.
- 리듬 링은 **화면 중앙 하단** (엄지 닿기 좋은 위치)
- 탭은 **화면 어디든 OK** (정확도 인풋 아님, 타이밍만 본다)
- 떨어지는 아이템은 줄 위 작은 박스로 표시

### 좌우 방향 규칙 + P2 자기 식별 UI

- **모든 클라이언트가 동일 좌우 화면을 본다** (P1=왼쪽, P2=오른쪽 고정)
- 시점 미러링하지 않는다 — 관전/리플레이/공유 일관성 우선
- P2 입장에서 자기 캐릭터 식별이 약해지는 문제는 UI로 해결:
  - 내 캐릭터 발밑에 `YOU` 라벨 (작은 픽셀 텍스트, 항상 표시)
  - 내 진영(좌/우 절반) 바닥에 약한 색 하이라이트 (자기 캐릭터 색)
  - 내 캐릭터 주변에 은은한 테두리 글로우
  - 라운드 시작 시 내 캐릭터 위에 `YOU!` 말풍선 1초 표시
  - 내 입력 성공 이펙트는 내 캐릭터 기준으로 더 강하게 (반대편보다 명도/크기 +)

---

## 필수 시각 피드백

| 이벤트 | 연출 |
|--------|------|
| 리듬 링 등장 | 큰 가이드 원 + 안쪽 수축 원 |
| 퍼펙트 탭 | 화면 살짝 줌인, "PERFECT!" 황금 텍스트, 캐릭터 강한 당기기 |
| 굿 탭 | "GOOD" 흰 텍스트, 캐릭터 보통 모션 |
| 미스 탭 | 캐릭터 휘청, 화면 약한 셰이크 |
| 줄 위치 변동 | 줄과 캐릭터가 부드럽게 이동, 끌려가는 캐릭터는 발끌기 |
| 아이템 등장 | 줄 위에 통통 튀는 스폰 |
| 솜사탕 폭탄 획득 | 캐릭터 위에 폭발 이펙트, 줄 큰 변동 |
| 얼음 별사탕 획득 | 상대 화면이 청록색 틴트 + 진동 |
| 페이즈 2 진입 | 배경 어두워짐, 양 끝에 번개 이펙트, BGM 변화 |
| 시간 종료 | 호각 소리, 우세한 쪽 점멸 |

에셋 없으면 이모지/CSS 임시 대체 가능.
**단, "리듬 탭 → 퍼펙트 판정 → 줄 당김"의 손맛 흐름은 반드시 보여야 한다.**

### ropePos 상태 변화 시각 (자동 트리거)

`classifyRopeState(ropePos)` 결과가 바뀔 때마다 캐릭터 모션 상태가 자동 전환된다.
플레이어가 점수판을 안 봐도 위기/우세를 즉시 인지하게 만드는 핵심 장치.

| 전환 | 효과 |
|------|------|
| → balanced | 평정 자세 복귀 |
| → pushed | 약한 휘청 (밀리는 쪽), 어깨 들썩 (우세한 쪽) |
| → struggling | 발 끌림 사운드, 캐릭터가 두 발 벌리고 버팀 |
| → danger | 얼굴이 줄에 짓눌리는 찌부 자세, 위기 비네팅 활성화 |
| → critical | 발끝만 걸친 자세, 화면 가장자리 강한 빨강 비네팅 |

### KO 시퀀스 (필수 1.5~2초 연출)

`|ropePos| >= 1.0` 도달 시 즉시 결과 화면으로 넘기지 않는다. 이 게임의 하이라이트.

1. **위기 측 발끝 버팀** (0.0~0.2초): 마지막 한 발끝으로 매달림
2. **마지막 당김** (0.2~0.4초): 승자 측이 한 번 더 으랏차 당기는 모션
3. **마시멜로 띠가 얼굴 누름** (0.4~0.7초): 패자 얼굴 짓눌림 클로즈업 가능
4. **놓침** (0.7~0.9초): "뽕" 사운드와 함께 줄에서 손이 떨어짐
5. **추락** (0.9~1.5초): 구름 아래로 슈웅~ 작아지며 사라짐
6. **승자 포즈** (1.5~1.8초): 뒤로 벌러덩 또는 트로피 자세
7. **결과 화면 전환** (1.8초~)

### 카메라/화면 흔들림 규칙 (절제)

리듬 링 시인성을 위해 흔들림은 최소화한다.

| 상황 | 흔들림 |
|------|--------|
| 일반 Perfect 탭 | **없음** (캐릭터/줄만 튕김) |
| 일반 Good 탭 | 없음 |
| 연속 Perfect 3회+ | 배경만 약하게 (전경 UI는 고정) |
| 강한 아이템 발동 | 약한 줌인, 흔들림은 0.1초 이내 |
| KO 직전 | 약한 줌인 |
| KO 순간 | 강한 흔들림 OK (이때만) |

**리듬 링이 표시되는 동안에는 화면 흔들림 금지.** 판정 시비 방지.

### 상대 입력 판정 표시

상대가 Perfect/Good/Miss를 냈을 때, 내 화면에서도 보여야 한다.
"내가 왜 밀렸는지" 납득 가능성을 위해 필수.

| 상대 판정 | 내 화면에 보이는 것 |
|-----------|---------------------|
| 상대 Perfect | 상대 캐릭터 위 "으랏차!" 말풍선 + 반짝, 줄이 상대 쪽으로 확 당겨짐 |
| 상대 Good | 상대 캐릭터 위 "영차" 작은 말풍선 |
| 상대 Miss | 상대 캐릭터 위 "헛!" 또는 "미끌!" 텍스트, 약한 휘청 |

---

## 필수 사운드 (의성어 8종)

이 게임은 **사운드가 화면만큼 중요하다**. 단순 효과음이 아니라 상태별 감정 사운드.
에셋 없으면 임시로 합성·차용해도 좋지만 출시 전 8종 모두 확보 필수.

| 이벤트 | 의성어 | 톤 |
|--------|--------|----|
| 줄 늘어남 (`stretch` 상승) | 뿌우욱~ | 길게 끌리는 |
| Perfect 풀 | 뽕! | 짧고 경쾌 |
| Good 풀 | 톡! | 짧고 가벼움 |
| Miss | 삐끗 | 헛스윙 |
| 찌부됨 (danger 진입) | 뿌직 / 뿅 | 귀여운 짓눌림 |
| 미끄러짐 (얼음별사탕 효과 발동) | 스윽 | 살짝 미끄러지는 |
| KO 추락 | 슈우웅 | 작아지며 멀어지는 |
| 승리 폭발 | 펑! | 짧은 폭죽 |

추가 필요:
- 페이즈 2 진입 시 BGM 변화 cue
- 카운트다운 3-2-1 음성
- 리듬 링 등장 시 미세한 "틱" (선택)

---

## 결과 화면

### 기본 정보
- 승자/패자 표시 (KO / 시간 종료 / 무승부 구분)
- 양쪽 캐릭터, 최종 줄 위치 시각화
- 통계: 퍼펙트 수 / 굿 수 / 미스 수 / 정확도 % / 아이템 획득 수
- 다시 하기 버튼

### 명장면 회상 (필수)

단순 스코어보드가 아니라 **방금 한 판의 드라마 요약**으로 만든다.
`PlayerStats`에서 자동 생성. 해당하는 문구만 표시.

생성 규칙 예:

| 조건 | 문구 |
|------|------|
| KO 승리 + `worstRopePos > 0.7` (한때 위기였음) | "발끝에서 {time}초 버티고 역전!" |
| `comebackFromRopePos < -0.7` 후 승리 | "최대 위기 {pos}에서 comeback!" |
| `timeInDangerMs > 3000` | "찌부 상태 {sec}초 생존!" |
| `longestPerfectStreak >= 4` | "최고 연속 Perfect {n}!" |
| KO 결정타가 페이즈 2 마지막 3초 | "마지막 {sec}초 Perfect Pull로 결정!" |
| KO 시각이 게임 종료 직전 1초 | "0.{ms}초 남기고 KO!" |
| 무승부 | "막상막하! 한 판 더?" |

화면당 2~3개 문구만 표시. 너무 많으면 노이즈.

### 무승부 연출

`ropePos === 0` 시간 종료는 단순 "DRAW"로 끝내지 않는다.

- 두 캐릭터가 동시에 힘 빠져 주저앉는 모션
- 마시멜로 띠가 축 늘어짐
- 둘이 서로 멀뚱멀뚱 보는 표정
- "막상막하!" 텍스트
- "다시 한 판?" 버튼이 통통 튀어나옴

---

## MVP 완료 기준

- [ ] `prototypes/mallang-tug-war` 폴더 + 라우팅 등록
- [ ] 온라인 방 1v1 접속
- [ ] 캐릭터 3종 선택 (외형만)
- [ ] 두 플레이어 Ready → 3-2-1 카운트다운 → 30초 시작
- [ ] 리듬 링 주기적 등장 (페이즈에 따라 간격 변화)
- [ ] 퍼펙트/굿/미스 판정 + 즉시 시각 피드백
- [ ] 줄 위치 시각화 + 캐릭터 당기기 모션
- [ ] 아이템 2종 등장 + 자동 획득 + 효과 발동
- [ ] 페이즈 2 진입 시 배경/속도/난이도 변화
- [ ] `|ropePos| >= 1.0` 도달 시 KO 1.5~2초 시퀀스 재생 후 결과 화면
- [ ] 시간 종료 시 우세 판정 (무승부 코믹 연출 포함)
- [ ] ropePos 5단계 상태에 따른 캐릭터 모션 자동 전환
- [ ] 줄 시각 상태 레이어 (tension/wobble/stretch) 작동
- [ ] P2 자기 식별 UI (YOU 라벨 + 진영 하이라이트 + 시작 말풍선)
- [ ] 상대 입력 판정(Perfect/Good/Miss) 내 화면 표시
- [ ] 8종 의성어 사운드 적용
- [ ] 결과 화면 명장면 회상 문구 자동 생성
- [ ] 모바일 탭만으로 전체 조작 가능

---

## 구현 진행 상황

본 SPEC을 단계별로 분할 의뢰하여 구현 중. 각 Phase의 산출물·커밋·다음 단계 추적.

### Phase 0 — 코드베이스 정리 ✅ 완료
**커밋**: `6d91c79` Trim prototypes to jump-climber only and isolate its assets

- 미사용 프로토타입 7개 폴더 삭제 (_template, dodge-square, mallang-factory, mallang-rescue, mallang-snow-battle, mallang-tap, rhythm-tap)
- jump-climber 자산 49개를 root `/assets/`에서 `prototypes/jump-climber/assets/`로 이동 (게임별 폴더 정책)
- `worker/src/room.js`에서 Factory/Rescue/Tap 게임 코드 제거 (-1033줄, 59 메서드)
- 자산 참조 갱신 27곳 (game.js, index.html, style.css, root index.html, manifest, README)
- `.gitignore`에 `.claude/`, `.codex-*` 등록

### Phase A — mallang-tug-war 스캐폴딩 ✅ 완료
**상태**: 커밋 직전. 검증 가능 산출물은 "로비에서 카드 보임 → 클릭 시 게임 페이지 진입 → Ready 버튼이 TUG_READY 메시지 송신"까지.

**생성된 파일**:
- `prototypes/mallang-tug-war/index.html` (76줄) — 3-스크린 구조(setup/play/result), 캐릭터 선택 카드 3종, Ready 버튼
- `prototypes/mallang-tug-war/game.js` (128줄) — WebSocket 연결, TUG_JOINED/error 메시지 핸들러, 화면 전환, 캐릭터 선택 UI 핸들러, Ready 버튼 핸들러
- `prototypes/mallang-tug-war/style.css` (281줄) — `--phone-shell: 430px` 모바일 portrait-first 골격, tug 전용 클래스 stub (.tug-rope, .tug-character, .rhythm-ring-container, .judgement-popup)

**수정된 파일**:
- `games/registry.js` — 줄다리기 카드 등록 (icon `🪢`, accentColor `#ff9f50`, durationSeconds 30)
- `worker/src/room.js` — `GAME_PATHS` 추가, `_handleJoinGame` 분기, stub 메서드 5개 (`_handleTugWarJoinGame`, `_handleTugWarReady`, `_handleTugWarSelectCharacter`, `_handleTugWarTap`, `_handleTugWarItemGrab`), 메시지 case 4개, disconnect 분기, 생성자 필드 2개

**서버 stub 동작**:
- `_handleTugWarJoinGame`은 SPEC v0.3대로 1v1 결정 (roster 첫 2명이 player), 그 외는 spectator
- side는 `playerRoster[0].id === msg.playerId ? 'left' : 'right'`로 결정
- `TUG_JOINED { role, side }` 송신
- 게임 상태 초기화/STATE_SYNC 브로드캐스트는 Phase B에서 추가

### Phase A 검토 후 직접 패치
Codex 산출물 검토 중 발견한 critical 이슈를 직접 수정.
- **`game.js:87`** — `showPlayScreen()`이 `playScreen` DOM을 textContent로 덮어쓰는 코드 제거. 이대로 두면 Phase B에서 게임 화면 구성 시 arena/rope/character div가 다 지워짐. placeholder 텍스트는 이미 `index.html`의 `.rhythm-ring-container`에 있음.

### Phase A에서 미해결로 남긴 minor 이슈 (Phase C 시 같이 처리)
- **`game.js:51` `send()` 함수** — 현재 모든 메시지에 자동으로 `clientSeq: ++clientSeq` 부여. SPEC상 `clientSeq`는 `TUG_TAP`/`TUG_ITEM_GRAB`에만 있어야 함. Phase C에서 리듬 탭 처리 들어갈 때 같이 정리.

### Phase B — 캐릭터 선택 동기화 + Ready/카운트다운 ✅ 완료

**구현 산출물**:
- **`worker/src/room.js`**:
  - 상수 `TUG_CHARACTERS / TUG_DEFAULT_CHARACTER / TUG_DURATION_MS / TUG_COUNTDOWN_SECONDS / TUG_PLAYER_COUNT` + `sanitizeTugCharacterId()` 추가
  - `_ensureTugWarGame(playerRoster)` — 1v1 roster로 게임 상태 객체 생성 (phase=waiting, players[id]={side, characterId, ready, connected, ...})
  - `_serializeTugWarState()` — STATE_SYNC 페이로드 빌더 (phase/timeLeftMs/countdownMsLeft/players/ropePos/serverTimeMs)
  - `_broadcastTugWarStateSync()` — game 세션(player+spectator) 전체에 브로드캐스트
  - `_handleTugWarJoinGame()` — currentGame/lobbyPhase 검증, attachment 저장, players[id].connected=true, STATE_SYNC 송출
  - `_handleTugWarSelectCharacter()` — phase==='waiting'에서만 캐릭터 ID 검증 후 갱신 + STATE_SYNC
  - `_handleTugWarReady()` — ready 갱신, 양쪽 player가 connected+ready면 `_startTugWarCountdown()`
  - `_startTugWarCountdown()` / `_tugWarBeginRound()` — phase 전환(waiting→countdown→playing) + setTimeout 3s
  - `_removePlayer()` — tug-war 진행 중 disconnect 시 phase=finished+endReason=`abandoned`, TUG_GAME_END 브로드캐스트
  - `_startCountdown()` / `_handleRematch()`에서 `this.tugWarGame = null` 리셋

- **`prototypes/mallang-tug-war/game.js`** (전면 재작성):
  - 캐릭터 메타 (`TUG_CHARACTERS`) — jump-climber 자산 파일명 매핑 (`토끼/햄스터/병아리 메인 이미지.png`)
  - `applyStateSync()` — 서버 상태 미러 + phase별 화면 전환
  - 캐릭터 카드 클릭 시 `TUG_SELECT_CHARACTER` 송신 (waiting 한정, 관전자 무시)
  - `renderSetup()` — Ready 버튼 상태/상대 ready 상태 표시
  - `renderPlay()` — 양쪽 캐릭터 이미지/이름/YOU 배지, 카운트다운 오버레이, 30초 타이머
  - `localTick()` — STATE_SYNC 사이의 카운트다운/타이머 보간 (rAF)
  - `handleGameEnd()` — TUG_GAME_END(`timeout`/`ko`/`abandoned`) 결과 화면 전환

- **`prototypes/mallang-tug-war/index.html`**:
  - 캐릭터 카드에 `<img>` 추가 (jump-climber 자산 percent-encoded URL)
  - Ready 상태 표시 `#readyStatus`
  - Play 화면: `#tugTimer`, 좌/우 캐릭터 슬롯 + YOU 배지, `#countdownOverlay`, `#rhythmHint`

- **`prototypes/mallang-tug-war/style.css`**:
  - `.character-grid` 3열 그리드, 카드 이미지 64×64
  - `.tug-character` 좌/우 슬롯 + 이름 pill + `.tug-you-badge`
  - `.tug-timer` 상단 중앙 알약 / `.countdown-overlay` 풀스크린 블러+숫자

**디자인 선택**:
- `endReason` 타입을 `'timeout' | 'ko' | 'abandoned'`로 확장 (v0.6, codex 리뷰 반영). disconnect를 KO로 위장하면 통계 의미가 흐려져서 별도 reason으로 명시.
- STATE_SYNC가 `serverTimeMs` 포함 — Phase C에서 RTT 보정 시 활용.
- 클라는 `localTick`(rAF)으로 STATE_SYNC 사이 카운트다운/타이머를 보간. 권위는 STATE_SYNC가 결정.
- countdown/round 모두 `randomHex(8)` token으로 race guard. 새 라운드 시작/abandoned 시 토큰을 무효화해서 늦게 도착한 setTimeout이 새 라운드를 침범하지 못하게 차단.
- 30초 만료 시 `ropePos` 부호로 winner 결정 (Phase B는 항상 0이라 자동 무승부, Phase C부터 의미 있음).

**Phase B에서 미해결로 남긴 이슈 (Phase C 시 처리)**:
- **DO hibernation에 대한 in-memory state 손실 (codex Critical)**: 현재 `tugWarGame`/setTimeout 모두 in-memory. 운영상 hibernation은 짧은 라운드(33초)에서 발생하기 어렵지만, 안전을 위해 Phase C에서 Cloudflare Alarms API + storage 미러링으로 전환 예정. jump-climber도 동일 패턴(setInterval/setTimeout)이라 통합 리팩터 후보.
- `game.js`의 `sendSeq()` 정의됨, 호출처 없음 — Phase C에서 `TUG_TAP`/`TUG_ITEM_GRAB`에 사용 예정.

### Phase C — 리듬 링 + TAP 판정 + ropePos ✅ 완료

**구현 산출물**:
- **`worker/src/room.js`**:
  - 상수 `TUG_TICK_MS / TUG_KO_THRESHOLD / TUG_RHYTHM_CONFIG / TUG_PULL_POWER`
  - `tugWarGame`에 `currentRing / nextRingId / nextRingSpawnAtMs / stats` 필드 추가
  - 플레이어별 `stats` 초기화 (`perfects/goods/misses/totalPullContribution/longestPerfectStreak/currentPerfectStreak/itemsGrabbed`)
  - `_serializeTugRing()` — 클라 송출용 ring 페이로드 (id/spawnedAt/centerAt/expiresAt). resolvedBy는 서버 권한이라 미송출.
  - `_startTugWarLoop / _stopTugWarLoop / _tickTugWar` — 50ms tick. 만료 처리 + 다음 spawn 트리거 + 변경 시 STATE_SYNC.
  - `_spawnTugRing` — `centerAt = spawnedAt + ringShrinkDurationMs`, `expiresAt = centerAt + goodWindowMs`. 이번 spawnedAt + ringIntervalMs를 다음 spawn 시각으로 저장 (등간격).
  - `_handleTugWarTap` — phase/spectator 가드, ringId 일치 + resolvedBy 이중 판정 차단, 서버 도착 시각 vs `centerAt` 차이로 perfect/good/miss 판정 후 ropePos 갱신 + KO 체크 + `TUG_TAP_RESULT` 브로드캐스트. ring 없을 때 탭은 즉시 miss 응답.
  - `_finishTugWarKO()` — `|ropePos| >= 1.0` 도달 시 즉시 종료, ropePos 부호로 winner 결정, `TUG_GAME_END(reason: 'ko')` 브로드캐스트. ring loop 정지.
  - `_finishTugWarTimeout()` / abandoned 분기에서도 `_stopTugWarLoop()` + `_broadcastTugGameEnd(reason)` 헬퍼 사용 (stats 포함).
  - `_tugWarBeginRound()`에서 `_startTugWarLoop()` 호출 + 첫 ring은 ringInterval만큼 지연 후 등장.

- **`prototypes/mallang-tug-war/game.js`**:
  - 상수 `TUG_RHYTHM_CONFIG / TUG_PULL_POWER` (서버와 일치)
  - `state.currentRing / serverClockOffsetMs / resolvedRingIds / lastJudgement` 추가
  - `applyStateSync()`: `serverTimeMs - clientNow`로 clock offset 갱신, `currentRing` 미러, ring id 바뀌면 resolvedRingIds 청소
  - `handleTapResult()`: 서버 권위 ropePos로 정정 + `showJudgement()`로 판정 텍스트 표시
  - `renderRope()`: ropePos를 캐릭터/줄 마커의 translateX로 매핑 (`arenaWidth * 0.32 * ropePos`)
  - `renderRing()`: 매 프레임 호출. 가이드(고정 86px 원) + 수축 원(scale 2.0 → 1.0 → 0.4)을 server clock 기준 진행도로 렌더. 퍼펙트 윈도우 진입 시 가이드 글로우.
  - `predictJudgement()` + `handleTapInput()`: 낙관적 판정 즉시 표시 + 낙관적 ropePos 적용 후 `TUG_TAP` 송신. 서버 응답이 권위.
  - `localTick()`이 매 프레임 `renderRing()` 호출 + 타이머만 직접 갱신 (renderPlay 전체 호출 안 함 — 성능)
  - `arena.pointerdown` + `Space` 키로 탭 입력 (UI 요소는 `data-no-tap`/closest로 제외)

- **`prototypes/mallang-tug-war/index.html`**: 리듬 컨테이너에 `#rhythmGuide` + `#rhythmShrink` div 추가, hint에 `data-no-tap`.

- **`prototypes/mallang-tug-war/style.css`**:
  - `.rhythm-ring-container` 200×200 원형 영역, `.rhythm-guide` 86px 고정 가이드, `.rhythm-shrink`는 transform: scale 변화로 수축
  - `.rhythm-guide.is-perfect` 글로우 효과
  - `.judgement-popup.is-active` 0.6초 키프레임 애니메이션 (퍼펙트=골드, good=흰, miss=핑크)
  - `.tug-character` / `.tug-rope span` transform transition 120ms / 90ms (ropePos 변화 부드럽게)

**디자인 선택**:
- 서버는 클라가 보낸 `clientTapAt` 무시 — 도착 시각만 본다. RTT 보정(SPEC line 327)은 후속. 단순화로 검증 우선.
- 자동 miss(미응답 ring)는 ropePos 영향 없음 — 통계만 갱신. SPEC v0.6에 명시 (penalty는 의도적으로 약하게).
- `serverClockOffsetMs`는 단순 sample (`serverTimeMs - clientNow`). RTT 절반 보정 안 함.
- 클라 낙관적 ropePos는 서버 정정 시 transform transition으로 자연스럽게 보간.
- ring spawn은 `setInterval(50ms)` tick 기반 — DO hibernation 위험은 Phase B에서 명시한 것과 동일 (후속 alarm 전환 후보).

**Phase C에서 미해결로 남긴 이슈 (Phase D 시 처리)**:
- 줄 시각 상태 레이어 `RopeVisualState (tension/wobble/stretch)` 미구현 — Phase D.
- `classifyRopeState` 5단계 캐릭터 모션 자동 전환 미구현 — Phase D.
- 페이즈 2(클러치) 시각/룰 변화 미구현 — Phase D.
- RTT 보정 (`clientTapAt` + ping/pong 기반 clock sync) 미구현 — 후속.
- Cloudflare Alarms 전환 미구현 — 후속.

### Phase D — 줄 시각화(tension/wobble/stretch) + 5단계 상태 모션 + 페이즈 2 연출 ✅ 완료

**구현 산출물**:

- **`worker/src/room.js` (페이즈 2 클러치)**:
  - `TUG_RHYTHM_CONFIG_PHASE1` (1단계, 정상값) / `TUG_RHYTHM_CONFIG_PHASE2` (2단계 클러치, 단축값) 분리
  - `TUG_PHASE_CLUTCH_START_MS = 20000` (라운드 시작 후 20초)
  - `getTugRhythmConfig(game)` / `getTugPhaseStage(game)` — 동적 config/stage
  - `_spawnTugRing(now, cfg)` cfg 매개변수 + `_handleTugWarTap`에서도 동적 cfg
  - `_tickTugWar()` 1→2 stage 전환 감지 시 STATE_SYNC
  - STATE_SYNC payload에 `phaseStage: 1 | 2` 추가

- **`prototypes/mallang-tug-war/game.js` (Phase D Part 1: 줄 시각화 + 5단계 모션)**:
  - `ROPE_VISUAL_CONFIG` (perfectPair window 200ms, tension boost 0.3, decay 0.96, wobble 400ms duration / 0.04 freq)
  - `ropeVisual` 객체 — pos/tension/wobble/stretch + sample 타이밍 추적
  - `classifyRopeState(ropePos)` — SPEC 임계 0.20/0.45/0.70/0.90 (balanced/pushed/struggling/danger/critical)
  - `recordPerfectPull(playerId, ropeDelta)` — 양쪽 200ms 내 perfect 쌍 발생 시 tension +0.3
  - `updateRopeVisualState(now)` — 매 프레임 tension decay, wobble 사인파, stretch
  - `setCharacterMotionState` / `applyRopeMotionState` — `data-rope-state-self/other`로 자기/상대 진영 모션 분리
  - `handleTapResult`에서 perfect 시 `recordPerfectPull` 호출
  - `renderRope`에서 줄 마커/`.tug-rope-body`에 transform/filter/box-shadow로 visual 적용

- **`prototypes/mallang-tug-war/game.js` (Phase D Part 2: 페이즈 2 클러치)**:
  - `TUG_RHYTHM_CONFIG_PHASE1/PHASE2` 분리 (서버와 동일)
  - `state.phaseStage` (default 1)
  - `applyStateSync`에서 `serverState.phaseStage` 미러 + `.arena.is-clutch` 클래스 토글
  - `predictJudgement(ring, tapNow)`이 `getRhythmConfigForStage(state.phaseStage)`로 동적 perfect/good window 사용

- **`prototypes/mallang-tug-war/index.html`**:
  - `.tug-rope` 안에 `.tug-rope-body` div 추가 (줄 본체에 stretch/wobble 적용)

- **`prototypes/mallang-tug-war/style.css`**:
  - `.arena::after` 위기 비네팅 (`data-rope-state="critical"` 시 활성)
  - `.tug-rope-body` 별도 줄 본체 + transform/filter 보간
  - `.tug-character[data-rope-state-self/other="..."]` 5단계 keyframe 애니메이션 (pushed/struggling/danger/critical, self/other 변형)
  - `.arena.is-clutch` 페이즈 2 시각: 어두운 보라/초록 그라디언트 배경, `.arena.is-clutch::before` 양 끝 번개 비네팅 + `tug-clutch-flash` (밝기 진동) + `tug-clutch-bolts` (스텝 alpha)

**디자인 선택**:
- ringIntervalMs를 페이즈 1: 1000ms, 페이즈 2: 820ms로 — ring lifetime보다 약간 길게 잡아 단일 currentRing 정책에서 등간격 보장.
- 페이즈 2 룰 변화는 SPEC 원칙대로 약하게 (window 단축 10ms+40ms). 압박감은 배경/번개로 처리.
- 클라 5단계 모션은 `data-rope-state-self/other` 분리로 자기/상대 캐릭터에 다른 keyframe 적용 — SPEC line 480~488 우세/밀림 분기 구현.
- `recordPerfectPull`에서 wobble seed 갱신 + paired tension boost — 양쪽이 동시 잘 칠수록 줄이 더 팽팽해 보이는 효과 (SPEC line 145~157 의도).

**Phase D에서 미해결로 남긴 이슈 (Phase E 시 처리)**:
- 아이템 2종 (솜사탕폭탄/얼음별사탕) — 미구현
- KO 시퀀스 1.5~2초 7단계 연출 — 현재는 즉시 결과화면 전환
- 결과 화면 명장면 회상 — 현재는 단순 승/패 메시지
- 8종 의성어 사운드 — 미구현
- RTT 보정 / Cloudflare Alarms 전환 — 후속 (Phase B/C에서 명시)

### Phase E-1 — 아이템 2종 ✅ 완료

**구현 산출물**:

- **`worker/src/room.js`**:
  - `TUG_ITEM_CONFIG` (spawn 4000±1500ms, fall 2200ms, autoGrabFallProgress 0.92)
  - `TUG_ITEM_DEFS` (cottoncandy_bomb 70%/+0.10 즉시 풀, ice_star 30%/0.75 multiplier)
  - `pickTugItemType()` 가중치 랜덤 선택
  - `tugWarGame`에 `items / nextItemId / nextItemSpawnAtMs / iceStarPending` 추가
  - `_tickTugItems()` — 매 50ms tick: fallProgress 갱신, autoGrabFallProgress 도달 시 ropePos 부호 기준 우세 진영에게 자동 부여 (ropePos==0이면 미수령)
  - `_spawnTugItem()` — itemType 랜덤, ropePosAtSpawn은 현재 ropePos
  - `_applyTugItemEffect()` — cottoncandy_bomb: ropePos += 0.10 (side 부호) + KO 체크 + TUG_ITEM_RESULT. ice_star: 상대 iceStarPending +1
  - `_handleTugWarTap()`에서 비-Perfect 풀 시 iceStarPending 소비 + ropeDelta * 0.75. perfect는 bypass (pending 유지)
  - STATE_SYNC payload에 `items: [{ id, itemType, spawnedAt, expiresAt, ropePosAtSpawn, fallProgress }]` 추가
  - TUG_ITEM_RESULT 메시지 형식: `{ type, itemId, itemType, playerId, targetId?, effect, ropeDelta, newRopePos, clientSeq }`

- **`prototypes/mallang-tug-war/game.js`**:
  - `state.items` / `state.iceTintUntilMs` 추가
  - `TUG_ITEM_VISUAL` (이모지 메타: 🍬 / ❄️)
  - `applyStateSync`에서 items 미러
  - `handleItemResult()` — ropePos 정정 + 효과별 분기 (cottoncandy_bomb은 캐릭터 burst + perfect 수준의 wobble seed; ice_star는 burst + 본인이 타겟이면 청록 틴트)
  - `flashItemEffect(playerId, itemType)` — 캐릭터 슬롯에 0.9초 burst 이모지 추가/제거
  - `renderItems(now)` — `liveIds` reconciler로 arena 안 `.tug-item` DOM과 1:1 동기화 (id 기준), x는 현재 ropePos에 맞춰 평행 이동, y는 fallProgress * 줄 라인까지
  - localTick에서 매 프레임 renderItems + iceTint 만료 체크

- **`prototypes/mallang-tug-war/style.css`**:
  - `.tug-item` 32×32 박스 + bobble shadow 애니메이션. ice_star는 청록 톤
  - `.tug-item-burst` 0.9s 폭발 키프레임 (perfect/ice_star별 drop-shadow)
  - `.arena.is-ice-tinted::after` 청록 비네팅 (critical 빨강과 분리된 색상)

**디자인 결정**:
- **자동 grab 정책**: SPEC line 240 "캐릭터가 박스에 닿는 순간 즉시 발동" 그대로. 클라 → 서버 `TUG_ITEM_GRAB` 메시지는 정의만 유지하고 MVP에서는 미사용. 서버 권위로 모든 결정.
- 우세 진영 자동 grab (ropePos 부호) — SPEC line 235 "줄이 자기 진영에 가까울수록 자기가 먹기 쉽다"의 단순 구현.
- ice_star pending: perfect는 bypass + pending 유지 → 다음 비-perfect까지 보존. 실력으로 극복 가능 보장 (SPEC line 244~250 디자인 원칙 준수).
- ropePos==0 균형 시 둘 다 못 먹음 — 의도적 (의도 vs 자동 부여 사이 절충).

---

## 절대 하지 말 것 (MVP 범위 외)

- 2v2 / 4인 모드
- 차징 탭 (길게 누르기)
- 팀 싱크 보너스
- 거꾸로 사탕, 트롤 아이템, 황금별 거대화
- 캐릭터 능력 차이
- 바람 이벤트 (페이즈 1.5)
- 캐릭터 스킨 (시즌)
- 토너먼트 모드
- AI 봇
- 퀵챗/이모지 도발
- 키보드 필수 조작
- 캐릭터 직접 이동

---

## 구현 순서

1. 저장소 구조 파악 (jump-climber, snow-battle 통신 방식 재확인)
2. `prototypes/mallang-tug-war` 생성 + 레지스트리 등록
3. HTML/CSS 기본 모바일 UI (가로 줄 + 양쪽 캐릭터 + 중앙 탭 영역)
4. DO에 `mallang-tug-war` gameId 추가, 1v1 매칭 로직
5. 캐릭터 선택 + Ready + 카운트다운
6. 서버 게임 상태 모델 + 30초 타이머 + 페이즈 전환
7. 리듬 링 스폰 로직 (서버 권위, ringId 발행)
8. TAP 판정 (서버 시각 보정 포함) + ropePos 업데이트
9. 클라 즉시 판정 예측 + TAP_RESULT 보간 보정
10. 줄 위치 시각화 + 캐릭터 당기기 모션
11. 아이템 스폰/낙하/획득 처리
12. 페이즈 2 시각/난이도 전환
13. KO/시간 종료 처리 + 결과 화면
14. 모바일 터치 QA (다양한 화면 크기, 네트워크 지연 환경)

---

## 향후 확장 (v2 이후, 참고용)

이 항목들은 MVP에서 명시적으로 제외했지만 손맛 검증 후 우선 검토 대상:

- **2v2 팀전**: 4인 풀 활용, 팀 싱크 탭 보너스(0.2초 내 동시 탭 +50%)
- **차징 탭**: 길게 눌러 큰 한 방. 충전 중 끌려가는 리스크
- **바람 이벤트**: 10~20초 구간 좌/우 바람으로 풀파워 ±20% 보정
- **캐릭터 능력 차이**: 토끼(퍼펙트 보너스), 햄스터(자동 풀), 병아리(링 크게 보임)
- **트롤/거꾸로 아이템**: 좌우 반전, 자해 아이템 학습
- **퀵챗 도발**: ㄲ/ㅋㅋ/ㅎㅇ 4종 버튼
- **시즌 줄 스킨**: 호박넝쿨, 양말줄

---

## 외부 리뷰 요청 시 핵심 질문

이 스펙을 외부(GPT 등)에 검토 의뢰할 때 묻고 싶은 것:

1. **재미 가설 검증**: "리듬 타이밍 + 줄 위치 + 아이템" 3중 레이어가 30초 동안 지루함 없이 작동할까?
2. **밸런스 우려**: 아이템이 "이기는 쪽 위에서 떨어지는" 룰이 역전 기회를 너무 죽이지 않나?
3. **인풋 대안**: 퍼펙트 탭 1종으로 MVP 충분한가, 아니면 차징 탭도 MVP에 넣어야 하나?
4. **승리 조건**: KO + 시간 종료 두 트랙이 혼란스럽지 않을까? 한 가지로 단순화해야 하나?
5. **장르 차별**: 줄다리기 모바일 게임 시장에서 이 컨셉의 차별점이 충분한가?
6. **기술적 함정**: 서버 권위 리듬 링 + 클라 예측에서 RTT 변동 시 판정 시비가 큰 문제가 될까?

---

## 변경 이력

### v0.14 (Phase E-2 gemini 리뷰 반영)

**Major 1 — KO 시퀀스 도중 후행 메시지 차단**: `koSequenceActive=true`인 동안 `handleGameEnd`/`applyStateSync`가 `winnerId/endReason`을 덮어쓰지 못하도록 가드. abandoned/timeout STATE_SYNC가 늦게 도착해도 KO 연출과 결과 텍스트가 일관되게 유지됨.

**Major 2 — KO + winnerId null fallback**: `endReason === 'ko'`인데 winnerId가 없는 정합성 예외에서 본인이 일방적으로 "KO 패배"로 보이는 문제 회피. 이 케이스는 "KO!" 중립 메시지로 표시.

### v0.13 (Phase E-2 완료 — KO 1.8초 7단계 시퀀스)

**클라 전용 구현** — 서버 변경 없음. KO 발생 시 서버는 즉시 `phase: 'finished', endReason: 'ko'`로 전환하지만, 클라가 결과 화면 전환을 1.8초 보류하고 그동안 SPEC line 491~499의 7단계 연출을 단일 통합 keyframe으로 진행한다.

**`game.js`**:
- `state.koSequenceActive` 플래그 (중복 시작 방지)
- `finalizeFinish()` — `endReason==='ko' && winnerId`이면 `playKoSequence()`, 아니면 즉시 `showResultScreen+renderResult`
- `handleGameEnd` + `applyStateSync('finished')` 둘 다 `finalizeFinish()`로 합류 (메시지 도착 순서 무관)
- `playKoSequence(winnerId)` — `.arena.is-ko-sequence` + 캐릭터에 `.is-ko-winner / .is-ko-loser` 부여, ice/clutch overlay 정리, 1800ms 후 결과 화면

**`style.css`**:
- `.arena.is-ko-sequence` 활성 시 `#rhythmRing / .judgement-popup / #tugTimer` 페이드 아웃, `::after / ::before` (클러치/critical) 강제 정지
- `.tug-character.is-ko-loser` `tug-ko-loser` keyframe — 발끝버팀(10%) → 끌리기(22%) → 짓눌림(38%) → 반동(50%) → 놓침(60%) → 추락(83%) → 시야밖(100%)
- `.tug-character.is-ko-winner` `tug-ko-winner` keyframe — 으랏차(22%) → 반동(38~50%) → 트로피 자세(83~100%) + drop-shadow glow

**디자인 결정**:
- 서버는 KO 결정 즉시 phase=finished. 클라 보류로 1.8초 연출 — 서버/네트워크 라운드트립 부담 없이 자연스러운 손맛 유지.
- 단일 keyframe에 7단계를 % 키프레임으로 묶음 — JS 단계 토글 없이 CSS 자연 진행.
- abandoned/timeout은 시퀀스 없이 즉시 전환 — KO만의 하이라이트 보존.

### v0.12 (Phase E-1 gemini 리뷰 반영)

**Critical — CSS pseudo 충돌**: `.arena.is-ice-tinted::after`와 `.arena[data-rope-state="critical"]::after`가 같은 `::after`를 공유해 critical과 ice tint 동시 활성 시 충돌. `.tug-ice-tint` 별도 div + arena 자식으로 이동, `.arena.is-ice-tinted .tug-ice-tint` opacity 토글로 변경. critical ::after는 그대로 유지 → 두 비네팅이 독립 z-layer로 공존.

**Minor — 미사용 변수 제거**: `renderItems`의 `trackOffsetPx` (void 처리됨) 제거.

**Minor — Ice Star miss 동작 명문화**: 의도적 동작 — miss는 ropePos 영향 없음 + iceStarPending 유지(소비 안 함). 다음 good/perfect 풀까지 보존. 플레이어가 의도하지 않은 헛스윙으로 ice star가 풀리지 않게 함. SPEC line 224 `affectedPulls: 1` "다음 1회 풀에만"의 "풀"은 ropePos에 영향을 주는 풀(perfect/good)을 의미.

### v0.11 (Phase E-1 완료 — 아이템 시스템)

**서버**: `TUG_ITEM_CONFIG` (4000±1500ms 스폰 / 2200ms 낙하), `TUG_ITEM_DEFS` (`cottoncandy_bomb` 70%/+0.10, `ice_star` 30%/0.75 multiplier 비-perfect 약화), `pickTugItemType()` 가중치 랜덤. `_tickTugItems`가 fallProgress 갱신 + 자동 grab 처리 (ropePos 부호 기반 우세 진영). `_handleTugWarTap`에 `iceStarPending` 소비 (perfect bypass + pending 유지). STATE_SYNC payload에 `items` 추가.

**클라**: `state.items` 미러 + `renderItems(now)` reconciler로 `.tug-item` DOM 동기화. `handleItemResult`에서 cottoncandy_bomb 폭발 burst + ropePos 정정 + wobble seed, ice_star burst + 타겟 본인이면 `.arena.is-ice-tinted` 청록 오버레이 (4s 만료).

**스타일**: `.tug-item` 32×32 박스 + bobble shadow, `.tug-item-burst` 0.9s 키프레임, `.arena.is-ice-tinted::after` 청록 비네팅.

**TUG_ITEM_GRAB 메시지는 정의만 유지** — MVP는 자동 grab 정책으로 단순화. SPEC 메시지 사양은 v2 확장 여지로 보존.

### v0.10 (Phase D codex 리뷰 반영)

**Major 1 — Ring-local cfg snapshot**: ring 객체에 `perfectWindowMs / goodWindowMs / shrinkDurationMs`를 spawn 시점 cfg로 저장. 서버 `_handleTugWarTap`은 ring-local window로 판정, 클라 `predictJudgement` / `renderRing` glow도 ring-local window 우선 사용. 페이즈 1→2 전환 시 활성 ring이 phase 2 window로 갑자기 판정되는 race를 차단.

**Major 2 — `handleTapResult` ropeDelta 직접 사용**: 클라가 서버 `msg.ropeDelta`를 그대로 사용하도록 변경. 기존에는 `newRopePos - prevRopePos`로 재계산해서 낙관적 ropePos 적용 후 0이 되어 perfect 쌍 tension boost가 깨졌음.

**Minor 2 — GameState/PlayerStats 타입 동기화**: `items?` Phase E 옵셔널 명시, `Ring` 타입에 ring-local cfg 필드 추가, `PlayerStats`를 Phase C 활성 / Phase E 옵셔널로 분리. `currentPerfectStreak` 추가 명시.

**Minor 3 — `.arena.is-clutch` filter 분리**: filter 애니메이션을 `.arena` 자체가 아닌 `.arena.is-clutch::before` 배경 전용 pseudo로 옮김. 리듬 링/판정 텍스트 시인성 보호 (SPEC line 514 "리듬 링 표시 중 흔들림 금지" 준수).

**Minor 4 — SPEC 700ms 잔존 정리**: 페이즈 2 룰 변화 서술의 "900→700ms 간격" → "1000→820ms 간격"으로 v0.9 갱신값에 맞춤.

### v0.9 (Phase D 완료)

**Phase D Part 1 (줄 시각화 + 5단계 모션)**: `RopeVisualState` (tension/wobble/stretch) 클라 전용 시각 레이어 도입. 매 프레임 ropePos sample 기반으로 tension decay (0.96^frame), wobble 사인파(0.04 freq, 400ms duration), stretch (|ropePos|+pos delta). perfect 쌍 200ms 내 발생 시 tension +0.3 부스트. `classifyRopeState` 5단계 (balanced/pushed/struggling/danger/critical) 매 프레임 분류 + `data-rope-state-self/other` 속성으로 자기/상대 진영 모션 분리.

**Phase D Part 2 (페이즈 2 클러치)**: 서버 `TUG_RHYTHM_CONFIG_PHASE1/PHASE2` 분리, `getTugPhaseStage()` 동적 stage, STATE_SYNC에 `phaseStage: 1|2` 추가. 클라도 동일한 phase별 RHYTHM_CONFIG를 가져 `predictJudgement`이 phase별 동적 window 사용. `.arena.is-clutch` CSS — 어두운 보라/초록 배경 + 양 끝 번개 비네팅 + 밝기 깜빡임 애니메이션. 룰 변화는 약하게(window 단축 10ms+40ms), 압박감은 시각으로.

**`RHYTHM_CONFIG_CLUTCH.ringIntervalMs` 700→820**: ring lifetime(550+240=790ms) > 기존 700ms 정책 충돌 해결. SPEC line 73 갱신.

### v0.8 (Phase C codex 리뷰 반영)

**Major 1 — 자동 miss stats 적용**: `_tickTugWar`의 ring 만료 처리에서 `_applyTugTapStats(playerId, 'miss', 0)` 호출 추가. ropePos 영향 없이 misses/perfectStreak 끊김만 갱신.

**Major 2 — `ringIntervalMs` 900→1000ms**: ring lifetime(shrink 700 + good 280 = 980ms) > 기존 ringInterval 900ms이라 단일 currentRing 정책에서 등간격이 깨졌음. 1000ms로 늘려 SPEC line 66 RHYTHM_CONFIG와 실제 코드 동기화. 클러치(페이즈 2) 700ms는 Phase D에서 ring 큐 도입으로 처리 예정.

**Major 3 — `ringId` 엄격 비교**: `_handleTugWarTap`에서 `if (msg.ringId && msg.ringId !== ring.id) return;` → `if (msg.ringId !== ring.id) return;`. 활성 ring 있을 때 ringId 누락/다름은 모두 무시. ring 없을 때 탭(ringId=null)은 별도 분기에서 처리.

**Minor 1 — 검증 순서 갱신**: SPEC 서버 TUG_TAP 검증 순서 7/8을 `TAP_RESULT 브로드캐스트 → KO 체크`로 변경. 클라가 final ropePos 보정을 먼저 받는 게 자연스럽고 코드 순서와 일치.

**Minor 2 — STATE_SYNC stats 포함**: `_serializeTugWarState()`에 `stats: { [playerId]: PlayerStats }` 추가. HUD/관전자가 진행 중 통계를 볼 수 있게.

**Minor 4 — popup 중복 깜빡임 회피**: 클라 `pendingPredictions: Map<clientSeq, predicted>` 도입. `handleTapResult`에서 동일 판정이면 popup 재시작 생략. ropePos 정정은 항상 적용.

**Minor 3 (RTT 보정) 이연**: 의도적. 손맛 QA에서 가장 먼저 체감될 리스크로 SPEC에 명시.

### v0.7 (Phase C 완료)

**Phase C**: 리듬 링 스폰 루프(50ms tick), 서버 권위 TAP 판정(perfect 120ms / good 280ms / miss), ropePos 업데이트(perfect ±0.040 / good ±0.018 / miss -0.005), KO(`|ropePos|≥1.0`) 즉시 종료, 클라 낙관적 판정 + ropePos 보정. 자동 miss는 ropePos 영향 없이 통계만 기록. ring 시각화는 가이드 원 + 수축 원의 scale transition. 판정 popup 0.6초 키프레임. 줄/캐릭터는 ropePos에 따라 transform translateX 평행 이동.

### v0.6 (Phase B codex 리뷰 반영)

**endReason 타입 확장**: `'timeout' | 'ko'` → `'timeout' | 'ko' | 'abandoned'`. disconnect를 별도 reason으로 명시 (TUG_GAME_END.reason / GameState.endReason 모두).

**countdown/round race guard**: 라운드별 `randomHex(8)` 토큰을 발급하고 setTimeout 핸들러가 토큰 일치 시에만 phase 전환. 이전 라운드의 늦게 도착한 timer가 새 라운드를 조기 종료시키지 못하게 차단.

**30초 만료 타이머 추가**: `_tugWarBeginRound` 직후 `setTimeout(_tugWarRoundTimeout, TUG_DURATION_MS)`. 시간 종료 시 ropePos 부호로 winner 결정 + TUG_GAME_END(`reason: 'timeout'`) 브로드캐스트. Phase B에서는 ropePos가 항상 0이라 자동 무승부.

**클라 finished STATE_SYNC 처리**: `applyStateSync()`의 `finished` 분기에서 `state.winnerId/endReason` 기반 result render — 재접속/관전자도 결과를 본다.

**Critical 이연**: DO hibernation 시 in-memory state(setTimeout 포함) 손실 위험은 Phase C에서 Cloudflare Alarms API + storage 미러링으로 일괄 처리 예정.

### v0.5 (Phase B 완료)

**Phase B**: 캐릭터 선택 동기화, TUG_READY → 3-2-1 카운트다운 → playing 전환, TUG_STATE_SYNC 브로드캐스트, jump-climber 자산을 캐릭터 카드/플레이 화면에 연결, disconnect 시 `abandoned` 종료. 30초 만료 타이머/리듬 링은 Phase C에서 추가.

### v0.4 (Phase 0 정리 + Phase A 스캐폴딩 완료)

**구현 진행 상황 섹션 신설**: Phase별 산출물·커밋·이슈를 SPEC 안에서 추적. 향후 Phase B/C/D/E도 같은 형식으로 누적.

**Phase 0**: 코드베이스 정리(미사용 프로토타입 7개 폴더 삭제, jump-climber 자산을 자체 폴더로 이동, worker/src/room.js 정리). 커밋 `6d91c79`.

**Phase A**: mallang-tug-war 스캐폴딩(3개 신규 파일, registry/worker stub 등록, TUG_READY 송신까지 동작). 검토 중 critical 이슈 1건(`showPlayScreen` DOM 덮어쓰기) 직접 패치. minor 이슈 1건(`send()` 자동 clientSeq) Phase C에서 처리하기로 메모.

### v0.3 (구현 직전 정합성 패치)

**메시지 타입 `TUG_` 프리픽스 통일**: `TAP` → `TUG_TAP`, `ITEM_GRAB` → `TUG_ITEM_GRAB`, `SELECT_CHARACTER` → `TUG_SELECT_CHARACTER`, `STATE_SYNC` → `TUG_STATE_SYNC`, `TAP_RESULT` → `TUG_TAP_RESULT`, `ITEM_RESULT` → `TUG_ITEM_RESULT`, `GAME_END` → `TUG_GAME_END`. 신규 추가: `TUG_JOINED`. 공통 에러는 `error`(소문자)로 jump-climber와 정합. **이유**: worker `webSocketMessage` switch에서 다른 게임 메시지와 충돌 방지.

**캐릭터 ID를 jump-climber와 동일 체계로**: `rabbit/hamster/chick` → `mochi-rabbit/pudding-hamster/peach-chick`. **이유**: jump-climber 자산(이미 `prototypes/jump-climber/assets/`로 이동됨)을 별도 매핑 레이어 없이 재참조 가능. jump-climber에는 `latte-puppy / mint-kitten`도 있지만 줄다리기 MVP는 3종만 지원.

**Item 타입 필드명**: `type` → `itemType`. 메시지의 `type` 필드와 혼동 방지.

### v0.2 (외부 리뷰 1차 반영)

**디자인 철학 추가**: "캐릭터 코미디 + 입력 손맛 + 줄 물리 피드백" 3축 일급 요소 프레이밍 + 기능 검증 질문 3종

**좌우 방향 규칙 확정**: A안 (모든 유저 동일 좌우 화면). P2 자기 식별은 YOU 라벨/진영 하이라이트/시작 말풍선으로 해결.

**얼음별사탕 재설계**: 입력 지연 효과 폐기. "다음 1회 비-Perfect 풀 파워 -25%, Perfect는 영향 없음"으로 변경. 조작감 저하 금지 원칙 명문화.

**ropePos 5단계 상태 버킷 추가**: balanced / pushed / struggling / danger / critical. 캐릭터 모션 자동 전환 트리거.

**줄 시각 상태 레이어 분리**: `RopeVisualState` (tension/wobble/stretch) — 서버 게임 상태와 분리된 클라 전용 시각 값.

**KO 시퀀스 1.5~2초 7단계 분해**: 발끝 버팀 → 마지막 당김 → 짓눌림 → 놓침 → 추락 → 승자 포즈 → 결과 화면.

**필수 사운드 8종 의성어 추가**: 뿌우욱/뽕/톡/삐끗/뿌직/스윽/슈우웅/펑.

**결과 화면 명장면 회상**: `worstRopePos`, `timeInDangerMs`, `longestPerfectStreak`, `comebackFromRopePos`, `finalBlowAt` 통계로 드라마 문구 자동 생성.

**무승부 코믹 연출**: 두 캐릭터 주저앉음 + 띠 늘어짐 + "막상막하! 한 판 더?".

**페이즈 2 클러치는 연출 우선**: 룰 변화는 약하게(링 간격만 단축), 압박감은 시각/청각으로.

**카메라 흔들림 절제 규칙**: 일반 탭 시 흔들림 없음, KO 순간만 강한 흔들림 OK, 리듬 링 표시 중에는 흔들림 금지.

**상대 입력 판정 표시**: 상대 Perfect/Good/Miss를 내 화면에서도 말풍선으로 표시 (납득 가능성).

**아이템 디자인 원칙 명문화**: "방해는 조작을 망치면 안 되고 결과를 살짝 약화. Perfect는 항상 방해를 뚫는다."

### v0.1 (초안)
초기 스펙 작성. 1v1, 30초, 퍼펙트 탭, 아이템 2종, 페이즈 2개, KO + 시간 종료 결판.
