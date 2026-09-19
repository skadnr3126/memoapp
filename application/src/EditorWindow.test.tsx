// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { EditorWindow } from "./EditorWindow";
import { EDITOR_LOAD, EDITOR_SAVE, EDITOR_SAVED, EDITOR_FLUSH, EDITOR_FLUSHED } from "./editorProtocol";
import type { Editor } from "@tiptap/core";

const mocks = vi.hoisted(() => ({ handlers: new Map<string, (event: { payload: any }) => void>(), emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ emitTo: mocks.emit, listen: vi.fn(async (name, handler) => { mocks.handlers.set(name, handler); return () => mocks.handlers.delete(name); }) }));
vi.mock("./storage/repository", () => ({ isDesktopRuntime: () => true }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const load = (id: string, markdown = "") => act(() => mocks.handlers.get(EDITOR_LOAD)!({ payload: { sessionId: id, workspaceSession: "workspace", blockId: id, title: "", markdown, updatedAt: "" } }));
const documentEditor = () => (host.querySelector(".scription-document") as HTMLElement & { editor: Editor }).editor;
const clickButton = (text: string) => act(() => { [...host.querySelectorAll("button")].find(button => button.textContent === text)!.click(); });
const edit = (value: string) => {
  act(() => {
  if (!host.querySelector("textarea")) {
    [...host.querySelectorAll("button")].find(button => button.textContent === "마크다운 원문")!.click();
  }
  });
  act(() => {
  const field = host.querySelector("textarea")!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const saves = () => mocks.emit.mock.calls.filter(call => call[1] === EDITOR_SAVE);
const flushed = () => mocks.emit.mock.calls.filter(call => call[1] === EDITOR_FLUSHED);
beforeEach(async () => {
  vi.useFakeTimers(); mocks.handlers.clear(); mocks.emit.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<EditorWindow />)); load("a");
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
it("confirms summary flush only after the newest pending draft is acknowledged", async () => {
  edit("first");
  await act(async () => vi.advanceTimersByTime(1000));
  edit("last draft");
  act(() => mocks.handlers.get(EDITOR_FLUSH)!({ payload: { requestId: "summary" } }));
  expect(flushed()).toHaveLength(0);
  act(() => mocks.handlers.get(EDITOR_SAVED)!({ payload: { request: saves()[0][2] } }));
  expect(saves()[1][2].markdown).toBe("last draft");
  expect(flushed()).toHaveLength(0);
  act(() => mocks.handlers.get(EDITOR_SAVED)!({ payload: { request: saves()[1][2] } }));
  expect(flushed()[0][2]).toEqual({ requestId: "summary" });
});
it("reports a rejected editor save to the summary caller", () => {
  edit("unsaved");
  act(() => mocks.handlers.get(EDITOR_FLUSH)!({ payload: { requestId: "summary" } }));
  act(() => mocks.handlers.get(EDITOR_SAVED)!({ payload: { request: saves()[0][2], error: "failed" } }));
  expect(flushed()[0][2]).toEqual({ requestId: "summary", error: "failed" });
});
it("saves changed content periodically and keeps typing made while a save is pending", async () => {
  expect(host.querySelector("input")).toBeNull();
  edit("first"); await act(async () => vi.advanceTimersByTime(1000));
  expect(saves()).toHaveLength(1); const request = saves()[0][2];
  expect(request).not.toHaveProperty("title");
  edit("second");
  act(() => mocks.handlers.get(EDITOR_SAVED)!({ payload: { request } }));
  expect(host.querySelector("textarea")!.value).toBe("second");
  await act(async () => vi.advanceTimersByTime(1000));
  expect(saves()[1][2].markdown).toBe("second");
  act(() => mocks.handlers.get(EDITOR_SAVED)!({ payload: { request: saves()[1][2] } }));
  await act(async () => vi.advanceTimersByTime(3000)); expect(saves()).toHaveLength(2);
});
it("flushes the previous node before loading another without letting its acknowledgement replace the new content", () => {
  edit("draft a"); load("b");
  expect(saves()[0][2]).toMatchObject({ blockId: "a", markdown: "draft a" });
  edit("draft b");
  act(() => mocks.handlers.get(EDITOR_SAVED)!({ payload: { request: saves()[0][2] } }));
  expect(host.querySelector("textarea")!.value).toBe("draft b");
});
it("retries rejected saves and still supports the save button", async () => {
  edit("retry");
  act(() => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  act(() => mocks.handlers.get(EDITOR_SAVED)!({ payload: { request: saves()[0][2], error: "failed" } }));
  expect(host.textContent).toContain("저장 실패");
  await act(async () => vi.advanceTimersByTime(1000)); expect(saves()).toHaveLength(2);
});

it("renders markdown as an editable document without saving or normalizing it on mode switches", async () => {
  const original = "## 제목\n\n**강조**와 *기울임*\n\n- 첫 항목\n- 다음 항목\n\n- [x] 완료\n\n> 인용\n\n```js\nconst n = 1;\n```\n\n[링크](https://example.com)\n\n---\n";
  load("rich", original);
  expect(host.querySelector("h2")?.textContent).toBe("제목");
  expect(host.querySelector("strong")?.textContent).toBe("강조");
  expect(host.querySelector("em")?.textContent).toBe("기울임");
  expect(host.querySelector('input[type="checkbox"]')).not.toBeNull();
  expect(host.querySelector("blockquote")?.textContent).toContain("인용");
  expect(host.querySelector("pre")?.textContent).toContain("const n = 1;");
  expect(host.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
  clickButton("마크다운 원문");
  expect(host.querySelector("textarea")!.value).toBe(original);
  clickButton("문서 보기");
  await act(async () => vi.advanceTimersByTime(1000));
  expect(saves()).toHaveLength(0);
});

it("saves rich edits as markdown and isolates undo history when switching blocks", async () => {
  load("rich", "## 제목\n\n본문");
  act(() => { documentEditor().commands.insertContentAt(1, "새 "); });
  await act(async () => vi.advanceTimersByTime(1000));
  expect(saves()[0][2].markdown).toContain("## 새 제목");
  expect(saves()[0][2]).not.toHaveProperty("title");
  load("other", "다른 문서");
  act(() => { documentEditor().commands.undo(); });
  expect(host.querySelector(".scription-document")!.textContent).toBe("다른 문서");
});

it("preserves unsupported markdown in source mode without executing HTML", async () => {
  const original = '![사진](photo.png)\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>alert(1)</script>';
  load("unsupported", original);
  expect(host.querySelector("textarea")!.value).toBe(original);
  expect(host.querySelector("script")).toBeNull();
  expect([...host.querySelectorAll("button")].find(button => button.textContent === "문서 보기")!.disabled).toBe(true);
  await act(async () => vi.advanceTimersByTime(1000));
  expect(saves()).toHaveLength(0);
});

it("applies typed markdown input rules and retains Korean text through editing", async () => {
  const editor = documentEditor();
  act(() => {
    editor.commands.insertContent("##");
    const { from, to } = editor.state.selection;
    editor.view.someProp("handleTextInput", handler => handler(editor.view, from, to, " ", () => editor.state.tr.insertText(" ")));
    editor.commands.insertContent("한글 제목");
  });
  expect(host.querySelector("h2")?.textContent).toBe("한글 제목");
  await act(async () => vi.advanceTimersByTime(1000));
  expect(saves()[0][2].markdown).toBe("## 한글 제목");
});

it("loads source edits into document mode and continues saving rich edits", async () => {
  edit("## 원문에서 작성\n\n**중요**");
  clickButton("문서 보기");
  expect(host.querySelector("h2")?.textContent).toBe("원문에서 작성");
  expect(host.querySelector("strong")?.textContent).toBe("중요");
  act(() => { documentEditor().commands.insertContentAt(1, "수정 "); });
  clickButton("마크다운 원문");
  expect(host.querySelector("textarea")!.value).toContain("## 수정 원문에서 작성");
  await act(async () => vi.advanceTimersByTime(1000));
  expect(saves()[0][2].markdown).toContain("**중요**");
});

it("updates the block hint without replacing unsaved content or the editor", async () => {
  const editor = documentEditor();
  act(() => { editor.commands.insertContent("작성 중인 내용"); });
  act(() => mocks.handlers.get(EDITOR_LOAD)!({ payload: {
    sessionId: "a", workspaceSession: "workspace", blockId: "a",
    title: "이 글은 제목입니다", markdown: "이전 내용", updatedAt: "",
  } }));
  expect(host.querySelector(".scription-block-hint")?.textContent).toBe("이 글은...");
  expect(host.querySelector(".scription-block-hint")?.getAttribute("title")).toBe("이 글은 제목입니다");
  expect(documentEditor()).toBe(editor);
  expect(editor.getText()).toBe("작성 중인 내용");
  await act(async () => vi.advanceTimersByTime(1000));
  expect(saves()[0][2].markdown).toBe("작성 중인 내용");
});

it("pastes markdown into formatted content and continues and exits a list with Enter", () => {
  const editor = documentEditor();
  act(() => {
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: (type: string) => type === "text/plain" ? "- 항목" : "", files: [] } });
    editor.view.dom.dispatchEvent(paste);
  });
  expect(host.querySelector("li")?.textContent).toBe("항목");
  const enter = () => act(() => {
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  enter();
  expect(host.querySelectorAll("li")).toHaveLength(2);
  enter();
  expect(host.querySelectorAll("li")).toHaveLength(1);
  expect(editor.isActive("bulletList")).toBe(false);
});
