# 말랑프렌즈 팩토리 — 개발 작업 로그

## 목표
2인 로컬 협동 생산 타이쿤 + 단일 버튼 QTE + 도우미 로봇 성장

## 구현 단계

### Phase 1: 폴더 구조 + 레지스트리 등록 + HTML/CSS 뼈대 ✅
- [x] games/registry.js 에 게임 등록 (DUEL_LIVE 타입)
- [x] prototypes/mallang-factory/index.html 생성 (설정/게임/결과 화면)
- [x] prototypes/mallang-factory/style.css 생성 (파스텔 공방 스타일)
- [x] prototypes/mallang-factory/game.js 전체 구현
  - GAME_CONFIG 분리, 에셋 프리로드, 입력 시스템
  - 플레이어 이동 (2인 WASD/방향키)
  - 자재함 → 조립대 → 납품 전체 루프
  - QTE 시스템 (게이지 + Perfect/Good/Normal/Miss 판정)
  - 도우미 로봇 Lv.1→Lv.2 외관 업그레이드
  - 타이머 + 성공/실패 결과 화면
  - Canvas 렌더링 (배경, 스테이션, 캐릭터, 팝업)
- [x] justPressed 버그 수정 (clearJustPressed를 update 이후로 이동)
- [x] 커밋 예정

### Phase 2: 플레이어 이동 + 맵 렌더링
- [ ] Canvas 기반 게임 루프
- [ ] 2명 플레이어 (토끼/햄스터) 이동
- [ ] 공방 맵 (자재함 2개, 조립대, 납품 구역, 도우미 로봇 위치)
- [ ] 캐릭터 에셋 로딩 및 렌더링
- [ ] 커밋

### Phase 3: 아이템 시스템 + 줍기/놓기
- [ ] Item: frame, circuit, minibot
- [ ] Station: resource_bin, assembly_table, delivery_zone, upgrade_panel
- [ ] 플레이어가 자재함에서 부품 집기
- [ ] 조립대에 부품 놓기
- [ ] 커밋

### Phase 4: 조립 + QTE 시스템
- [ ] 조립대에 프레임+회로 올라오면 조립 가능 상태
- [ ] 단일 버튼 QTE (게이지 바 + 타이밍 판정)
- [ ] 판정: Perfect / Good / Normal / Miss
- [ ] 조립 시간 차이 적용
- [ ] 미니봇 완성
- [ ] 커밋

### Phase 5: 납품 + 코인 + 업그레이드
- [ ] 납품 구역에서 미니봇 납품 → 코인 획득
- [ ] 코인 기반 도우미 로봇 Lv.1 → Lv.2 업그레이드
- [ ] 외관 변화 (색상/크기/안테나 추가)
- [ ] 업그레이드 효과: 조립 시간 15% 단축
- [ ] 커밋

### Phase 6: 타이머 + 결과 화면
- [ ] 4분 라운드 타이머
- [ ] 목표 코인 800 달성 시 성공
- [ ] 시간 종료 시 실패 처리
- [ ] 결과 화면: 코인, 납품 수, QTE 통계
- [ ] 커밋

### Phase 7: 폴리쉬 + 시각 피드백
- [ ] 조립대 반짝임 (준비 상태 표시)
- [ ] 업그레이드 이펙트
- [ ] 코인 충분 시 업그레이드 버튼 강조
- [ ] QTE 판정 표시 애니메이션
- [ ] 커밋

## 에셋 정보
- 토끼: `토끼 왼쪽 점프.png`, `토끼 오른쪽 점프.png`, `토끼 점프 위로.png`, `토끼 추락.png`
  - 이동 스프라이트로 왼쪽/오른쪽 점프 이미지 재활용
- 햄스터: `햄스터 왼쪽.png`, `햄스터 오른쪽.png`, `햄스터 점프 위로.png`, `햄스터 추락.png`
  - 왼쪽/오른쪽 이동 스프라이트 별도 존재 (최적)

## 기술 결정
- Canvas 기반 렌더링 (jump-climber와 동일 방식)
- 게임 해상도: 800×500
- 게임 타입: DUEL_LIVE (로컬 2인)
- 바닐라 JS, 빌드 도구 없음

## GAME_CONFIG
```js
const GAME_CONFIG = {
  roundDurationSec: 240,
  targetCoins: 800,
  deliveryReward: { normal: 100, good: 110, perfect: 125, miss: 90 },
  assemblyTimeMs: { base: 3000, perfect: 1800, good: 2400, normal: 3000, miss: 3600 },
  helperRobot: {
    level1: { assemblySpeedBonus: 0 },
    level2: { upgradeCost: 300, assemblySpeedBonus: 0.15 },
  },
  player: {
    baseSpeed: 160,
    rabbitSpeedMultiplier: 1.05,
    hamsterQteWindowMultiplier: 1.05,
  },
};
```

## 현재 진행 상황
- [x] 저장소 구조 파악 완료
- [x] 에셋 파일명 확인 완료
- [ ] Phase 1 시작...
