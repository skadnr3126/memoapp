// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { FlowSummary } from "./FlowSummary";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../storage/repository", () => ({ isDesktopRuntime: () => true }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("checks the OpenRouter key before saving and renders its output as text", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const prepared = { workspaceRoot: "D:/notes", input: { id: "f", title: "title", blocks: [], links: [] } };
  let finish!: (value: typeof prepared) => void;
  const prepare = vi.fn(() => new Promise<typeof prepared>(resolve => { finish = resolve; }));
  mocks.invoke.mockReset().mockImplementation((command: string) => command === "load_flow_summary" ? Promise.resolve(null) : command === "has_openrouter_api_key" ? Promise.resolve(true) : Promise.resolve({ path: "D:/notes/.memo/ai/summaries/f_1.md", markdown: "# 요약\n<script>unsafe</script>" }));
  try {
    await act(async () => root.render(<FlowSummary workspaceRoot="D:/notes" flowId="f" prepare={prepare} />));
    await act(async () => { host.querySelector("button")!.click(); });
    expect(mocks.invoke).toHaveBeenCalledWith("load_flow_summary", { workspaceRoot: "D:/notes", flowId: "f" });
    await act(async () => { host.querySelector<HTMLButtonElement>('.flow-summary-key .button-primary')!.click(); });
    expect(mocks.invoke).toHaveBeenCalledWith("has_openrouter_api_key");
    expect(mocks.invoke).not.toHaveBeenCalledWith("summarize_flow", expect.anything());
    expect(host.querySelector("button")!.disabled).toBe(true);
    await act(async () => finish(prepared));
    expect(mocks.invoke).toHaveBeenCalledWith("summarize_flow", prepared);
    expect(host.querySelector("pre")!.textContent).toContain("<script>unsafe</script>");
    expect(host.querySelector("script")).toBeNull();
    await act(async () => root.render(<FlowSummary workspaceRoot="D:/notes" flowId="f" prepare={async () => { throw new Error("save failed"); }} />));
    mocks.invoke.mockClear();
    await act(async () => { host.querySelector("button")!.click(); });
    await act(async () => { host.querySelector<HTMLButtonElement>('.flow-summary-key .button-primary')!.click(); });
    expect(mocks.invoke).not.toHaveBeenCalledWith("summarize_flow", expect.anything());
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("save failed");
    expect(host.querySelector("pre")!.textContent).toContain("# 요약");
    mocks.invoke.mockReset().mockResolvedValue(false);
    await act(async () => { host.querySelector("button")!.click(); });
    await act(async () => { host.querySelector<HTMLButtonElement>('.flow-summary-key .button-primary')!.click(); });
    expect(host.querySelector<HTMLInputElement>('#openrouter-api-key')?.type).toBe("password");
    await act(async () => { host.querySelector<HTMLButtonElement>('.flow-summary-close')!.click(); });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  } finally { act(() => root.unmount()); }
});

it("deletes the saved key from the confirmation window", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  try {
    await act(async () => root.render(<FlowSummary workspaceRoot="D:/notes" flowId="f" prepare={vi.fn()} />));
    await act(async () => { host.querySelector("button")!.click(); });
    await act(async () => { host.querySelectorAll<HTMLButtonElement>('.flow-summary-key .button')[1].click(); });
    expect(mocks.invoke).toHaveBeenCalledWith("delete_openrouter_api_key");
    expect(host.querySelector<HTMLInputElement>('#openrouter-api-key')).not.toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalledWith("summarize_flow", expect.anything());
  } finally { act(() => root.unmount()); }
});

it("keeps an in-flight summary with its flow and reuses the cache", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  let finish!: (value: { path: string; markdown: string }) => void;
  mocks.invoke.mockReset().mockImplementation((command: string) => {
    if (command === "load_flow_summary") return Promise.resolve(null);
    if (command === "has_openrouter_api_key") return Promise.resolve(true);
    return new Promise(resolve => { finish = resolve; });
  });
  const show = (id: string) => <FlowSummary key={id} workspaceRoot="D:/switch" flowId={id}
    prepare={async () => ({ workspaceRoot: "D:/switch", input: { id, title: id, blocks: [], links: [] } })} />;
  try {
    await act(async () => root.render(show("a")));
    await act(async () => host.querySelector("button")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>(".button-primary")!.click());
    await act(async () => root.render(show("b")));
    await act(async () => finish({ path: "a.md", markdown: "Summary A" }));
    expect(host.querySelector("pre")).toBeNull();
    mocks.invoke.mockClear();
    await act(async () => root.render(show("a")));
    expect(host.querySelector("pre")?.textContent).toBe("Summary A");
    expect(host.querySelector("button")?.textContent).toBe("다시 요약");
    expect(mocks.invoke).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); }
});
