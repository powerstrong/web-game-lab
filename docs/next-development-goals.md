# Next Development Goals

이 문서는 현재 코드베이스에서 다음으로 집중할 개발 목표를 정리한 문서다.
구현 우선순위와 문서 간 연결 지점을 빠르게 파악할 수 있게 유지한다.

## Current Priority

현재 최우선 과제는 `jump-climber`를
`말랑프렌즈 점프`라는 대표 게임으로 계속 다듬는 것이다.

상세 계획과 현재 상태는 아래 문서를 기준으로 진행한다.

- [jump-climber-expansion-plan.md](./jump-climber-expansion-plan.md)

## Current Snapshot

지금까지 반영된 상태:

- 앱 전체 브랜드를 `말랑프렌즈 아케이드`로 변경
- `말랑프렌즈 점프`에 캐릭터 3종 스프라이트 연결
- 싱글플레이 / 로컬 2P 플레이 가능
- 방 플레이에서는 2개 기기가 같은 맵에 들어가는 shared-map 멀티플레이 프로토타입 동작
- 얼굴 업로드, 얼굴 프리뷰, 얼굴 영역 크기 조절, 사진 확대, 캐릭터 크기 조절 가능
- 설정 화면 / 실제 게임 화면 분리 완료
- 배경 / 발판 / 부스트 / 장식 기물 아트 연결 완료
- 일부 플랫폼의 느린 이동 / 회전 적용

## Why This Still Comes First

- 이미 플레이 가능한 점프 프로토타입이 있어 확장 기반이 있다.
- 캐릭터 아트, 입력 체계, 점수 표시, 멀티플레이 룸 흐름을 한 번에 검증할 수 있다.
- 이후 다른 게임에도 재사용할 수 있는 공통 개념을 먼저 만들 수 있다.
  - 캐릭터 선택 UI
  - 모바일 입력 추상화
  - 1P / 2P 기록 표시
  - 듀얼 플레이 상태 관리
  - shared-map 멀티플레이 기초

## Most Important Next Work

### 1. Multiplayer Smoothness

현재 가장 눈에 띄는 품질 이슈는 멀티플레이에서의 렉과 깜빡임이다.

다음 단계:

- 로컬 플레이어 예측을 더 정교하게 확장
- 원격 플레이어 / 플랫폼 스냅샷 보간 강화
- DOM 재생성 최소화
- 필요 시 스냅샷 버퍼링 지연을 소폭 추가

### 2. Effects and Feel

점프 감각을 더 살릴 필요가 있다.

다음 단계:

- 점프 착지/부스트 이펙트
- 가벼운 효과음
- 부스트 획득 시 시각 피드백 강화

### 3. Art Fit and Visual Tuning

새 에셋은 연결됐지만 아직 시각 튜닝 여지가 있다.

다음 단계:

- 플랫폼별 크기감 / 충돌감 조정
- 배경 대비 캐릭터 가독성 확인
- 얼굴 합성 위치를 캐릭터별로 더 정교하게 보정

### 4. Deployment Cleanup

현재 배포는 정적 사이트와 방 API 워커가 분리되어 있다.

다음 단계:

- `game-lobby.powerstrong.workers.dev` 의존을 줄일지 유지할지 결정
- 가능하면 메인 사이트 origin으로 API 통합 검토
- Cloudflare 배포 흐름 문서화

## Project-Wide Goals

### 1. Canonical Game Metadata

게임 제목, 설명, 진입 경로, 플레이 타입 같은 메타데이터를 한 곳에서 관리해야 한다.

- 루트 목록 페이지
- 로비 UI
- 워커 라우팅
- 게임별 진입 버튼

위 요소가 같은 데이터를 참조하도록 정리한다.

### 2. Faster Prototype-to-Playable Flow

새 프로토타입을 추가하거나 기존 프로토타입을 게임답게 다듬는 비용을 줄인다.

- 게임 폴더 구조는 단순하게 유지
- 공통 HUD / 입력 / 기록 UI는 재사용
- 게임별 로직은 독립적으로 유지

### 3. Shared Input Layer

키보드와 모바일 입력을 게임별로 따로 구현하지 않도록 공통 입력 레이어를 마련한다.

- 키보드 좌우 이동
- 터치 좌/우 분할 입력
- 1P / 2P 독립 입력 소스
- 향후 액션 버튼 확장 가능성 고려

### 4. Multiplayer Contract

실시간 또는 같은 화면 2인 플레이를 지원할 때 필요한 공통 계약을 정리한다.

- 플레이어 슬롯 정의
- 상태 동기화 방식
- 점수 / 최고 기록 표시 형식
- 사망 후 잔여 플레이어 처리 규칙

## Near-Term Milestones

### Milestone A. Multiplayer Smoothing Pass

- 보간 개선
- 로컬 예측 개선
- 깜빡임 원인 축소

### Milestone B. Effects Pass

- 점프 / 착지 / 부스트 이펙트
- 기본 효과음

### Milestone C. Visual Polish Pass

- 플랫폼 / 배경 / 캐릭터 크기 미세 조정
- 얼굴 합성 가이드 보정

### Milestone D. Deployment Stabilization

- 방 API 구조 정리
- 캐시 / 서비스워커 / 배포 체크리스트 정리

## Documentation Rules For This Phase

- 새 기능 요구사항은 먼저 `docs/`에 기록한다.
- 구현 순서가 바뀌면 계획 문서를 먼저 업데이트한다.
- 에셋 요청이 필요한 기능은 파일명과 스펙을 문서에 함께 남긴다.
- 멀티플레이 구조를 바꾸면 room flow와 deployment notes를 함께 갱신한다.

## Out Of Scope For This Step

이번 단계에서 바로 포함하지 않는 항목:

- 계정 저장 / 클라우드 프로필
- 고급 코스메틱 상점 시스템
- 정식 PWA 설치 흐름 완성
- 완전한 네트워크 rollback/resimulation
