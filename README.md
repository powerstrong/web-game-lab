# Web Game Lab

짧은 주기로 여러 웹게임 프로토타입을 만들고, 빠르게 가능성을 판단하기 위한 실험 저장소입니다.

핵심 원칙:

- 하나의 프로토타입은 하나의 폴더에서 독립적으로 돌아가야 합니다.
- 완성도보다 실험 속도를 우선합니다.
- 재미 포인트 하나만 검증하는 작은 게임을 선호합니다.
- 마음에 들지 않으면 과감히 버리고 다음 실험으로 넘어갑니다.

## 구조

```text
.
|-- index.html
|-- styles/
|   `-- lab.css
|-- docs/
|   |-- prototype-brief.md
|   `-- experiment-log.md
`-- prototypes/
    |-- dodge-square/
    |   |-- index.html
    |   |-- style.css
    |   `-- game.js
    |-- rhythm-tap/
    |   |-- index.html
    |   |-- style.css
    |   `-- game.js
    `-- _template/
        |-- index.html
        |-- style.css
        `-- game.js
```

## 사용 방식

1. `docs/prototype-brief.md` 템플릿으로 이번 실험의 가설을 3분 안에 적습니다.
2. `prototypes/_template`를 복사해서 새 게임 폴더를 만듭니다.
3. Codex 또는 Claude에게 한 번에 많은 기능을 시키지 말고, 한 루프에 한 가지 재미만 구현하게 합니다.
4. 플레이 후 `docs/experiment-log.md`에 살아남길 이유가 있는지 바로 기록합니다.

## 추천 프로토타입 단위

- 5분 안에 룰이 설명되는가
- 30초 안에 재미 포인트가 드러나는가
- 입력 방식이 하나의 감정만 검증하는가
- 후속 확장 아이디어가 2개 이상 자연스럽게 떠오르는가

## 현재 샘플

- `dodge-square`: 피하기 기반 반사신경 게임
- `rhythm-tap`: 리듬/타이밍 감각 검증용 게임

## 다음 실험 후보

- one-button climber
- drag-to-aim survival
- deckbuilder combat sketch
- physics slapstick toy
- asynchronous idle loop
