// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import App from "./App";
import { createWorkspace } from "./domain/flow";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), created: vi.fn(), editorAvailable: false, close: undefined as undefined | ((event: { preventDefault: () => void }) => Promise<void>), destroy: vi.fn().mockResolvedValue(undefined), destroyEditor: vi.fn().mockResolvedValue(undefined), flushed: undefined as undefined | ((event: { payload: { requestId: string } }) => void) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async (_label: string, name: string, payload: { requestId?: string }) => { if (name === "editor:flush") mocks.flushed?.({ payload: { requestId: payload.requestId! } }); }), listen: vi.fn(async (name: string, handler: typeof mocks.flushed) => { if (name === "editor:flushed") mocks.flushed = handler; return () => {}; }) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ WebviewWindow: class {
  constructor() { mocks.created(); mocks.editorAvailable = true; }
  static async getByLabel() { return mocks.editorAvailable ? { destroy: mocks.destroyEditor } : null; }
  async once(name: string, callback: () => void) { if (name === "tauri://created") callback(); }
} }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ destroy: mocks.destroy, onCloseRequested: async (handler: typeof mocks.close) => { mocks.close = handler; return () => {}; } }) }));
vi.mock("./storage/repository", async importOriginal => ({ ...await importOriginal<object>(), isDesktopRuntime: () => true, openNativeWorkspace: mocks.open, saveNativeWorkspace: vi.fn().mockResolvedValue(undefined) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("restores app UI once before opening the editor and keeps sidebar settings across workspaces", async () => {
  vi.useFakeTimers();
  let resolve!: (value: unknown) => void;
  let preferencesReady!: (value: { sidebarWidth: number }) => void;
  mocks.invoke.mockImplementation((command: string, args?: { opened?: string; workspaceRoot?: string }) => command === "load_ui_preferences" ? new Promise(resolve => { preferencesReady = resolve; }) : command === "recent_workspaces" ? (args?.opened ? Promise.resolve(["D:/notes"]) : new Promise(r => { resolve = r; })) : Promise.resolve(command === "independent_workspace_root" ? "D:/Library" : command === "workspace_session" ? { openWorkspaceRoots: [], activeWorkspaceRoot: null } : command === "resolve_workspace_root" ? args?.workspaceRoot : undefined));
  mocks.open.mockResolvedValueOnce({ workspaceRoot: "D:/Library", workspace: createWorkspace(), nodePositionsByFlow: {}, viewportByFlow: {} }).mockResolvedValue({ workspaceRoot: "D:/notes", workspace: createWorkspace(), nodePositionsByFlow: {}, viewportByFlow: {} });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<App />); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(mocks.invoke.mock.calls.map(call => call[0])).toEqual(["load_ui_preferences"]);
    expect(mocks.created).not.toHaveBeenCalled();
    await act(async () => { preferencesReady({ sidebarWidth: 360 }); });
    await act(async () => { resolve(["D:/notes"]); });
    expect(mocks.open).toHaveBeenCalledWith("D:/Library", true);
    await act(async () => { host.querySelector<HTMLButtonElement>(".workspace-add-button")!.click(); });
    await act(async () => { (Array.from(host.querySelectorAll("button")).find(b => b.textContent === "D:/notes")!).click(); });
    expect(mocks.open).toHaveBeenCalledWith("D:/notes", false);
    expect((host.querySelector(".app-shell") as HTMLElement).style.getPropertyValue("--sidebar-width")).toBe("360px");
    await act(async () => { host.querySelector("[role=separator]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    await act(async () => { host.querySelector<HTMLButtonElement>(".sidebar-toggle")!.click(); });
    expect(host.querySelector(".app-shell")?.classList.contains("sidebar-collapsed")).toBe(true);
    await act(async () => { host.querySelector<HTMLButtonElement>(".independent-create")!.click(); });
    expect((host.querySelector(".app-shell") as HTMLElement).style.getPropertyValue("--sidebar-width")).toBe("376px");
    expect(host.querySelector(".app-shell")?.classList.contains("sidebar-collapsed")).toBe(true);
    await act(async () => { host.querySelector<HTMLButtonElement>('.workspace-tab button[title="D:/notes"]')!.click(); });
    expect((host.querySelector(".app-shell") as HTMLElement).style.getPropertyValue("--sidebar-width")).toBe("376px");
    expect(mocks.invoke.mock.calls.filter(call => call[0] === "load_ui_preferences")).toHaveLength(1);
    expect(mocks.invoke.mock.calls.filter(call => call[0] === "restore_editor_preferences")).toEqual([]);
    expect(mocks.invoke.mock.calls.some(call => call[0] === "load_workspace_preferences")).toBe(false);
    await act(async () => { await mocks.close!({ preventDefault: vi.fn() }); });
    expect(mocks.invoke).toHaveBeenCalledWith("save_ui_preferences", { preferences: { sidebarWidth: 376, sidebarCollapsed: true } });
    expect(mocks.destroyEditor).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(mocks.destroyEditor.mock.invocationCallOrder[0]).toBeLessThan(mocks.destroy.mock.invocationCallOrder[0]);
  } finally {
    act(() => root.unmount()); host.remove(); vi.useRealTimers();
  }
});
