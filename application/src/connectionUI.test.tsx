// @vitest-environment jsdom
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const click = (element: Element) => act(() => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const key = (element: EventTarget, value: string, extra = {}) => act(() => { element.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...extra })); });
const button = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent === text)!;
const nodes = () => [...host.querySelectorAll<HTMLElement>("article.flow-node")];
const links = () => host.querySelectorAll(".link-hit");
const preview = () => host.querySelector(".link-preview");
beforeEach(async () => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<App />); });
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})); });
  click(button("블록 추가")); click(button("블록 추가")); click(button("블록 추가"));
});
afterEach(() => { act(()=>root.unmount()); host.remove(); vi.restoreAllMocks(); });
const pointer = (element: Element, type: string, x: number, y: number, button = 2) => act(() => {
  element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button }));
});
describe("summary editing", () => {
  it("enters with Enter, saves multiline text, and leaves editing before clearing selection", () => {
    click(nodes()[0]);
    expect(host.querySelector(".node-summary-input")).toBeNull();
    key(nodes()[0], "Enter");
    const field = host.querySelector<HTMLTextAreaElement>(".node-summary-input")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "핵심 생각\n다음 문장");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    act(() => { field.dispatchEvent(enter); });
    expect(enter.defaultPrevented).toBe(false);
    key(field, "Escape");
    expect(host.querySelector(".node-summary-input")).toBeNull();
    expect(nodes()[0].textContent).toContain("핵심 생각\n다음 문장");
    expect(document.activeElement).toBe(nodes()[0]);
    expect(nodes()[0].classList.contains("is-selected")).toBe(true);
    key(nodes()[0], "Escape");
    expect(nodes()[0].classList.contains("is-selected")).toBe(false);
    expect(document.activeElement).not.toBe(nodes()[0]);
  });
  it("enters on double click and clears editing and focus on canvas whitespace", () => {
    act(() => { nodes()[0].dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    expect(host.querySelector(".node-summary-input")).not.toBeNull();
    const canvas = host.querySelector<HTMLElement>(".graph-canvas")!;
    canvas.setPointerCapture = vi.fn();
    pointer(canvas, "pointerdown", 900, 700, 0);
    expect(host.querySelector(".node-summary-input")).toBeNull();
    expect(host.querySelector(".flow-node.is-selected")).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
  it("starts dragging from the summary text without entering editing", () => {
    const node = nodes()[0];
    node.setPointerCapture = vi.fn();
    node.hasPointerCapture = vi.fn(() => false);
    pointer(node.querySelector(".node-summary-text")!, "pointerdown", 100, 100, 0);
    pointer(node, "pointermove", 140, 120, 0);
    pointer(node, "pointerup", 140, 120, 0);
    expect(node.parentElement!.style.left).toBe("76px");
    expect(node.parentElement!.style.top).toBe("68px");
    expect(host.querySelector(".node-summary-input")).toBeNull();
  });
});
describe("node creation gestures", () => {
  const viewport = () => host.querySelector<HTMLElement>(".flow-canvas-scroll")!;
  beforeEach(() => {
    viewport().setPointerCapture = vi.fn();
    viewport().hasPointerCapture = vi.fn(() => false);
    vi.spyOn(host.querySelector(".graph-canvas")!, "getBoundingClientRect").mockReturnValue({ left: -100, top: -50 } as DOMRect);
  });
  it("shows block actions on the title and deletes the right-clicked block", () => {
    const target = nodes()[0];
    pointer(target.querySelector(".node-summary-text")!, "pointerdown", 300, 200);
    pointer(viewport(), "pointerup", 300, 200);
    const menu = host.querySelector('[role="menu"]')!;
    expect(menu.textContent).not.toContain("새 노드 생성");
    expect(menu.textContent).toContain("연결모드 진입");
    click([...menu.querySelectorAll("button")].find(b => b.textContent?.startsWith("삭제"))!);
    expect(nodes()).toHaveLength(2); expect(target.isConnected).toBe(false);
  });
  it("starts a connection from the right-clicked block instead of the previous selection", () => {
    pointer(nodes()[0], "pointerdown", 300, 200);
    pointer(viewport(), "pointerup", 300, 200);
    click(host.querySelector('[role="menuitem"]')!);
    expect(nodes()[0].classList.contains("connection-first")).toBe(true);
    click(nodes()[1]); click(button("연결 확정"));
    expect(links()).toHaveLength(1);
  });
  it("does not open block actions or change selection after right dragging a block", () => {
    pointer(nodes()[0], "pointerdown", 300, 200);
    pointer(viewport(), "pointermove", 340, 200);
    pointer(viewport(), "pointerup", 300, 200);
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(nodes()[2].classList.contains("is-selected")).toBe(true);
  });
  it("deletes only the right-clicked connection and preserves all blocks", () => {
    click(button("연결 (Ctrl+D)")); click(nodes()[0]); click(button("연결 확정"));
    click(button("연결 (Ctrl+D)")); click(nodes()[1]); click(button("연결 확정"));
    const first = links()[0]; const second = links()[1];
    click(second);
    pointer(first, "pointerdown", 300, 200);
    pointer(viewport(), "pointerup", 300, 200);
    const menu = host.querySelector('[role="menu"]')!;
    expect(menu.textContent).toBe("연결 삭제 Delete");
    click(menu.querySelector("button")!);
    expect(links()).toHaveLength(1); expect(links()[0]).toBe(second);
    expect(nodes()).toHaveLength(3); expect(host.querySelector('[role="menu"]')).toBeNull();
  });
  it("opens the selected connection menu, dismisses it, and suppresses it after dragging", () => {
    click(button("연결 (Ctrl+D)")); click(nodes()[0]); click(button("연결 확정"));
    click(links()[0]);
    pointer(links()[0], "pointerdown", 300, 200);
    pointer(viewport(), "pointerup", 300, 200);
    expect(host.querySelector('[aria-label="연결 작업"]')).not.toBeNull();
    key(window, "Escape");
    pointer(links()[0], "pointerdown", 300, 200);
    pointer(viewport(), "pointermove", 340, 200);
    pointer(viewport(), "pointerup", 300, 200);
    expect(host.querySelector('[role="menu"]')).toBeNull(); expect(links()).toHaveLength(1);
  });
  it("creates at the canvas pointer coordinate with Ctrl+T and ignores repeats and text input", () => {
    pointer(viewport(), "pointermove", 300, 200, 0);
    key(window, "t", { ctrlKey: true });
    expect(nodes()).toHaveLength(4);
    const node = host.querySelectorAll<HTMLElement>(".graph-node-wrap")[3];
    expect(node.style.left).toBe("400px"); expect(node.style.top).toBe("250px");
    key(window, "t", { ctrlKey: true, repeat: true });
    key(host.querySelector("input")!, "t", { ctrlKey: true });
    expect(nodes()).toHaveLength(4);
  });
  it("opens a menu for a slightly shaky click and creates at the original click position", () => {
    pointer(viewport(), "pointerdown", 300, 200);
    pointer(viewport(), "pointermove", 302, 202);
    pointer(viewport(), "pointerup", 302, 202);
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    click(host.querySelector('[role="menuitem"]')!);
    expect(nodes()).toHaveLength(4);
    expect(host.querySelectorAll<HTMLElement>(".graph-node-wrap")[3].style.left).toBe("400px");
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });
  it("never opens a menu after a drag returning to its starting point or a cancellation", () => {
    pointer(viewport(), "pointerdown", 300, 200);
    pointer(viewport(), "pointermove", 340, 200);
    pointer(viewport(), "pointermove", 300, 200);
    pointer(viewport(), "pointerup", 300, 200);
    expect(host.querySelector('[role="menu"]')).toBeNull();
    pointer(viewport(), "pointerdown", 300, 200);
    pointer(viewport(), "pointercancel", 300, 200);
    pointer(viewport(), "pointerup", 300, 200);
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });
  it("dismisses with Escape and blocks creation during connection mode", () => {
    pointer(viewport(), "pointerdown", 300, 200);
    pointer(viewport(), "pointerup", 300, 200);
    key(window, "Escape"); expect(host.querySelector('[role="menu"]')).toBeNull();
    click(button("연결 (Ctrl+D)"));
    pointer(viewport(), "pointermove", 300, 200);
    key(window, "t", { ctrlKey: true });
    pointer(viewport(), "pointerdown", 300, 200);
    pointer(viewport(), "pointerup", 300, 200);
    expect(nodes()).toHaveLength(3); expect(host.querySelector('[role="menu"]')).toBeNull();
  });
});
describe("connection mode UI", () => {
  it("uses existing selection, previews, requires a separate Enter and exits after confirmation", () => {
    expect(links().length).toBe(0);
    key(window,"d",{ctrlKey:true});
    expect(nodes()[2].classList.contains("connection-first")).toBe(true);
    nodes()[0].focus(); key(nodes()[0],"Enter");
    expect(preview()).not.toBeNull(); expect(links().length).toBe(0);
    key(nodes()[0],"Enter",{repeat:true}); expect(links().length).toBe(0);
    key(nodes()[0],"Enter");
    expect(preview()).toBeNull(); expect(links().length).toBe(1);
    expect(nodes()[0].classList.contains("is-selected")).toBe(true);
    expect(button("연결 (Ctrl+D)").disabled).toBe(false);
  });
  it("starts without selection, selects by clicks, allows target replacement and cancels", () => {
    // Switching flows clears selection without deleting the blocks.
    click(host.querySelector(".flow-list-item")!);
    click(button("연결 (Ctrl+D)"));
    click(nodes()[0]); click(nodes()[1]);
    expect(nodes()[1].classList.contains("connection-second")).toBe(true);
    click(nodes()[2]); expect(nodes()[2].classList.contains("connection-second")).toBe(true);
    key(window,"Escape"); expect(preview()).toBeNull(); expect(links().length).toBe(0);
  });
  it("confirms with the button and deletes only the selected link", () => {
    click(button("연결 (Ctrl+D)")); click(nodes()[0]); click(button("연결 확정"));
    expect(links().length).toBe(1); click(links()[0]); click(button("연결 삭제"));
    expect(links().length).toBe(0); expect(nodes().length).toBe(3);
  });
  it("blocks self and reverse duplicate links", () => {
    click(button("연결 (Ctrl+D)")); click(nodes()[2]); expect(button("연결 확정").disabled).toBe(true);
    click(nodes()[0]); click(button("연결 확정"));
    click(button("연결 (Ctrl+D)")); click(nodes()[2]); expect(button("연결 확정").disabled).toBe(true);
    key(window,"Enter"); expect(preview()).not.toBeNull();
    key(window,"Escape"); expect(links().length).toBe(1);
  });
  it("does not intercept text input and resets on flow changes", () => {
    key(nodes()[0], "Enter");
    const input=host.querySelector(".node-summary-input")!;
    key(input,"d",{ctrlKey:true}); expect(button("연결 (Ctrl+D)").disabled).toBe(false);
    click(button("연결 (Ctrl+D)"));click(nodes()[0]);
    click(host.querySelector(".flow-list-item")!);
    expect(preview()).toBeNull();expect(button("연결 (Ctrl+D)").disabled).toBe(false);
  });
  it("deleting one connected block preserves the other blocks", () => {
    click(button("연결 (Ctrl+D)"));click(nodes()[0]);click(button("연결 확정"));
    key(window,"Delete");expect(nodes().length).toBe(2);expect(links().length).toBe(0);
  });
});
