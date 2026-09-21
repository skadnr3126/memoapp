// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import type { FlowCanvas } from "./components/FlowCanvas";
import { createBlock, createFlow, createWorkspace } from "./domain/flow";
import { EDITOR_CLEAR, EDITOR_LOAD, EDITOR_LOCK, EDITOR_LOCKED, EDITOR_READY, EDITOR_SAVE, EDITOR_SAVED, type EditorSession } from "./editorProtocol";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: any }) => void>(),
  emit: vi.fn().mockResolvedValue(undefined), open: vi.fn(),
  canvas: vi.fn<(props: ComponentProps<typeof FlowCanvas>) => null>(() => null),
}));
vi.mock("@tauri-apps/api/event", () => ({ emitTo: mocks.emit, listen: vi.fn(async (name, handler) => { mocks.handlers.set(name, handler); return () => mocks.handlers.delete(name); }) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (command) => command === "load_ui_preferences" ? { workspaceRoot: "D:/notes" } : undefined) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ WebviewWindow: { getByLabel: vi.fn(async () => ({})) } }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onCloseRequested: async () => () => {} }) }));
vi.mock("./storage/repository", async importOriginal => ({ ...await importOriginal<object>(), isDesktopRuntime: () => true, openNativeWorkspace: mocks.open, chooseNativeWorkspace: vi.fn().mockResolvedValue("D:/other"), saveNativeWorkspace: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./components/FlowCanvas", () => ({ FlowCanvas: mocks.canvas }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, a: string, b: string;
const last = <T,>(items: T[]) => items[items.length - 1];
const canvas = () => last(mocks.canvas.mock.calls)[0];
const loads = () => mocks.emit.mock.calls.filter(call => call[1] === EDITOR_LOAD);
const session = () => last(loads())[2] as EditorSession;
const receive = async (name: string, payload?: unknown) => { await act(async () => mocks.handlers.get(name)!({ payload })); };
const open = async (id: string) => { await act(async () => canvas().onOpenBlock(id)); };
beforeEach(async () => {
  vi.useFakeTimers(); mocks.handlers.clear(); mocks.emit.mockClear(); mocks.canvas.mockClear();
  const flow = createFlow(createWorkspace());
  const first = createBlock(flow.workspace, flow.flowId); a = first.blockId;
  const second = createBlock(first.workspace, flow.flowId); b = second.blockId;
  mocks.open.mockResolvedValue({ workspaceRoot: "D:/notes", workspace: second.workspace, nodePositionsByFlow: {} });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<App />));
  await receive(EDITOR_READY);
  await open(a);
  mocks.emit.mockClear();
  // Reload the current session so each test can access its issued ID.
  await receive(EDITOR_READY);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

it("pins the editor while selection, creation, deletion and saving continue; unlock resumes on the next selection", async () => {
  const pinned = session();
  await receive(EDITOR_LOCK, { sessionId: pinned.sessionId, locked: true });
  expect(mocks.emit).toHaveBeenCalledWith("editor", EDITOR_LOCKED, { sessionId: pinned.sessionId, locked: true });
  await open(b);
  expect(canvas().selectedBlockIds).toEqual([b]);
  expect(loads()).toHaveLength(1);
  await act(async () => canvas().onCreateBlock!({ x: 100, y: 100 }));
  expect(canvas().workspace.blocks.size).toBe(3);
  await act(async () => canvas().onDeleteBlock!(b));
  expect(canvas().workspace.blocks.has(b)).toBe(false);
  expect(mocks.emit.mock.calls.filter(call => call[1] === EDITOR_CLEAR)).toHaveLength(0);
  await receive(EDITOR_SAVE, { ...pinned, markdown: "pinned draft" });
  expect(canvas().workspace.blocks.get(a)?.markdown).toBe("pinned draft");
  expect(last(mocks.emit.mock.calls.filter(call => call[1] === EDITOR_SAVED))[2]).not.toHaveProperty("error");
  await act(async () => canvas().onRenameBlock(a, "새 제목"));
  expect(session()).toMatchObject({ sessionId: pinned.sessionId, title: "새 제목" });
  const count = loads().length;
  await receive(EDITOR_LOCK, { sessionId: pinned.sessionId, locked: false });
  expect(loads()).toHaveLength(count);
  const other = [...canvas().workspace.blocks.keys()].find(id => id !== a)!;
  await open(other);
  expect(session().blockId).toBe(other);
});

it("unlocks and clears when the pinned block is deleted and rejects its late lock request", async () => {
  const pinned = session();
  await receive(EDITOR_LOCK, { sessionId: pinned.sessionId, locked: true });
  await act(async () => canvas().onDeleteBlock!(a));
  expect(mocks.emit).toHaveBeenCalledWith("editor", EDITOR_CLEAR);
  await open(b);
  await receive(EDITOR_LOCK, { sessionId: pinned.sessionId, locked: true });
  expect(mocks.emit).toHaveBeenLastCalledWith("editor", EDITOR_LOCKED, { sessionId: session().sessionId, locked: false });
});

it("resets the lock after closing or reloading the editor window", async () => {
  await receive(EDITOR_LOCK, { sessionId: session().sessionId, locked: true });
  await receive("tauri://destroyed");
  await open(b);
  await receive(EDITOR_READY);
  expect(session().blockId).toBe(b);
  await receive(EDITOR_LOCK, { sessionId: session().sessionId, locked: true });
  await receive(EDITOR_READY);
  await open(a);
  expect(session().blockId).toBe(a);
});

it("clears the pinned session when changing workspaces", async () => {
  const pinned = session();
  await receive(EDITOR_LOCK, { sessionId: pinned.sessionId, locked: true });
  await act(async () => host.querySelector<HTMLButtonElement>(".workspace-switch-button")!.click());
  expect(mocks.emit).toHaveBeenCalledWith("editor", EDITOR_CLEAR);
  await act(async () => host.querySelector<HTMLButtonElement>(".workspace-picker-button")!.click());
  await open(b);
  expect(session().blockId).toBe(b);
  expect(session().workspaceSession).not.toBe(pinned.workspaceSession);
  await receive(EDITOR_LOCK, { sessionId: pinned.sessionId, locked: true });
  await open(a);
  expect(session().blockId).toBe(a);
});
