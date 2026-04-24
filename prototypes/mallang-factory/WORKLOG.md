# 말랑프렌즈 팩토리 — 개발 작업 로그 (리메이크)

## 방향 전환 (2026-04-24)
키보드 로컬 2인 → **모바일 우선 온라인 2인 협동 탭 게임**으로 리메이크

## 아키텍처
- DO(Durable Object) = authoritative game state
- 클라이언트 → DO: 액션 메시지만 전송
- DO → 클라이언트: STATE_SYNC broadcast
- 서버 사이드 조립 타이머

## 구현 단계

### Phase A: Worker (room.js) 팩토리 게임 상태기계 추가
- [x] GAME_PATHS에 mallang-factory 추가
- [x] FACTORY 상수 (PARTS, RECIPES, CONFIG)
- [x] factoryGame 상태 구조
- [x] 메시지 핸들러 (ASSIGN_ORDER_TO_WORKBENCH, ADD_PART, HELP_ASSEMBLY, DELIVER, etc.)
- [x] _tickFactoryGame (서버 조립 진행)
- [x] STATE_SYNC broadcast
- [x] 커밋

### Phase B: 클라이언트 game.js 리메이크
- [x] WebSocket 연결 (GameBoot 통합)
- [x] STATE_SYNC 수신 → 화면 렌더링
- [x] 주문 카드 탭 → SELECT_ORDER
- [x] 작업대 탭 → ASSIGN_ORDER_TO_WORKBENCH
- [x] 자재 버튼 탭 → ADD_PART
- [x] Help 버튼 → HELP_ASSEMBLY
- [x] 납품 버튼 → DELIVER
- [x] 상대방 의도 표시 (선택 중인 주문/작업대/자재)
- [x] 결과 화면
- [x] 커밋

### Phase C: index.html + style.css 모바일 UI
- [x] 모바일 우선 레이아웃
- [x] 주문 카드 2개 UI
- [x] 작업대 2개 UI (체크리스트, 진행바, Help/납품 버튼)
- [x] 자재 버튼 4개
- [x] 플레이어 색상 구분
- [x] 커밋

## 프로토콜

### Client → DO
- JOIN_ROOM, SET_READY
- SELECT_ORDER (orderId)
- ASSIGN_ORDER_TO_WORKBENCH (orderId, workbenchId)
- ADD_PART (workbenchId, partId)
- CLEAR_WORKBENCH (workbenchId)
- HELP_ASSEMBLY (workbenchId)
- DELIVER (workbenchId)

### DO → Client
- STATE_SYNC (state)
- ERROR (message)
- EVENT (event, payload)

## 현재 진행 상황
- [x] 아키텍처 설계 완료
- [ ] Phase A 시작...
