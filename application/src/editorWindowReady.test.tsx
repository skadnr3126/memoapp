// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorWindow } from "./EditorWindow";
import { EDITOR_READY } from "./editorProtocol";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), emit: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ emitTo: mocks.emit, listen: vi.fn(async () => () => {}) }));
vi.mock("./storage/repository", () => ({ isDesktopRuntime: () => true }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  mocks.emit.mockReset().mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("announces readiness only after mounted editor geometry has been restored", async () => {
  let restored: (() => void) | undefined;
  mocks.invoke.mockImplementation(() => new Promise<void>(resolve => { restored = resolve; }));
  await act(async () => { root.render(<EditorWindow />); });
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("restore_editor_preferences");
  expect(mocks.emit).not.toHaveBeenCalled();
  await act(async () => { restored?.(); });
  expect(mocks.emit).toHaveBeenCalledExactlyOnceWith("main", EDITOR_READY);
});

it("shows restore failures and keeps the editor unready", async () => {
  mocks.invoke.mockRejectedValue(new Error("native restore failed"));
  await act(async () => { root.render(<EditorWindow />); });
  expect(host.querySelector('[role="status"]')?.textContent).toBe("편집 창 위치 복원 실패: Error: native restore failed");
  expect(mocks.emit).not.toHaveBeenCalled();
});

it("restores each reopened editor before announcing readiness", async () => {
  await act(async () => { root.render(<EditorWindow />); });
  act(() => root.unmount());
  root = createRoot(host);
  await act(async () => { root.render(<EditorWindow />); });
  expect(mocks.invoke.mock.calls).toEqual([["restore_editor_preferences"], ["restore_editor_preferences"]]);
  expect(mocks.emit.mock.calls).toEqual([["main", EDITOR_READY], ["main", EDITOR_READY]]);
});

it("does not announce readiness after the editor closes during restore", async () => {
  let restored: (() => void) | undefined;
  mocks.invoke.mockImplementation(() => new Promise<void>(resolve => { restored = resolve; }));
  await act(async () => { root.render(<EditorWindow />); });
  act(() => root.unmount());
  root = createRoot(host);
  await act(async () => { restored?.(); });
  expect(mocks.emit).not.toHaveBeenCalled();
});
