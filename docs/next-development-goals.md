# Next Development Goals

이 문서는 현재 코드베이스에서 다음으로 집중할 개발 목표를 정리한 문서다.
구현 우선순위와 문서 간 연결 지점을 빠르게 파악할 수 있게 유지한다.

## Current Priority

현재 최우선 과제는 `jump-climber`를 단순 솔로 프로토타입에서
"캐릭터 선택 + 커스터마이즈 + 2인 협동/경쟁 플레이"가 가능한
대표 게임으로 끌어올리는 것이다.

상세 계획은 아래 문서를 기준으로 진행한다.

- [jump-climber-expansion-plan.md](./jump-climber-expansion-plan.md)

## Why This Comes First

- 이미 플레이 가능한 점프 프로토타입이 있어 확장 기반이 있다.
- 캐릭터 아트, 입력 체계, 점수 표시, 멀티플레이 룸 흐름을 한 번에 검증할 수 있다.
- 이후 다른 게임에도 재사용할 수 있는 공통 개념을 먼저 만들 수 있다.
  - 캐릭터 선택 UI
  - 모바일 입력 추상화
  - 1P / 2P 기록 표시
  - 듀얼 플레이 상태 관리

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

### Milestone A. Jump Climber Planning and UX Spec

- 요구사항 문서화
- 화면 구성 스케치 수준 정의
- 아트 에셋 요청 스펙 정리

### Milestone B. Character and Avatar Pipeline

- 3종 캐릭터 선택
- 사용자 얼굴 업로드
- 얼굴 프리뷰와 합성 규칙

### Milestone C. Two-Player Gameplay Upgrade

- 1P / 2P 동시 플레이
- 카메라 기준 규칙
- 개별 최고 높이 기록
- 1명 탈락 후 솔로 지속

### Milestone D. Mobile Control Upgrade

- 맵 전체 좌/우 터치 분할
- 기존 하단 버튼 제거 또는 폴백화
- 멀티터치 시나리오 검토

## Documentation Rules For This Phase

- 새 기능 요구사항은 먼저 `docs/`에 기록한다.
- 구현 순서가 바뀌면 계획 문서를 먼저 업데이트한다.
- 에셋 요청이 필요한 기능은 파일명과 스펙을 문서에 함께 남긴다.

## Out Of Scope For This Step

이번 단계에서 바로 포함하지 않는 항목:

- 네트워크 기반 원격 멀티플레이
- 계정 저장 / 클라우드 프로필
- 고급 코스메틱 상점 시스템
- 정식 PWA 설치 흐름 완성
