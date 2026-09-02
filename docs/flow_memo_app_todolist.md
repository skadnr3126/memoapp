# Flow 기반 메모앱 TODO List

이 문서는 전체 제품 로드맵이다. 현재 구현 순서와 1차 완료 조건은 루트의 `plan.md`를 우선한다.

## 현재 우선순위: 1차 Flow 구조 검증

```text
구현: in-memory Flow, Block/Branch 생성·이동·삭제, tree 검증, Outline
보류: 파일 저장, Inbox, Link, Canvas, AI, 검색, Undo/Trash 복원
```

1차에서는 `Block`, `Flow`, `Branch`, `Workspace`만 최소 모델로 사용한다. 아래의 파일 저장, AI, Canvas 관련 체크리스트는 구조 검증 뒤에 진행한다.

전체 제품은 아래 순서로 확장한다.

핵심 원칙:

```text
철학 확정
→ 데이터 모델 확정
→ Flow 기본 조작 검증
→ 저장과 복구
→ 실제 사용 검증
→ 안정성 강화
→ AI 대화 수집
→ AI 보조
→ 확장 기능
→ 배포
```

---

# 0. 제품 범위 고정

## 0.1 제품 한 문장 정의

- [ ] 앱의 한 문장 정의 작성

> 생각의 원본과 흐름을 낮은 비용으로 보존하고, 사용자가 언제든 그 흐름으로 다시 돌아가 생각을 이어갈 수 있게 하는 로컬 메모앱

## 0.2 핵심 제품 원칙 확정

- [ ] 생각의 주체는 사람으로 정의
- [ ] 앱은 흐름 보존과 조작을 담당
- [ ] AI는 재료 제공자이자 보조자로 제한
- [ ] 원본 기록은 보존
- [ ] 요약과 정리는 파생물로 취급
- [ ] 입력 시 구조를 강제하지 않기
- [ ] `Capture first, structure later`
- [ ] 사용자 파일을 원본 저장소로 사용
- [ ] AI가 원본을 자동 수정하지 않도록 설계
- [ ] Outline과 Canvas는 같은 데이터를 표현하는 View로 정의

## 0.3 MVP 가설 정의

- [ ] 검증할 핵심 가설 작성

> 사용자가 Flow 안에서 생각을 순서대로 기록하고 Branch로 분기·이동·삭제할 수 있는가?

AI 대화까지 포함한 장기 제품 가설은 5차 이후에 검증한다.

## 0.4 MVP 제외 항목 고정

초기에는 제외한다.

- [ ] 클라우드 동기화
- [ ] 협업
- [ ] 모바일 앱
- [ ] 브라우저 확장
- [ ] 음성 인식
- [ ] 이미지 및 자유 스케치
- [ ] 완전 자유 그래프
- [ ] 복잡한 AI 자동 정리
- [ ] 자동으로 원본 Flow를 재구성하는 AI
- [ ] 고급 의미 검색
- [ ] 다중 사용자
- [ ] 플러그인 시스템
- [ ] MCP 연동

---

# 1. 도메인 모델 확정

코드를 작성하기 전에 가장 먼저 끝내야 하는 단계다.

## 1.1 핵심 객체 정의

- [ ] 1차: `Block`
- [ ] 1차: `Flow`
- [ ] 1차: `Branch`
- [ ] 1차: `Workspace`
- [ ] 후속: `Link`
- [ ] 후속: `Inbox`
- [ ] 후속: `Layout`
- [ ] 후속: `Export`
- [ ] 후속: `Trash`
- [ ] 후속: `LogCursor`
- [ ] 후속: `ImportSource`

## 1.2 Block 정의

- [ ] Block을 “이동 가능한 최소 의미 단위”로 정의
- [ ] Block을 Flow tree의 유일한 항목으로 정의하고 별도 `FlowNode` 타입을 두지 않기
- [ ] 문장 단위가 아니라 의미 단위로 정의
- [ ] Block 필드 확정

예시:

```ts
type Block = {
  id: string;
  title?: string;
  markdown: string;
  createdAt: string;
  updatedAt: string;
};
```

- [ ] 제목이 없을 때 Markdown 첫 의미 있는 줄을 표시 제목으로 사용
- [ ] 본문 편집이 명시적 제목을 덮어쓰지 않도록 정의

`type`, `tags`, `source`는 2차 이후 저장·검색·AI 기능과 함께 확장한다.

- [ ] 후속 Block 타입 확정

예시:

```text
thought
question
note
source
ai-turn
capture
```

타입은 최소한으로 유지한다.

## 1.3 Flow 정의

- [ ] 1차 Flow: `id`, `title`, `rootBranchId`, `branches` 확정
- [ ] Branch Map 안에서 주 흐름과 분기를 표현하도록 확정
- [ ] 2차: Flow 생성·수정 시각과 schema version 추가
- [ ] 활성 Block은 Flow tree 전체에서 정확히 한 번만 나타나도록 확정
- [ ] Block 재사용 대신 복제와 Link를 사용하도록 확정
- [ ] Block의 생성·복제·삭제·복원이 Flow 위치와 같은 생명주기를 갖도록 확정

## 1.4 Branch 정의

- [ ] Branch의 `parentBranchId`, `parentBlockId` 확정
- [ ] Branch 내부에 순서 있는 `itemIds` 보유
- [ ] Block별 `childBranchIdsByBlockId`로 하위 Branch 순서 보존
- [ ] Branch title은 선택적 UI 라벨로 제한
- [ ] Branch 자체에 본문 의미를 과도하게 넣지 않기
- [ ] Branch를 새 Flow로 분리하는 규칙 정의
- [ ] Branch를 다른 위치로 이동하는 규칙 정의
- [ ] Branch가 다시 주 흐름으로 합류하는 기능은 MVP에서 제외

## 1.5 Link 정의

- [ ] Flow Tree와 Link 역할 구분
- [ ] Tree는 사고 전개 관계
- [ ] Link는 느슨한 참고·연관 관계
- [ ] Link 타입 최소 정의

예시:

```text
reference
related
opposes
continues
```

- [ ] Link 삭제가 Block이나 Flow를 삭제하지 않도록 정의

## 1.6 Inbox 정의

- [ ] Inbox를 특수 Flow로 구현
- [ ] 빠른 캡처 기본 위치를 Inbox로 확정
- [ ] Inbox Block을 Flow로 이동하는 규칙 정의

결정:

```text
Inbox = 빠른 캡처를 담는 특수 Flow
```

## 1.7 AI Turn Block 정의

- [ ] 사용자 질문과 AI 답변을 하나의 Block으로 묶을지 결정
- [ ] MVP에서는 하나의 `ai-turn` Block으로 정의
- [ ] 원문 질문 저장
- [ ] 원문 답변 저장
- [ ] source session ID 저장
- [ ] source message ID 저장
- [ ] source file path 또는 source reference 저장
- [ ] 답변 접힘 상태는 Layout에 저장

## 1.8 삭제·복제·재사용 정책

- [ ] 완전 삭제 = Trash 이동
- [ ] Trash 복원 규칙 정의
- [ ] 복제 시 새 Block ID 생성
- [ ] Link 삭제와 Block 삭제 분리
- [ ] Flow 삭제 시 내부 Block 처리 결정
- [ ] 결정: Flow 삭제 시 내부 Block도 함께 Trash로 이동
- [ ] 활성 고아 Block을 허용하지 않기

## 1.9 불변 조건 작성

반드시 코드와 문서로 남긴다.

- [ ] 모든 Block ID는 유일
- [ ] 모든 Flow ID는 유일
- [ ] 모든 활성 Block은 정확히 하나의 Flow tree 위치를 가짐
- [ ] Flow가 참조하는 Block은 존재해야 함
- [ ] 전체 활성 Flow tree에서 동일 Block ID 중복 금지
- [ ] Branch ID는 Flow 안에서 유일
- [ ] Tree에 순환 구조 금지
- [ ] Link는 없는 Block을 참조할 수 없음
- [ ] Layout은 없는 Flow나 Block을 참조하지 않도록 정리 가능
- [ ] Export와 Index는 언제든 재생성 가능

---

# 2. 파일 및 저장 모델 설계

## 2.1 원본과 파생 데이터 구분

- [ ] `blocks/*.md` = Block 본문과 메타데이터 원본
- [ ] `flows/*.json` = 같은 Block의 tree 위치를 담는 원본 구조
- [ ] `links.json` 또는 Flow 내부 links = 원본 관계
- [ ] `exports/*` = 파생물
- [ ] `index.json` 또는 SQLite = 캐시
- [ ] `layout.json` = UI 상태
- [ ] `operations/*` = 복구와 Undo 보조 기록
- [ ] `sources/*` = 외부 로그 import 상태
- [ ] `trash/*` = 삭제 보관소

## 2.2 디렉토리 구조 확정

```text
.memo/
├─ blocks/
│  └─ 2026/
│     └─ 07/
├─ flows/
│  ├─ flow_inbox.json
├─ exports/
│  ├─ human/
│  └─ ai/
├─ operations/
├─ sources/
├─ trash/
│  ├─ blocks/
│  └─ flows/
├─ index.json
├─ layout.json
├─ links.json
├─ schema.json
└─ workspace.json
```

- [ ] 한 폴더에 너무 많은 Block이 쌓이지 않도록 분산 규칙 확정
- [ ] Block ID와 경로 분리
- [ ] `index`가 ID → path 매핑 담당
- [ ] Workspace 버전 정보 저장
- [ ] 파일 schema version 저장

## 2.3 Block Markdown 형식 확정

- [ ] YAML frontmatter 스키마 확정
- [ ] Markdown 본문 구조 확정
- [ ] 내부 링크 문법 확정
- [ ] 첨부파일 참조 규칙 확정
- [ ] 사용자가 외부 편집기로 수정해도 읽을 수 있도록 단순하게 유지

예시:

```md
---
id: blk_01J...
type: thought
title: 파일 기반 저장 구조
created: 2026-07-14T10:00:00+09:00
updated: 2026-07-14T10:10:00+09:00
tags: [storage, memo]
---

DB 없이 파일 기반으로 메모 앱을 만들고 싶다.
```

## 2.4 Flow JSON 스키마 확정

- [ ] 중첩 Tree 방식으로 시작할지 결정
- [ ] MVP에서는 중첩 Tree 사용
- [ ] 복잡도가 커지면 정규화된 구조로 마이그레이션 가능하도록 version 포함
- [ ] `items`
- [ ] `branches`
- [ ] `links`
- [ ] created/updated
- [ ] version

## 2.5 저장 방식 설계

- [ ] 파일 로드
- [ ] 메모리 Canonical State 생성
- [ ] 사용자 조작은 메모리 State에 먼저 반영
- [ ] Dirty Tracking
- [ ] Debounce Autosave
- [ ] Atomic Write
- [ ] 임시 파일에 작성 후 rename
- [ ] 앱 종료 전 Dirty flush
- [ ] 실패한 임시 파일 복구 규칙
- [ ] 저장 오류 UI 설계

## 2.6 여러 파일 작업 규칙

Flow 분리처럼 여러 파일이 변경되는 작업을 정의한다.

- [ ] 새 Flow 파일 생성
- [ ] 기존 Flow 수정
- [ ] Block 생성·삭제에 대응하는 Block 파일 생성·Trash 이동
- [ ] Layout 수정
- [ ] Index 수정
- [ ] Export 재생성

저장 순서:

```text
1. 새 원본 파일 생성
2. 기존 원본 파일 수정
3. 참조 무결성 확인
4. Layout과 Index 갱신
5. Export 재생성
```

- [ ] 실패 시 재실행 가능한 작업으로 설계
- [ ] 최소 transaction marker 구현 여부 결정

---

# 3. 프로젝트 기반 구축

## 3.1 기술 스택 확정

- [ ] Tauri
- [ ] React 또는 Svelte 선택
- [ ] Rust Backend
- [ ] 상태 관리 라이브러리 선택
- [ ] Markdown parser 선택
- [ ] JSON schema validation 도구 선택
- [ ] 파일 watcher용 `notify`
- [ ] ID 생성 라이브러리 선택
- [ ] 테스트 프레임워크 선택

## 3.2 프로젝트 디렉토리 구성

- [ ] `domain`
- [ ] `storage`
- [ ] `commands`
- [ ] `importers`
- [ ] `exporters`
- [ ] `ui`
- [ ] `state`
- [ ] `validation`
- [ ] `tests`

예시:

```text
src/
├─ domain/
├─ state/
├─ ui/
├─ features/
└─ commands/

src-tauri/src/
├─ storage/
├─ importer/
├─ exporter/
├─ validation/
└─ commands/
```

## 3.3 Domain과 UI 분리

- [ ] Flow 조작 로직이 React 컴포넌트에 들어가지 않도록 분리
- [ ] UI 없이도 Block 생성과 Flow 이동을 테스트할 수 있도록 설계
- [ ] 저장 포맷과 화면 컴포넌트 분리
- [ ] Importer와 Domain Model 분리
- [ ] Exporter와 원본 모델 분리

---

# 4. 순수 도메인 기능 구현

UI보다 먼저 테스트 가능한 함수로 만든다.

## 4.1 Block 명령

- [ ] `createBlock`
- [ ] `editBlock`
- [ ] `renameBlock`
- [ ] `duplicateBlock`
- [ ] `trashBlock`
- [ ] `restoreBlock`
- [ ] `addTag`
- [ ] `removeTag`

## 4.2 Flow 명령

- [ ] `createFlow`
- [ ] `renameFlow`
- [ ] `deleteFlow`
- [ ] `addBlockToFlow`
- [ ] `insertBlockAfter`
- [ ] `insertBlockBefore`
- [ ] `moveBlock`
- [ ] `reorderBlock`
- [ ] `createBranch`
- [ ] `moveBranch`
- [ ] `splitBranchToFlow`
- [ ] `mergeFlow`
- [ ] `collapseBranch`
- [ ] `expandBranch`

## 4.3 Link 명령

- [ ] `createLink`
- [ ] `deleteLink`
- [ ] `getBacklinks`
- [ ] `getOutgoingLinks`

## 4.4 Inbox 명령

- [ ] `captureToInbox`
- [ ] `moveInboxBlockToFlow`
- [ ] `returnBlockToInbox`

## 4.5 검증 함수

- [ ] Flow가 참조하는 존재하지 않는 Block 검사
- [ ] 전체 Flow tree의 중복 Block 검사
- [ ] 순환 구조 검사
- [ ] 중복 ID 검사
- [ ] Flow tree에 없는 활성 Block 검사
- [ ] 깨진 Link 검사
- [ ] Layout 고아 참조 검사

## 4.6 Domain 단위 테스트

- [ ] Block 생성 테스트
- [ ] Flow 삽입 테스트
- [ ] Branch 생성 테스트
- [ ] Block 이동 테스트
- [ ] Branch 분리 테스트
- [ ] Flow 병합 테스트
- [ ] Trash와 복원 테스트
- [ ] 순환 방지 테스트
- [ ] 중복 방지 테스트

---

# 5. 최소 저장·복구 기능 구현

## 5.1 Workspace 생성

- [ ] 저장 위치 선택
- [ ] `.memo` 생성
- [ ] 기본 디렉토리 생성
- [ ] `workspace.json` 생성
- [ ] schema version 기록

## 5.2 Block 저장

- [ ] Markdown 직렬화
- [ ] Markdown 파싱
- [ ] Frontmatter 파싱
- [ ] Atomic Write
- [ ] 수정된 Block만 저장
- [ ] 경로 분산

## 5.3 Flow 저장

- [ ] JSON 직렬화
- [ ] JSON 파싱
- [ ] Schema Validation
- [ ] Atomic Write
- [ ] 수정된 Flow만 저장

## 5.4 Workspace 로딩

- [ ] Block 파일 검색
- [ ] Flow 파일 검색 및 모든 활성 Block의 단일 위치 확인
- [ ] ID → path 인덱스 생성
- [ ] 모든 참조 연결
- [ ] Layout 로드
- [ ] Link 로드
- [ ] 깨진 파일 오류 처리
- [ ] 부분 로드 실패 대응

## 5.5 Autosave

- [ ] 글자 입력 Debounce
- [ ] 구조 변경 즉시 또는 짧은 Debounce
- [ ] 저장 상태 표시
- [ ] 저장 실패 표시
- [ ] 재시도
- [ ] 종료 전 Flush

## 5.6 완료 조건

- [ ] 앱 종료 후 다시 열어도 모든 Block 복구
- [ ] Flow 순서와 Branch 복구
- [ ] Inbox 상태 복구
- [ ] Link 복구
- [ ] Layout 복구
- [ ] 저장 중 앱 강제 종료 테스트 통과

---

# 6. 기본 UI 구현

## 6.1 App Shell

- [ ] Home
- [ ] Inbox
- [ ] Flow 목록
- [ ] Flow 상세
- [ ] AI Conversations
- [ ] Settings
- [ ] Trash

## 6.2 Home

- [ ] Quick Capture
- [ ] Recent Flows
- [ ] Inbox 최근 항목
- [ ] Recently Updated
- [ ] AI Conversation 최근 세션
- [ ] 마지막으로 열었던 Flow 재진입

## 6.3 Inbox UI

- [ ] Block 목록
- [ ] 즉시 편집
- [ ] Flow로 이동
- [ ] 새 Flow로 변환
- [ ] Link 생성
- [ ] Trash
- [ ] 다중 선택은 후순위 가능

## 6.4 Flow Outline View

MVP의 중심 화면이다.

- [ ] 주 흐름 표시
- [ ] Branch 들여쓰기 표시
- [ ] 접기·펼치기
- [ ] Block 편집
- [ ] Block 추가
- [ ] Branch 추가
- [ ] 순서 이동
- [ ] Drag & Drop 또는 키보드 이동
- [ ] 현재 선택 Block 표시
- [ ] 마지막 위치 복원
- [ ] 긴 Block 접기

## 6.5 Block Editor

- [ ] Markdown 입력
- [ ] 자동 저장
- [ ] 키보드 이동
- [ ] 제목 선택 입력
- [ ] 링크 입력
- [ ] 입력 도중 Flow 구조 조작 가능
- [ ] 입력과 이동 충돌 방지
- [ ] IME 한글 입력 테스트

## 6.6 Flow 목록

- [ ] 제목
- [ ] 최근 수정
- [ ] Block 개수
- [ ] 검색
- [ ] 생성
- [ ] 이름 변경
- [ ] Trash 이동

---

# 7. 키보드 중심 조작 구현

## 7.1 전역 단축키

- [ ] Quick Capture 열기
- [ ] 앱이 백그라운드여도 동작
- [ ] 입력창 즉시 포커스
- [ ] Enter 저장
- [ ] Escape 닫기
- [ ] Inbox 저장
- [ ] 최근 Flow 선택 옵션은 후순위 가능

## 7.2 Flow 단축키

- [ ] `Enter` 다음 Block 생성
- [ ] `Tab` Branch 생성
- [ ] `Shift+Tab` 상위 구조로 이동
- [ ] 방향키 Block 탐색
- [ ] `Ctrl/Cmd + 방향키` 순서 이동
- [ ] `Ctrl/Cmd + Enter` 저장 또는 편집 종료
- [ ] `Delete` Block과 subtree를 Trash로 이동
- [ ] Link 생성 단축키
- [ ] Branch 분리 단축키
- [ ] Undo/Redo 단축키

## 7.3 키보드 UX 검증

- [ ] 마우스 없이 새 생각 캡처
- [ ] 마우스 없이 Flow 생성
- [ ] 마우스 없이 Block 10개 연결
- [ ] 마우스 없이 Branch 생성
- [ ] 마우스 없이 Block 이동
- [ ] 마우스 없이 Flow 재진입

---

# 8. Undo/Redo와 안전한 삭제

## 8.1 Operation 모델

- [ ] Operation 타입 정의

```text
createBlock
editBlock
moveBlock
createBranch
splitBranch
mergeFlow
trashBlock
restoreBlock
createLink
deleteLink
```

- [ ] 각 Operation의 역연산 정의
- [ ] 메모리 내 Undo Stack
- [ ] Redo Stack
- [ ] 새 Operation 실행 시 Redo 초기화

## 8.2 Trash

- [ ] Block Trash 이동
- [ ] Flow Trash 이동
- [ ] 복원
- [ ] 영구 삭제
- [ ] Trash 정리
- [ ] Flow 삭제 시 내부 Block을 함께 Trash로 이동

## 8.3 실패 복구

- [ ] 저장 실패 시 메모리 상태 유지
- [ ] 저장 재시도
- [ ] 부분 성공 감지
- [ ] 임시 파일 감지
- [ ] 앱 재시작 시 복구 안내

---

# 9. Export 구현

## 9.1 기본 Markdown Export

- [ ] Flow 순서대로 Block 펼치기
- [ ] Branch heading 생성
- [ ] Block ID 표시 옵션
- [ ] AI Turn 질문과 답변 포함
- [ ] Link 정보 포함 옵션
- [ ] 특정 Branch만 Export
- [ ] 전체 Flow Export

## 9.2 Human Export

- [ ] 읽기 좋은 제목 구조
- [ ] 접힌 내용 제외 여부 설정
- [ ] 출처 정보 최소화
- [ ] Markdown 문서 생성

## 9.3 AI Export

- [ ] Block ID 포함
- [ ] 구조 관계 명시
- [ ] 원문 최대한 보존
- [ ] 질문과 답변 구분
- [ ] Source metadata 포함
- [ ] Token 절약 모드
- [ ] 특정 범위 선택 Export

## 9.4 Export 원칙

- [ ] 자동 생성 경고 삽입
- [ ] 읽기 전용 취급
- [ ] 원본 변경 시 재생성
- [ ] Export 삭제 후 복원 가능

---

# 10. 실제 사용 검증 1차

AI 기능을 넣기 전에 반드시 한다.

## 10.1 직접 사용

- [ ] 실제 프로젝트 생각 기록
- [ ] 학습 중 질문 기록
- [ ] 앱 설계 Flow 기록
- [ ] 최소 1~2주 사용
- [ ] 하루 10개 이상 Capture 테스트
- [ ] 긴 Flow 생성 테스트
- [ ] Branch가 많은 Flow 테스트

## 10.2 측정

- [ ] 생각 기록에 걸리는 시간
- [ ] 저장 위치를 고민한 횟수
- [ ] 기록하지 않고 넘긴 생각 수
- [ ] 과거 Flow 재진입 시간
- [ ] 마지막 생각 위치 찾는 시간
- [ ] Block 이동·수정에 걸리는 시간
- [ ] 구조가 오히려 방해된 순간
- [ ] Inbox가 쌓였을 때 부담 정도

## 10.3 설계 수정

- [ ] Block 크기 기준 재검토
- [ ] Enter 동작 재검토
- [ ] Inbox 정책 재검토
- [ ] Branch 생성 UX 재검토
- [ ] Outline 정보 밀도 조절
- [ ] 불필요한 Metadata 제거
- [ ] 자주 쓰지 않는 기능 후순위 이동

---

# 11. 검색·인덱스·캐시 구현

## 11.1 Index

- [ ] Block ID → path
- [ ] 제목
- [ ] 태그
- [ ] 수정 시각
- [ ] 현재 Flow와 tree 위치
- [ ] Backlink
- [ ] Source 정보

## 11.2 검색

- [ ] 제목 검색
- [ ] 본문 검색
- [ ] 태그 검색
- [ ] Flow 검색
- [ ] 최근 수정 검색
- [ ] AI 대화 검색

## 11.3 캐시

- [ ] 앱 시작 속도 측정
- [ ] `index.json`으로 충분한지 검증
- [ ] 필요할 경우 SQLite FTS 도입
- [ ] SQLite는 재생성 가능한 캐시로 제한
- [ ] 캐시 손상 시 파일에서 재생성

## 11.4 Lazy Loading

데이터가 많아졌을 때 진행한다.

- [ ] Flow 목록만 먼저 로드
- [ ] Block 본문 지연 로드
- [ ] 긴 AI 답변 지연 렌더링
- [ ] 가상 스크롤
- [ ] 대규모 Inbox 최적화

---

# 12. 무결성 검사와 마이그레이션

## 12.1 Workspace 검사

- [ ] 중복 Block ID
- [ ] 중복 Flow ID
- [ ] 존재하지 않는 Block 참조
- [ ] 깨진 Link
- [ ] Tree 순환
- [ ] 전체 Flow tree의 중복 Block
- [ ] 고아 Layout
- [ ] 고아 Export
- [ ] Flow tree에 없는 활성 Block
- [ ] 잘못된 Frontmatter
- [ ] 손상된 JSON

## 12.2 Repair 기능

- [ ] Index 재생성
- [ ] Export 재생성
- [ ] 고아 Layout 제거
- [ ] 존재하지 않는 Link 제거 제안
- [ ] 유효하지 않은 위치의 Block을 Inbox로 복구 제안
- [ ] 손상 파일 백업 후 복구

## 12.3 Schema Version

- [ ] Block schema version
- [ ] Flow schema version
- [ ] Workspace schema version
- [ ] `FlowNode`/`blockId` 기반 구 schema를 Block ID tree item schema로 마이그레이션
- [ ] 구 Node ID 기반 Layout key를 Block ID로 마이그레이션
- [ ] Migration 함수
- [ ] Migration 전 백업
- [ ] 이전 버전 테스트 파일 유지

---

# 13. 외부 파일 수정 대응

## 13.1 Workspace Watcher

- [ ] `blocks`
- [ ] `flows`
- [ ] `links`
- [ ] `layout`

## 13.2 충돌 정책

- [ ] 앱 메모리가 수정되지 않았으면 자동 재로드
- [ ] 앱 내부에도 Dirty 변경이 있으면 충돌 표시
- [ ] 파일 버전 사용
- [ ] 사용자에게 내 변경·외부 변경 선택 제공
- [ ] MVP에서는 단순 재로드 확인 방식으로 시작

---

# 14. Codex 로그 Import 구현

## 14.1 Source Adapter 구조

- [ ] Codex 전용 Parser가 Domain에 직접 의존하지 않도록 분리
- [ ] 공통 `ImportEvent` 정의
- [ ] Source ID 정의
- [ ] Session ID 정의
- [ ] Message ID 정의
- [ ] Source Adapter 인터페이스 정의

## 14.2 Log Folder 연결

- [ ] 사용자가 경로 선택
- [ ] 기본 Codex 경로 제안
- [ ] 접근 권한 검사
- [ ] 연결 On/Off
- [ ] 감시 일시정지
- [ ] 특정 세션 무시

## 14.3 Watcher

- [ ] 신규 JSONL 파일 감지
- [ ] 기존 파일 append 감지
- [ ] 파일 삭제 감지
- [ ] 중복 이벤트 처리
- [ ] 짧은 시간 연속 변경 Debounce

## 14.4 Cursor

- [ ] 파일별 Offset 저장
- [ ] 마지막 Message ID 저장
- [ ] 파일 truncate 감지
- [ ] 파일 교체 감지
- [ ] 앱 재시작 후 이어 읽기
- [ ] Cursor 손상 시 재스캔

## 14.5 Parser

- [ ] JSONL line 파싱
- [ ] User Message 추출
- [ ] Assistant Final Answer 추출
- [ ] Tool output 보존
- [ ] Commentary 보존 여부
- [ ] 잘못된 line 건너뛰기
- [ ] 포맷 변경 감지
- [ ] Parser Version 관리

## 14.6 Turn 생성

- [ ] User + Assistant 쌍 구성
- [ ] 중복 Import 방지
- [ ] AI Turn Block 제목 생성
- [ ] 원문 보존
- [ ] Session Flow 생성
- [ ] 기존 Session Flow에 append
- [ ] 미완성 Assistant 응답 처리
- [ ] 세션 종료 감지

## 14.7 AI Conversation View

- [ ] 세로 Outline
- [ ] 질문 제목 표시
- [ ] 답변 접기·펼치기
- [ ] 원문 보기
- [ ] Source 위치 표시
- [ ] Turn을 일반 Block이나 Flow로 복사
- [ ] 대화 중 특정 Branch를 새 Flow로 분리

---

# 15. 실제 사용 검증 2차

## 15.1 AI 대화 흐름 검증

- [ ] Codex를 실제로 사용하면서 자동 수집
- [ ] 세션당 Turn 수가 많을 때 테스트
- [ ] 주제가 바뀌는 긴 세션 테스트
- [ ] 질문을 다시 찾는 시간 측정
- [ ] 일반 채팅 스크롤과 Flow View 비교
- [ ] 원문 접기 UX 검증
- [ ] 자동 수집 오류 확인

## 15.2 핵심 가설 검증

- [ ] AI 대화 재진입 비용이 감소했는가
- [ ] 질문 흐름이 더 잘 보이는가
- [ ] 수동 정리 없이도 가치가 있는가
- [ ] 사용자가 대화 중 생각에 더 집중할 수 있는가
- [ ] 기록이 많아져도 부담이 증가하지 않는가

---

# 16. AI 보조 기능 구현

원본을 변경하지 않는 기능부터 시작한다.

## 16.1 제목 제안

- [ ] Block 제목 제안
- [ ] Flow 제목 제안
- [ ] Turn 제목 제안
- [ ] 사용자 승인 후 적용

## 16.2 요약

- [ ] 특정 Block 요약
- [ ] 특정 Branch 요약
- [ ] Flow 전체 요약
- [ ] 최근 변경 요약
- [ ] 요약은 Export 또는 별도 파생 Block으로 저장
- [ ] 원본 대체 금지

## 16.3 연결 추천

- [ ] 관련 Block 검색
- [ ] 관련 Flow 추천
- [ ] Inbox Block의 배치 후보 추천
- [ ] Link 생성 제안
- [ ] AI 추천과 사용자 확정 Link 구분

## 16.4 사고 재진입 보조

- [ ] “마지막으로 어디까지 생각했는가” 요약
- [ ] 미해결 질문 추출
- [ ] 이어갈 수 있는 Branch 제안
- [ ] 반론 제안
- [ ] 확인이 필요한 가정 제안
- [ ] 사용자가 선택한 경우에만 새 Block 생성

## 16.5 AI Context 조립

- [ ] 현재 Block
- [ ] 부모 흐름
- [ ] 이전·다음 Block
- [ ] 선택된 Branch
- [ ] 관련 Link
- [ ] Token 예산에 맞춘 Context 생성
- [ ] 어떤 Context를 보냈는지 사용자에게 표시

## 16.6 AI 안전 원칙

- [ ] AI가 원본을 무단 변경하지 않음
- [ ] AI 결과는 제안 또는 파생물
- [ ] 자동 적용 기능은 기본 Off
- [ ] AI가 생성한 내용 표시
- [ ] 원본과 AI 생성물 구분
- [ ] 재생성 가능하도록 Prompt와 Source 기록 여부 검토

---

# 17. Canvas View 구현

Outline이 충분히 검증된 뒤 진행한다.

## 17.1 기본 Canvas

- [ ] Block 위치
- [ ] 확대·축소
- [ ] Pan
- [ ] 선택
- [ ] 다중 선택
- [ ] Branch 시각화
- [ ] Link 시각화
- [ ] 접기·펼치기
- [ ] 자동 배치

## 17.2 Outline과 동기화

- [ ] 같은 `Flow` 도메인 모델 사용
- [ ] Canvas 이동이 순서를 바꾸는지 구분
- [ ] 공간 위치와 논리 순서 분리
- [ ] Outline 수정 즉시 Canvas 반영
- [ ] Canvas 수정 즉시 Outline 반영

## 17.3 Layout 저장

- [ ] x/y
- [ ] zoom
- [ ] viewport
- [ ] collapsed
- [ ] 패널 크기
- [ ] 너무 임시적인 선택 상태는 저장하지 않기

---

# 18. 추가 캡처 경로

핵심 앱이 완성된 뒤 추가한다.

## 18.1 음성 캡처

- [ ] 녹음
- [ ] STT
- [ ] 임시 Transcript
- [ ] Inbox 저장
- [ ] 원본 오디오 보존 여부
- [ ] 사용자 확인 후 Flow 배치

## 18.2 브라우저 캡처

- [ ] URL
- [ ] 선택 텍스트
- [ ] 페이지 제목
- [ ] 출처
- [ ] Inbox 저장
- [ ] 브라우저 확장

## 18.3 클립보드 캡처

- [ ] 텍스트
- [ ] 이미지
- [ ] URL
- [ ] 출처 Metadata

## 18.4 파일 및 이미지

- [ ] 첨부파일 디렉토리
- [ ] 상대 경로
- [ ] 미리보기
- [ ] 파일 이동 시 참조 유지
- [ ] 삭제 정책

---

# 19. Resurfacing과 Reflection

강제 작성 구조가 아니라 앱 동작으로 구현한다.

## 19.1 Resurfacing

- [ ] 오래 열지 않은 Flow
- [ ] 미해결 질문
- [ ] 최근 주제와 관련된 과거 Block
- [ ] Inbox의 오래된 Block
- [ ] 반복해서 등장한 주제
- [ ] 사용자가 숨김 처리 가능
- [ ] 추천 이유 표시

## 19.2 Reflection

- [ ] 주간 최근 생각 보기
- [ ] 최근 생성한 질문 보기
- [ ] 최근 수정된 Flow 보기
- [ ] 사용자가 선택한 경우에만 회고 Block 생성
- [ ] 자동 질문은 제안 형태로 제공
- [ ] 사용자가 쓰지 않아도 불이익이 없도록 설계

---

# 20. 접근성·성능·품질 개선

## 20.1 성능

- [ ] 1천 Block 테스트
- [ ] 1만 Block 테스트
- [ ] 10만 Block 저장 구조 시뮬레이션
- [ ] 긴 Flow 렌더링
- [ ] 긴 AI 답변 렌더링
- [ ] 앱 시작 시간
- [ ] 검색 시간
- [ ] Autosave 부담
- [ ] File watcher 부담

## 20.2 접근성

- [ ] 키보드 전용 사용
- [ ] Screen Reader 고려
- [ ] Focus 표시
- [ ] 색상 대비
- [ ] 글자 크기
- [ ] 단축키 충돌 설정
- [ ] 한글 IME
- [ ] Windows 환경 테스트

## 20.3 오류 처리

- [ ] 저장 실패
- [ ] 디스크 공간 부족
- [ ] 권한 오류
- [ ] 파일 손상
- [ ] JSONL 파싱 실패
- [ ] 외부 파일 충돌
- [ ] AI API 실패
- [ ] 네트워크 없는 상태
- [ ] Workspace 경로 이동

## 20.4 백업

- [ ] Workspace 수동 백업
- [ ] Zip Export
- [ ] 자동 백업 선택 기능
- [ ] 복원
- [ ] 마이그레이션 전 백업

---

# 21. 테스트 체계

## 21.1 단위 테스트

- [ ] Domain Commands
- [ ] Tree Operations
- [ ] Serialization
- [ ] Parser
- [ ] Importer
- [ ] Validation
- [ ] Exporter

## 21.2 통합 테스트

- [ ] Block 생성 후 저장·재로드
- [ ] Flow 이동 후 저장·재로드
- [ ] Branch 분리
- [ ] 여러 파일 저장 실패
- [ ] Trash 복원
- [ ] Codex Append Import
- [ ] Cursor 복구
- [ ] Index 재생성
- [ ] Schema Migration

## 21.3 E2E 테스트

- [ ] Quick Capture
- [ ] Inbox → Flow 이동
- [ ] Flow 작성
- [ ] Branch 생성
- [ ] 앱 재시작
- [ ] Codex 세션 자동 수집
- [ ] Export 생성
- [ ] AI 제목 제안
- [ ] Trash 복원

## 21.4 수동 파괴 테스트

- [ ] 저장 중 강제 종료
- [ ] 파일 직접 삭제
- [ ] Flow JSON 직접 손상
- [ ] 중복 ID 생성
- [ ] 로그 파일 truncate
- [ ] Workspace 폴더 이동
- [ ] 동시에 외부 편집
- [ ] 디스크 쓰기 권한 제거

---

# 22. 설정 화면

- [ ] Workspace 경로
- [ ] 전역 단축키
- [ ] Autosave 시간
- [ ] 테마
- [ ] 글자 크기
- [ ] Codex 로그 경로
- [ ] 자동 수집 On/Off
- [ ] AI 기능 On/Off
- [ ] AI Provider 설정
- [ ] Export 경로
- [ ] 백업
- [ ] 무결성 검사 실행
- [ ] Index 재생성
- [ ] 로그 보기

---

# 23. 배포 준비

## 23.1 앱 패키징

- [ ] Windows 빌드
- [ ] 설치 프로그램
- [ ] 앱 아이콘
- [ ] 자동 시작 옵션
- [ ] 시스템 Tray
- [ ] Quick Capture 백그라운드 동작
- [ ] 업데이트 방식 결정

## 23.2 데이터 안정성

- [ ] 새 버전 설치 후 기존 Workspace 유지
- [ ] 앱 제거 시 사용자 데이터 보존
- [ ] Workspace 백업 안내
- [ ] Schema migration 테스트
- [ ] Downgrade 대응 여부

## 23.3 문서

- [ ] 앱 철학
- [ ] Quick Start
- [ ] 단축키
- [ ] 저장 파일 구조
- [ ] 백업 방법
- [ ] 외부 편집 주의사항
- [ ] Codex 연결 방법
- [ ] 문제 복구 방법

---

# 24. 출시 후 검증

## 24.1 사용자 관찰

- [ ] 사용자가 Quick Capture를 실제로 쓰는가
- [ ] Inbox에서 Flow로 이동하는가
- [ ] Flow를 다시 열어 이어 쓰는가
- [ ] Branch 기능을 이해하는가
- [ ] AI Conversation Flow를 다시 보는가
- [ ] Export를 사용하는가
- [ ] 구조가 생각을 방해하는가
- [ ] 데이터 손실 불안이 있는가

## 24.2 핵심 지표

전통적인 체류 시간보다 다음을 본다.

- [ ] 생각 발생 후 기록까지 걸리는 시간
- [ ] 하루 Capture 수
- [ ] Capture 후 Flow로 연결되는 비율
- [ ] 과거 Flow 재방문 비율
- [ ] 재진입 후 새 Block이 추가되는 비율
- [ ] AI 대화 Flow 재방문 비율
- [ ] Inbox 장기 방치율
- [ ] 저장·충돌 오류율
- [ ] 사용자가 원본 Export를 수행한 비율

## 24.3 제품 판단

- [ ] 기록 비용이 실제로 감소했는가
- [ ] 사고 재진입이 빨라졌는가
- [ ] 생각의 연결을 더 잘 볼 수 있는가
- [ ] AI 대화가 단순 보관물이 아니라 재사용되는가
- [ ] 앱이 생각을 대신하지 않고 생각을 돕는가

---

# 권장 개발 마일스톤

## Milestone 1 — 모델 검증

```text
Block
Flow
Branch
Link
Inbox
도메인 명령
단위 테스트
```

완료 기준:

> UI 없이도 테스트 코드로 Flow를 만들고 이동·분기·분리할 수 있다.

## Milestone 2 — 데이터 보존

```text
Markdown Block
JSON Flow
Workspace Load
Autosave
Atomic Write
Trash
```

완료 기준:

> 앱을 강제 종료하고 다시 실행해도 구조가 복구된다.

## Milestone 3 — 사용할 수 있는 최소 앱

```text
Home
Inbox
Flow Outline
Block Editor
Quick Capture
키보드 조작
Undo/Redo
```

완료 기준:

> 실제 생각을 다른 메모앱 없이 이 앱에 기록할 수 있다.

## Milestone 4 — 핵심 가설 검증

```text
직접 1~2주 사용
캡처 비용 측정
재진입 비용 측정
구조 UX 수정
```

완료 기준:

> 이 앱이 기존 메모보다 어떤 점에서 나은지 실제 사용으로 설명할 수 있다.

## Milestone 5 — 안정적인 로컬 앱

```text
Index
검색
무결성 검사
외부 수정 감지
Operation 복구
Schema Migration
Export
```

완료 기준:

> 많은 기록을 장기간 보관해도 데이터 손실 위험이 낮다.

## Milestone 6 — AI 대화 Flow

```text
Codex Watcher
Cursor
Parser
AI Turn Block
AI Conversation View
```

완료 기준:

> Codex 대화가 자동으로 수집되고 나중에 질문 흐름을 다시 볼 수 있다.

## Milestone 7 — AI 사고 보조

```text
제목 제안
관련 Block 추천
Branch 요약
재진입 요약
질문 제안
AI Context Export
```

완료 기준:

> AI가 원본을 대신 정리하지 않으면서 사용자의 사고 재진입과 연결을 돕는다.

## Milestone 8 — 확장 및 출시

```text
Canvas
음성
Resurfacing
성능
접근성
배포
문서화
```

완료 기준:

> 다른 사용자도 설치하고 안전하게 사용할 수 있다.

---

# 지금 당장 시작할 순서

```text
1. Block/Flow/Branch/Link TypeScript 또는 Rust 타입 작성
2. 불변 조건 문서화
3. 순수 도메인 명령 구현
4. 도메인 단위 테스트
5. Markdown/JSON 저장 구현
6. Workspace Load와 Autosave 구현
7. Outline View 구현
8. Quick Capture와 Inbox 구현
9. 키보드 Flow 조작 구현
10. 직접 사용하면서 구조 수정
11. 검색·복구·Export
12. Codex Import
13. AI 보조
14. Canvas와 확장 기능
15. 배포
```

가장 중요한 것은 처음부터 모든 기능을 만드는 것이 아니라, 각 마일스톤마다 실제 사용 가능한 상태를 만드는 것이다.

특히 Milestone 3 이후에는 이 앱의 개발 자체를 이 앱으로 기록한다. 그 과정에서 불편한 부분이 다음 개발 우선순위가 된다.
