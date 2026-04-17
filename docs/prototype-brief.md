# Prototype Brief Template

새 게임을 만들기 전에 아래 항목만 빠르게 채웁니다.

## 1. One-line pitch

한 문장으로 무엇이 재미있어야 하는지 적습니다.

예시:
"플레이어가 아슬아슬하게 피하는 순간의 긴장감을 20초 안에 느끼게 한다."

## 2. Core hypothesis

이번 실험에서 검증할 한 가지 가설만 적습니다.

- 플레이어는 이동 정확도보다 추격 압박에서 재미를 느낀다.
- 연속 박자 성공이 점수보다 몰입을 만든다.

## 3. Inputs

입력은 최대한 적게 둡니다.

- `Arrow keys`
- `Space`
- `Mouse drag`

## 4. Fail condition

언제 끝나는지가 명확해야 합니다.

- 3번 맞으면 종료
- 비트를 5번 놓치면 종료
- 30초 생존 시 종료

## 5. Success signal

어떤 반응이 나오면 다음 버전을 만들지 적습니다.

- 한 판 더 하고 싶다
- 패배 이유가 납득된다
- 규칙 설명 없이도 바로 플레이한다

## 6. Prompt skeleton for Codex / Claude

```text
Build a tiny browser game prototype in plain HTML/CSS/JS.

Goal:
- [한 줄 피치]

Hypothesis:
- [검증할 가설]

Constraints:
- Keep it in a single prototype folder
- No dependencies
- Playable in under 30 seconds
- Clear score / fail / restart loop

Inputs:
- [입력]

Please optimize for fast feel-testing, not production quality.
```
