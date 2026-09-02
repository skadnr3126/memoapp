# 2차 목표: 로컬 영속 저장과 앱 재시작 복구

## 목표

현재 메모리에서만 동작하는 Flow 편집기를, 사용자가 직접 읽고 백업할 수 있는 로컬 파일 기반 앱으로 전환한다.

이번 단계의 완료 기준은 다음 한 문장이다.

> **Block 내용, Flow의 순서·분기, Canvas 좌표를 저장하고 앱을 다시 열어도 같은 상태를 안전하게 복구할 수 있는가?**

## 현재 상태와 전제

- Block 원본은 `WorkspaceState.blocks: Map<BlockId, Block>`에 한 번만 존재한다.
- Flow는 `Branch.itemIds`와 `childBranchIdsByBlockId`로 Block의 순서와 분기를 관리한다.
- `validateWorkspace`가 Block의 중복 배치·고아 참조·잘못된 Branch 관계를 검사한다.
- 현재 상태와 Canvas 좌표는 React state뿐이며, 새로고침 또는 앱 재시작 시 사라진다.
- 앱은 Tauri 2 + React 기반이다. 파일 읽기·쓰기는 WebView가 아니라 Rust Tauri command에서 수행한다.

이 단계에서 런타임 도메인 모델은 바꾸지 않는다. 저장을 위한 DTO와 직렬화 계층을 별도로 둔다. 특히 `Map`은 JSON으로 직접 저장하지 않는다.

## 결정

### 원본과 파생물

| 구분 | 파일 | 역할 | 이번 단계 |
| --- | --- | --- | --- |
| 원본 | `blocks/YYYY/MM/<blockId>.md` | Block 메타데이터와 Markdown 본문 | 구현 |
| 원본 | `flows/<flowId>.json` | Block ID의 순서와 Branch tree | 구현 |
| 작업공간 상태 | `workspace.json` | schema 버전, 마지막으로 연 Flow | 구현 |
| UI 상태 | `layout.json` | Flow별 Block x/y 좌표 | 구현 |
| 파생물 | `index.json`, `exports/` | 검색·내보내기용 재생성 데이터 | 제외 |
| 복구 보조 | `operations/` | 다중 파일 실패 복구용 marker | 최소 구현 |
| 복구 보조 | `trash/` | Undo/복원용 보관소 | 후속 단계 |
| 관계 확장 | `links.json` | tree 밖의 느슨한 Link | 후속 단계 |

SQLite는 원본 저장소로 사용하지 않는다. 나중에 도입하더라도 검색/성능용으로 재생성 가능한 캐시로만 사용한다.

### 워크스페이스 경로

사용자가 선택한 폴더 아래에 `.memo` 디렉터리를 만든다. 선택 UI 자체는 최소화하되, 저장소 API는 명시적 `workspaceRoot`를 입력으로 받아 테스트 가능하게 만든다.

```text
<workspaceRoot>/
└─ .memo/
   ├─ blocks/
   │  └─ 2026/07/blk_xxx.md
   ├─ flows/
   │  └─ flow_xxx.json
   ├─ workspace.json
   └─ layout.json
```

Block ID와 파일 경로는 분리한다. Block의 생성 시각(UTC)을 기준으로 `blocks/YYYY/MM/`에 저장하고, Flow는 항상 Block ID만 참조한다.

## 저장 포맷

### Block Markdown

Block의 본문은 사람이 읽고 외부 편집기로도 고칠 수 있는 Markdown을 원본으로 둔다.

```md
---
version: 1
id: blk_01J2ABC
title: 선택적 제목
createdAt: 2026-07-21T10:00:00.000Z
updatedAt: 2026-07-21T10:05:00.000Z
---

Markdown 본문
```

- 필수 frontmatter: `version`, `id`, `createdAt`, `updatedAt`
- 선택 frontmatter: `title` — 빈 문자열은 저장하지 않는다.
- frontmatter 아래 전체를 `markdown`으로 복원한다.
- 이 단계에서는 `type`, `tags`, 첨부파일, 내부 링크를 추가하지 않는다.

### Flow JSON

런타임은 편집에 유리한 `Map` 구조를 유지하고, 파일에는 사람이 읽기 쉬운 중첩 tree JSON을 사용한다.

```json
{
  "version": 1,
  "id": "flow_xxx",
  "title": "예시 Flow",
  "root": {
    "id": "root_xxx",
    "items": ["blk_a", "blk_b"],
    "branches": {
      "blk_a": [
        {
          "id": "branch_xxx",
          "title": "갈래 제목",
          "items": ["blk_c"],
          "branches": {}
        }
      ]
    }
  }
}
```

- `items`는 같은 Branch 안의 Block 순서다.
- `branches[blockId]`는 해당 Block에서 시작하는 Branch와 그 순서다.
- 저장 DTO에는 역직렬화 가능한 모든 Branch ID를 포함한다.
- 로드할 때 중첩 tree를 `Flow.branches: Map`과 `childBranchIdsByBlockId: Map`으로 복원한다.
- 저장 전과 로드 후 모두 `validateWorkspace`를 실행한다. 실패한 Flow는 메모리에 반영하지 않고 오류를 보고한다.

### workspace/layout JSON

```json
// workspace.json
{ "version": 1, "activeFlowId": "flow_xxx" }

// layout.json
{
  "version": 1,
  "nodePositionsByFlow": {
    "flow_xxx": { "blk_a": { "x": 120, "y": 80 } }
  }
}
```

- `selectedBlockId`, 편집 패널 열림 여부, 입력 중 draft처럼 일시적인 UI 상태는 저장하지 않는다.
- layout에 존재하지만 현재 Flow tree에 없는 Block 좌표는 로드 시 무시하고, 다음 저장 때 제거한다.

## 변경별 저장 단위와 시점

| 사용자 변경 | dirty 대상 | 저장 시점 |
| --- | --- | --- |
| Block 제목·본문 수정 | 해당 `block.md` | 500–800 ms debounce |
| Flow 이름 변경 | 해당 `flow.json` | 500–800 ms debounce |
| Block 추가·삭제 | Block 파일 + 해당 `flow.json` + 필요 시 layout | 즉시 저장 |
| Block 순서·분기 생성·Branch/Block 이동 | 해당 `flow.json` | 즉시 저장 |
| Canvas 좌표 변경 | `layout.json` | 드래그 종료 뒤 500–800 ms debounce |
| Flow 선택 변경 | `workspace.json` | 짧은 debounce 또는 다음 flush |

UI는 메모리 상태를 먼저 바꾸고 저장 요청을 큐에 넣는다. 저장 중 새 변경이 생기면 같은 대상의 최신 상태만 다시 저장한다. 앱 종료·창 닫기 전에는 모든 dirty 대상을 flush한다.

## 안전성과 오류 처리

### 단일 파일

각 파일은 같은 디렉터리에 임시 파일로 먼저 쓴 뒤 원자적으로 rename한다.

```text
serialize → <target>.tmp 쓰기/flush → rename(<target>.tmp, <target>)
```

임시 파일은 시작 시 감지한다. 유효한 원본이 있으면 임시 파일을 버리고, 원본이 없으면 사용자가 복구를 선택할 수 있도록 오류 상태로 남긴다.

### 여러 파일을 바꾸는 작업

Block 생성·삭제는 Block 원본과 Flow 구조를 함께 바꾸므로, 이번 단계에서는 최소 transaction marker를 구현한다.

```text
1. operations/<operationId>.json에 대상과 단계 기록
2. 새/변경 Block 파일을 atomic write
3. 변경된 Flow 및 layout 파일을 atomic write
4. 메모리 기준으로 다시 검증
5. marker 삭제
```

앱 시작 시 남은 marker는 같은 작업을 멱등적으로 완료하거나, 완료할 수 없으면 원본을 건드리지 않고 복구 오류로 표시한다. 삭제는 이번 단계에서 영구 삭제로 유지하되, marker 복구가 끝난 뒤에만 Block 파일을 제거한다. Trash/Undo는 후속 단계다.

저장 실패 시에는 메모리 편집 내용을 유지하고 상태 바에 `저장 실패`와 재시도 동작을 제공한다. 성공하기 전에는 `저장됨`으로 표시하지 않는다.

## 구현 계획

### 1. 저장 계약과 순수 직렬화

- [x] `application/src/storage/types.ts`에 저장 DTO와 schema version 상수를 정의한다.
- [x] `Block ↔ Markdown frontmatter` serializer/parser를 구현한다.
- [x] `Flow/Branch Map ↔ 중첩 Flow JSON` serializer/parser를 구현한다.
- [x] `WorkspaceState ↔ workspace/layout DTO` 변환을 구현한다.
- [ ] 누락 필드, 알 수 없는 version, 중복 ID, 깨진 참조에 대한 오류 타입을 정의한다.
- [x] round-trip 뒤 Block 데이터·Flow 순서·Branch 순서가 동일하고 `validateWorkspace`가 통과하는 단위 테스트를 작성한다.

완료 기준: 브라우저·파일 시스템 없이 fixture JSON/Markdown만으로 저장 포맷을 검증할 수 있다.

### 2. Tauri 파일 저장소

- [ ] `application/src-tauri/src/storage/`에 Rust repository를 만든다.
- [x] workspace 초기화, 디렉터리 생성, 모든 파일 탐색/읽기, 단일 파일 atomic write command를 구현한다.
- [ ] 단일 파일 write, layout/workspace write, 다중 파일 operation 실행 command를 분리한다.
- [x] 경로는 항상 선택한 workspace의 `.memo` 아래로 정규화하여 path traversal를 거절한다.
- [x] 파일 I/O 오류를 UI가 표시할 수 있는 구조화된 오류로 변환한다.
- [x] Rust 측 임시 파일·중단된 operation marker를 검사하고 복구 오류를 UI에 전달한다.

완료 기준: 임시 workspace에서 생성·저장·읽기·재시작 복구가 Rust 통합 테스트로 검증된다.

### 3. 프런트엔드 repository와 초기 로드

- [x] `application/src/storage/repository.ts`에서 Tauri command를 호출하는 저장소 인터페이스를 만든다.
- [x] 앱 시작 시 workspace 선택/초기화 후 데이터를 load하고, 성공한 상태만 `WorkspaceState`로 설정한다.
- [x] workspace가 비어 있으면 빈 상태를 보여 주고 첫 Flow 생성부터 저장한다.
- [x] 로드·복구·검증 오류를 차단 가능한 오류 화면으로 표시하고 원본 파일 위치를 알려 준다.
- [ ] Tauri가 아닌 웹 개발 모드에서는 명시적인 in-memory adapter를 사용한다. 영속 저장을 흉내 내는 adapter는 만들지 않는다.

완료 기준: 앱 재시작 후 Flow 목록, 활성 Flow, Block 내용, tree 구조가 복원된다.

### 4. Dirty tracking과 autosave

- [ ] 도메인 명령 결과에서 변경된 Block/Flow/layout/workspace 대상을 판별한다.
- [ ] 대상별 debounce와 직렬 저장 큐를 구현한다.
- [ ] 구조 변경은 즉시 persist하고, 본문·좌표는 debounce한다.
- [ ] `저장 중` / `저장됨` / `저장 실패` / `저장 대기` 상태와 재시도 버튼을 추가한다.
- [ ] 앱 종료 전 flush 및 flush 실패 안내를 추가한다.

완료 기준: 빠른 연속 입력에도 마지막 상태가 저장되고, 저장 실패 뒤 재시도로 파일과 메모리가 다시 일치한다.

### 5. 다중 파일 복구와 회귀 검증

- [ ] Block 생성, Branch 생성, 이동, subtree 삭제의 저장 결과를 통합 테스트로 검증한다.
- [ ] operation 단계마다 중단을 주입해 앱 재시작 후의 복구 결과를 검증한다.
- [ ] 손상된 Markdown, Flow JSON, layout JSON, 남은 `.tmp` 파일의 처리 정책을 테스트한다.
- [ ] 기존 `flow.test.ts`의 모든 구조 조작이 저장 후 재로드 뒤에도 같은 결과인지 확인한다.
- [ ] 수동 시나리오로 Flow 작성 → 앱 종료 → 재실행 → 순서/갈래/본문/좌표 확인을 수행한다.

완료 기준: 저장 중 강제 종료를 포함해 원본 파일이 조용히 손상되지 않고, 어떤 오류도 사용자에게 보인다.

## 이번 단계에서 하지 않는 일

- Inbox, Quick Capture, Codex/AI import
- Link/Backlink, Flow 병합·분리, Block의 다중 Flow 배치
- 검색 인덱스, Export, 외부 파일 변경 감지·동기화
- Trash 복원, Undo/Redo (단, transaction marker 기반 실패 복구는 구현)
- Zoom, 접힘, 패널 크기 등 x/y 이외의 layout 저장
- 대규모 Flow 최적화 및 runtime 전체 deep clone 구조 변경

## 최종 완료 조건

- [ ] 사용자가 선택한 폴더에 `.memo` 작업공간을 만들 수 있다.
- [ ] 새 Block과 Flow가 해당 파일 포맷으로 저장된다.
- [ ] 제목·Markdown·Flow 순서·중첩 Branch·Canvas x/y가 앱 재시작 뒤 동일하게 복원된다.
- [ ] 저장 파일은 사람이 읽을 수 있고, `Map`이나 React 내부 상태가 노출되지 않는다.
- [ ] 파일 저장 실패는 데이터 손실 없이 UI에 표시되고 재시도할 수 있다.
- [ ] 생성·삭제처럼 여러 파일을 다루는 작업은 중단 후에도 손상 없이 복구된다.
- [ ] 저장 후 재로드한 workspace가 `validateWorkspace`를 통과한다.

## 후속 단계

영속 저장이 안정화된 뒤, 아래 순서로 확장한다.

1. Inbox와 Quick Capture
2. Trash/Undo 및 Link
3. index/export와 외부 파일 변경 감지
4. Canvas 확장 상태(zoom, viewport, 접힘)와 대규모 성능 최적화
