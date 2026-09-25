// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import App from "./App";
import { createWorkspace } from "./domain/flow";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), close: undefined as undefined | ((event: { preventDefault: () => void }) => Promise<void>), destroy: vi.fn().mockResolvedValue(undefined), destroyEditor: vi.fn().mockResolvedValue(undefined), flushed: undefined as undefined | ((event: { payload: { requestId: string } }) => void) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async (_label: string, name: string, payload: { requestId?: string }) => { if (name === "editor:flush") mocks.flushed?.({ payload: { requestId: payload.requestId! } }); }), listen: vi.fn(async (name: string, handler: typeof mocks.flushed) => { if (name === "editor:flushed") mocks.flushed = handler; return () => {}; }) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ WebviewWindow: { getByLabel: vi.fn(async () => ({ destroy: mocks.destroyEditor })) } }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ destroy: mocks.destroy, onCloseRequested: async (handler: typeof mocks.close) => { mocks.close = handler; return () => {}; } }) }));
vi.mock("./storage/repository", async importOriginal => ({ ...await importOriginal<object>(), isDesktopRuntime: () => true, openNativeWorkspace: mocks.open, saveNativeWorkspace: vi.fn().mockResolvedValue(undefined) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("shows recent folders without opening automatically and restores folder preferences before saving", async () => {
  vi.useFakeTimers();
  let resolve!: (value: unknown) => void;
  mocks.invoke.mockImplementation((command: string, args?: { opened?: string }) => command === "recent_workspaces" ? (args?.opened ? Promise.resolve(["D:/notes"]) : new Promise(r => { resolve = r; })) : Promise.resolve(command === "load_workspace_preferences" ? { sidebarWidth: 360 } : undefined));
  mocks.open.mockResolvedValue({ workspaceRoot: "D:/notes", workspace: createWorkspace(), nodePositionsByFlow: {} });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<App />); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(mocks.invoke.mock.calls.map(call => call[0])).toEqual(["recent_workspaces"]);
    await act(async () => { resolve(["D:/notes"]); });
    expect(mocks.open).not.toHaveBeenCalled();
    await act(async () => { (Array.from(host.querySelectorAll("button")).find(b => b.textContent === "D:/notes")!).click(); });
    expect(mocks.open).toHaveBeenCalledWith("D:/notes");
    expect((host.querySelector(".app-shell") as HTMLElement).style.getPropertyValue("--sidebar-width")).toBe("360px");
    await act(async () => { host.querySelector("[role=separator]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    await act(async () => { await mocks.close!({ preventDefault: vi.fn() }); });
    expect(mocks.invoke).toHaveBeenCalledWith("save_ui_preferences", { preferences: { sidebarWidth: 376, workspaceRoot: "D:/notes" } });
    expect(mocks.destroyEditor).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(mocks.destroyEditor.mock.invocationCallOrder[0]).toBeLessThan(mocks.destroy.mock.invocationCallOrder[0]);
  } finally {
    act(() => root.unmount()); host.remove(); vi.useRealTimers();
  }
});
