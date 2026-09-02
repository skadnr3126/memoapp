# 개발 로드맵

현재 구현 기준은 루트의 `plan.md`다. 첫 번째 목표는 저장 기능이나 Canvas가 아니라, 사용자가 Flow의 기본 tree 구조를 자연스럽게 만들고 바꿀 수 있는지 검증하는 것이다.

## 1차: Flow 기본 구조 검증

### 목표

> **Block을 단일 카드 단위로 유지하면서도, Flow의 순서와 Branch 구조를 사용자가 자연스럽게 만들고 바꿀 수 있는가?**

이번 단계의 모델:

```text
Block = 내용 + Flow tree의 유일한 항목
Flow = Block ID의 순서와 Branch 구조
Branch = 특정 Block에서 시작하는 순서 있는 하위 흐름
```

별도의 Node 모델이나 Node ID는 두지 않는다. 활성 Block은 정확히 하나의 Flow tree에 한 번만 존재한다.

이번 단계에 구현한다.

- Flow 생성, 이름 변경, 전환
- 선택적 Block 제목과 Markdown 본문 편집
- root 흐름과 Branch에 Block 추가
- Block 순서 변경과 다른 Branch로의 이동
- Branch 생성과 다른 Block 아래로의 이동
- Block 삭제 시 하위 Branch를 함께 제거
- 도메인 명령 단위 테스트와 Outline 수동 검증

이번 단계에서는 구현하지 않는다.

- 파일 저장·앱 재시작 복구·자동 저장
- Inbox·Quick Capture·AI import
- Link·Flow 병합·Undo/Trash 복원
- Canvas·좌표·대규모 Flow 성능 최적화
- 검색·태그·Export

### 검증 시나리오

```text
A → B → C
    ├─ D → E
    │  └─ F
    └─ G
```

위 구조를 만들고, C 이동, `D → E` Branch 이동, D 삭제 시 D·E·F가 함께 사라지는지를 확인한다. 모든 조작 뒤 tree 불변 조건을 검사한다.

## 2차: 로컬 파일 저장과 복구

1차 구조 검증이 통과한 뒤 영속화를 추가한다.

- `blocks/*.md`에 Block 원본 저장
- `flows/*.json`에 중첩 tree 구조 저장
- YAML frontmatter의 선택적 `title`과 Markdown 본문 복원
- atomic write, autosave, 앱 재시작 복구
- 기본 Trash와 복구 가능한 여러 파일 작업

## 3차: 빠른 캡처와 기본 사용 흐름

- Inbox 특수 Flow
- Quick Capture
- 기본 Undo/Redo와 Trash 복원
- Flow 목록, 최근 Flow, 최소 검색

## 4차: Canvas와 확장 조작

- Canvas View와 Block 위치
- viewport 기반 렌더링과 본문 지연 로드
- Link와 Backlink
- Flow 분리·병합, Drag & Drop, 다중 선택

## 5차: 안정성·AI·확장

- 검색 인덱스, 외부 파일 변경 감지, 마이그레이션
- Codex 등 AI 대화 수집
- Export와 AI 보조 기능
- 음성, 브라우저 캡처, 동기화 등 확장 기능

## 개발 원칙

- Outline에서 구조 조작이 검증된 뒤 Canvas를 만든다.
- 파일 저장은 tree 조작 규칙이 확정된 뒤 추가한다.
- 성능 최적화는 실제 대규모 Flow에서 문제가 확인된 뒤 진행한다.
- AI는 원본을 자동으로 바꾸지 않고, 나중에 제안과 파생물부터 제공한다.
