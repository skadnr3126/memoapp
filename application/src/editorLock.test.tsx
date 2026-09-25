// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import type { FlowCanvas } from "./components/FlowCanvas";
import { createBlock, createFlow, createWorkspace } from "./domain/flow";
import { EDITOR_CLEAR, EDITOR_LOAD, EDITOR_LOCK, EDITOR_LOCKED, EDITOR_READY, EDITOR_SAVE, EDITOR_SAVED, type EditorSession } from "./editorProtocol";

const mocks = vi.hoisted(() => ({
  flush: vi.fn().mockResolvedValue(undefined), save: vi.fn().mockResolvedValue(undefined), choose: vi.fn().mockResolvedValue("D:/other"),
  handlers: new Map<string, (event: { payload: any }) => void>(),
  emit: vi.fn().mockResolvedValue(undefined), open: vi.fn(), focus: vi.fn().mockResolvedValue(undefined),
  canvas: vi.fn<(props: ComponentProps<typeof FlowCanvas>) => null>(() => null),
}));
vi.mock("@tauri-apps/api/event", () => ({ emitTo: mocks.emit, listen: vi.fn(async (name, handler) => { mocks.handlers.set(name, handler); return () => mocks.handlers.delete(name); }) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (command, args) => command === "recent_workspaces" ? ["D:/notes"] : command === "resolve_workspace_root" ? args.workspaceRoot.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase().replace(/^d:/, "D:") : {}) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ WebviewWindow: { getByLabel: vi.fn(async () => ({ setFocus: mocks.focus })) } }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onCloseRequested: async () => () => {} }) }));
vi.mock("./storage/repository", async importOriginal => ({ ...await importOriginal<object>(), isDesktopRuntime: () => true, openNativeWorkspace: mocks.open, chooseNativeWorkspace: mocks.choose, saveNativeWorkspace: mocks.save }));
vi.mock("./flowSummary", async original => ({ ...await original<object>(), flushEditor: mocks.flush }));
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
  mocks.flush.mockReset().mockResolvedValue(undefined); mocks.save.mockReset().mockResolvedValue(undefined); mocks.choose.mockReset().mockResolvedValue("D:/other"); mocks.open.mockReset();
  vi.useFakeTimers(); mocks.handlers.clear(); mocks.emit.mockClear(); mocks.canvas.mockClear(); mocks.focus.mockClear();
  const flow = createFlow(createWorkspace());
  const first = createBlock(flow.workspace, flow.flowId); a = first.blockId;
  const second = createBlock(first.workspace, flow.flowId); b = second.blockId;
  mocks.open.mockResolvedValue({ workspaceRoot: "D:/notes", workspace: second.workspace, nodePositionsByFlow: {} });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<App />));
  await act(async () => (Array.from(host.querySelectorAll("button")).find(b => b.textContent === "D:/notes")!).click());
  await receive(EDITOR_READY);
  await open(a);
  mocks.emit.mockClear();
  // Reload the current session so each test can access its issued ID.
  await receive(EDITOR_READY);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

it("focuses the editor only when the focus action is requested", async () => {
  expect(mocks.focus).not.toHaveBeenCalled();
  await act(async () => canvas().onOpenBlock(a, true));
  expect(mocks.focus).toHaveBeenCalledTimes(1);
  await open(b);
  expect(mocks.focus).toHaveBeenCalledTimes(1);
  await act(async () => canvas().onOpenBlock(b, true));
  expect(mocks.focus).toHaveBeenCalledTimes(2);
});

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

const click = async (selector: string) => {
  await act(async () => host.querySelector<HTMLButtonElement>(selector)!.click());
};
const tabs = () => host.querySelectorAll(".workspace-tab");
const addOther = async () => {
  // Deliberately share all IDs, as with a copied workspace directory.
  mocks.open.mockResolvedValue({ workspaceRoot: "D:/other", workspace: canvas().workspace, nodePositionsByFlow: {} });
  await click(".workspace-add-button");
};

it("keeps tab content, geometry and undo isolated even when block IDs match", async () => {
  await act(async () => canvas().onRenameBlock(a, "A title"));
  await act(async () => canvas().onNodePositionsChange({ [a]: { x: 42, y: 84 } }));
  await addOther();
  expect(tabs()).toHaveLength(2);
  await act(async () => canvas().onRenameBlock(a, "B title"));
  await click('.workspace-tab button[title="D:/notes"]');
  expect(canvas().workspace.blocks.get(a)?.title).toBe("A title");
  expect(canvas().nodePositions[a]).toEqual({ x: 42, y: 84 });
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true })));
  expect(canvas().workspace.blocks.get(a)?.title).toBe("");
  await click('.workspace-tab button[title="D:/other"]');
  expect(canvas().workspace.blocks.get(a)?.title).toBe("B title");
  expect(mocks.open).toHaveBeenCalledTimes(2);
});

it("deduplicates canonical paths and selects the existing tab without replacing either tab", async () => {
  await addOther();
  mocks.choose.mockResolvedValue("D:/NOTES/");
  await click(".workspace-add-button");
  expect(tabs()).toHaveLength(2);
  expect(host.querySelector('[aria-current="page"]')?.getAttribute("title")).toBe("D:/notes");
  await click(".workspace-select-button");
  expect(tabs()).toHaveLength(2);
  expect(mocks.open).toHaveBeenCalledTimes(2);
});

it("flushes editor changes before saving and rejects a late save from the previous workspace", async () => {
  const previous = session();
  mocks.flush.mockImplementationOnce(async () => {
    mocks.handlers.get(EDITOR_SAVE)!({ payload: { ...previous, markdown: "last draft" } });
  });
  await addOther();
  expect(mocks.save.mock.calls.some(([path, workspace]) => path === "D:/notes" && workspace.blocks.get(a)?.markdown === "last draft")).toBe(true);
  await receive(EDITOR_SAVE, { ...previous, markdown: "late draft" });
  expect(last(mocks.emit.mock.calls.filter(call => call[1] === EDITOR_SAVED))[2]).toHaveProperty("error");
  await click('.workspace-tab button[title="D:/notes"]');
  expect(canvas().workspace.blocks.get(a)?.markdown).toBe("last draft");
});

it("preserves the active workspace on flush, disk-save and folder-open failures", async () => {
  mocks.flush.mockRejectedValueOnce(new Error("flush failed"));
  await click(".workspace-add-button");
  expect(tabs()).toHaveLength(1);
  expect(host.textContent).toContain("flush failed");
  mocks.save.mockRejectedValueOnce(new Error("disk full"));
  await click(".workspace-add-button");
  expect(tabs()).toHaveLength(1);
  expect(host.textContent).toContain("disk full");
  mocks.open.mockRejectedValueOnce(new Error("invalid JSON"));
  await click(".workspace-add-button");
  expect(tabs()).toHaveLength(1);
  expect(host.textContent).toContain("invalid JSON");
  expect(canvas().workspace.blocks.has(a)).toBe(true);
  await open(a);
  await receive(EDITOR_SAVE, { ...session(), markdown: "still editable" });
  expect(canvas().workspace.blocks.get(a)?.markdown).toBe("still editable");
});

it("cancels without changing tabs and prevents duplicate folder dialogs", async () => {
  let finish!: (path: undefined) => void;
  mocks.choose.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => {
    host.querySelector<HTMLButtonElement>(".workspace-add-button")!.click();
    host.querySelector<HTMLButtonElement>(".workspace-add-button")!.click();
  });
  expect(mocks.choose).toHaveBeenCalledTimes(1);
  await act(async () => finish(undefined));
  expect(tabs()).toHaveLength(1);
});

it("saves again when the editor changes while the disk write is pending", async () => {
  const previous = session();
  mocks.save.mockImplementationOnce(async () => {
    mocks.handlers.get(EDITOR_SAVE)!({ payload: { ...previous, markdown: "during write" } });
  });
  await addOther();
  const writes = mocks.save.mock.calls.filter(([path]) => path === "D:/notes");
  expect(writes.length).toBeGreaterThanOrEqual(2);
  expect(last(writes)[1].blocks.get(a)?.markdown).toBe("during write");
  await click('.workspace-tab button[title="D:/notes"]');
  expect(canvas().workspace.blocks.get(a)?.markdown).toBe("during write");
});

it("replaces only the selected tab and closes tabs without deleting their data", async () => {
  await addOther();
  mocks.choose.mockResolvedValue("D:/third");
  mocks.open.mockResolvedValue({ workspaceRoot: "D:/third", workspace: canvas().workspace, nodePositionsByFlow: {} });
  await click(".workspace-select-button");
  expect(tabs()).toHaveLength(2);
  expect(host.querySelector('button[title="D:/other"]')).toBeNull();
  await click('.workspace-tab:has(button[title="D:/third"]) .workspace-tab-close');
  expect(tabs()).toHaveLength(1);
  expect(host.querySelector('[aria-current="page"]')?.getAttribute("title")).toBe("D:/notes");
  await click(".workspace-tab-close");
  expect(tabs()).toHaveLength(0);
  expect(host.querySelector(".workspace-picker-button")).not.toBeNull();
});
