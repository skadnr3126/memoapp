# 1차 목표: Flow 기본 구조 검증

## 목표

사용자가 Flow를 만들고, 생각(Block)을 순서대로 추가·이동·분기·삭제할 수 있는지 검증한다.

이번 단계에서 확인할 것은 UI의 완성도나 대규모 데이터 처리 성능이 아니라 다음 한 가지다.

> **Block을 단일 카드 단위로 유지하면서도, Flow의 순서와 Branch 구조를 사용자가 자연스럽게 만들고 바꿀 수 있는가?**

## 이번 단계의 결정

- `Block`은 내용과 Flow tree의 항목을 함께 나타낸다. 별도 `Node` 모델이나 Node ID는 만들지 않는다.
- Flow의 기본 구조는 tree다. 느슨한 연결(Link)과 자유 그래프는 이번 단계에 구현하지 않는다.
- Flow는 root branch 하나에서 시작하고, 각 Block 아래에 여러 Branch를 만들 수 있다.
- 메모리에서는 조작하기 쉬운 `Branch Map + Block ID 배열` 구조를 사용한다.
- 첫 구현은 앱을 닫으면 데이터가 사라지는 in-memory prototype으로 만든다. 파일 저장, 캐시, 대규모 Flow 최적화는 다음 단계에서 다룬다.
- 화면은 Canvas가 아니라 Outline으로 먼저 검증한다. Canvas는 같은 도메인 모델을 재사용하는 후속 기능이다.

## 범위

### 포함

- Flow 생성, 이름 변경, 전환
- root 흐름에 Block 추가
- 선택적 Block 제목과 Markdown 본문 편집
- 현재 Block 다음에 Block 추가
- 특정 Block에서 Branch 생성
- Branch 안에 Block 추가
- 같은 Branch 안에서 Block 순서 변경
- Block을 다른 Branch 또는 root 흐름으로 이동
- Branch 전체를 다른 Block 아래로 이동
- Block 삭제 시 해당 Block의 하위 Branch를 함께 삭제
- 도메인 명령 단위 테스트
- Outline 화면에서 구조를 직접 조작하는 수동 검증

### 제외

- Markdown 파일, Flow JSON, 자동 저장, 앱 재시작 복구
- Inbox, Quick Capture, AI/Codex import
- Link, Backlink, 자유 그래프, Flow 병합
- Canvas UI, 좌표, 확대/축소, 가상화
- Undo/Redo, Trash 복원, 다중 선택, Drag & Drop
- 검색, 태그, 첨부파일, Export
- 대규모 Flow 메모리·렌더링 최적화

## 최소 도메인 모델

```ts
type Block = {
  id: BlockId;
  title?: string;
  markdown: string;
  createdAt: string;
  updatedAt: string;
};

type Branch = {
  id: BranchId;
  title?: string;
  parentBranchId?: BranchId;
  parentBlockId?: BlockId;
  itemIds: BlockId[];
  childBranchIdsByBlockId: Map<BlockId, BranchId[]>;
};

type Flow = {
  id: FlowId;
  title: string;
  rootBranchId: BranchId;
  branches: Map<BranchId, Branch>;
};

type WorkspaceState = {
  blocks: Map<BlockId, Block>;
  flows: Map<FlowId, Flow>;
  activeFlowId?: FlowId;
  selectedBlockId?: BlockId;
};
```

불변 조건:

- Block ID와 Flow ID는 각각 유일하다.
- 활성 Block은 하나의 Flow tree 안에 정확히 한 번만 나타난다.
- root가 아닌 Branch는 하나의 부모 Block과 부모 Branch를 가진다.
- `childBranchIdsByBlockId`의 Block은 해당 Branch의 `itemIds`에 존재한다.
- tree에는 순환이 없다.
- Block 삭제는 해당 Block과 하위 Branch 전체를 한 작업으로 제거한다.

제목 표시 규칙:

- `title`은 사용자가 선택적으로 입력하는 명시적 제목이다.
- `title`이 없으면 `markdown`의 첫 의미 있는 줄을 화면용 제목으로 사용한다.
- 제목과 본문이 모두 비어 있으면 `제목 없음`을 표시한다.
- 본문에서 만든 화면용 제목은 파생값이며 Block 데이터에 자동 저장하지 않는다.

## 구현 순서

### 1. 도메인 모델과 검증 함수

- [x] ID 생성 함수와 최소 타입 정의
- [x] `createFlow`
- [x] `createBlockAfter`
- [x] `createBranch`
- [x] `moveBlock`
- [x] `moveBranch`
- [x] `deleteBlockSubtree`
- [x] `validateFlow`
- [x] Block 위치를 찾는 `locationByBlockId` 파생 인덱스

완료 기준: UI 없이 테스트 코드로 Flow와 Branch를 만들고 구조를 검사할 수 있다.

### 2. 도메인 단위 테스트

- [x] 빈 Flow 생성 시 root branch가 생성된다.
- [x] root에 Block을 순서대로 추가할 수 있다.
- [x] Block 아래에 여러 Branch를 만들 수 있다.
- [x] Branch 안에 Block을 순서대로 추가할 수 있다.
- [x] 중첩 Branch를 만들 수 있다.
- [x] 명시적 제목이 없을 때 Markdown 첫 줄을 표시 제목으로 사용한다.
- [x] 본문 편집이 명시적 제목을 덮어쓰지 않는다.
- [x] Block 이동 뒤에도 중복 또는 고아 Block이 없다.
- [x] Branch 이동 뒤에도 부모 정보와 순서가 맞다.
- [x] Block 삭제 시 해당 Block의 모든 하위 Branch가 함께 제거된다.
- [x] 잘못된 Block ID, 자기 자신 아래로의 Branch 이동, 순환 시도를 거절한다.

완료 기준: 핵심 명령과 불변 조건이 자동 테스트로 보호된다.

### 3. 최소 Outline UI

- [x] Flow 목록과 `새 Flow` 버튼
- [x] 현재 Flow 제목 표시와 이름 변경
- [x] root부터 재귀적으로 렌더링하는 `BranchView`
- [x] Block 카드: 선택적 제목 입력, Markdown 본문 편집, 선택 상태
- [x] 제목이 없을 때 본문 첫 줄을 표시 제목으로 렌더링
- [x] `Enter`: 현재 Block 다음에 새 Block 추가
- [x] `Tab`: 현재 Block에서 새 Branch 생성
- [x] 버튼으로 이전/다음 위치 이동
- [x] 버튼으로 Branch를 다른 Block 아래로 이동
- [x] 삭제 확인 UI
- [x] 선택된 Block의 위치와 하위 Branch를 눈에 보이게 표시

완료 기준: 마우스와 키보드의 최소 조작으로 Flow tree를 만들고 수정할 수 있다.

### 4. 수동 시나리오 검증

다음 구조를 실제 UI에서 만들고 수정한다.

```text
A → B → C
    ├─ D → E
    │  └─ F
    └─ G
```

- [ ] 새 Flow를 만들고 제목을 입력한다.
- [ ] root에 A, B, C를 순서대로 추가한다.
- [ ] B 아래에 `D → E` Branch와 `G` Branch를 만든다.
- [ ] D 아래에 F Branch를 만든다.
- [ ] C를 A와 B 사이로 이동한다.
- [ ] `D → E` Branch를 C 아래로 옮긴다.
- [ ] D를 삭제하고 D, E, F가 함께 사라지는지 확인한다.
- [ ] 별도의 두 번째 Flow를 만들고 첫 번째 Flow와 구조가 섞이지 않는지 확인한다.
- [ ] 각 조작 후 `validateFlow`가 통과하는지 확인한다.

완료 기준: 위 시나리오를 오류 없이 반복할 수 있고, 사용자가 구조 변화의 결과를 즉시 이해할 수 있다.

## 1차 목표 완료 조건

다음 질문에 모두 “예”라고 답할 수 있으면 완료다.

- 빈 Flow에서 생각을 빠르게 이어 쓸 수 있는가?
- 특정 생각에서 여러 갈래의 사고를 만들 수 있는가?
- Block과 Branch를 옮겼을 때 구조가 예상대로 바뀌는가?
- Block을 삭제했을 때 하위 구조 처리 결과가 명확한가?
- 여러 Flow가 서로의 Block이나 Branch를 침범하지 않는가?
- 모든 조작 후 tree 불변 조건을 자동으로 검증할 수 있는가?

## 다음 단계

1차 목표가 통과한 뒤에만 파일 저장과 복구를 추가한다.

```text
2차: Flow JSON + Block Markdown 저장, autosave, 앱 재시작 복구
    - YAML frontmatter의 선택적 title과 frontmatter 아래 Markdown 본문을 각각 복원
3차: Inbox, Quick Capture, 기본 Undo/Trash
4차: Canvas와 viewport 기반 렌더링
5차: Link, 검색, AI import 및 보조 기능
```

관련 설계 문서:

- `docs/구현.md`
- `docs/분류/설계.md`
- `docs/flow_memo_app_todolist.md`
