import { test, expect } from "@playwright/test";

test("desktop editor receives a block and accepts real keyboard input", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, { event: string; handler: number }>();
    let id = 0;
    const runtime = window as unknown as Record<string, unknown>;
    runtime.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_event: string, listener: number) => listeners.delete(listener) };
    runtime.__TAURI_INTERNALS__ = {
      transformCallback: (callback: (event: unknown) => void) => { callbacks.set(++id, callback); return id; },
      invoke: async (command: string, args: { event: string; handler: number; payload: unknown }) => {
        if (command === "plugin:event|listen") { listeners.set(++id, args); return id; }
        if (args.event === "editor:ready") {
          for (const listener of listeners.values()) {
            if (listener.event === "editor:load") callbacks.get(listener.handler)?.({ payload: {
              sessionId: "session", workspaceSession: "workspace", blockId: "block", title: "", markdown: "", updatedAt: "",
            } });
          }
        }
      },
    };
  });
  await page.goto("http://localhost:1420/#editor");
  const editor = page.getByRole("textbox", { name: "Scription 문서", exact: true });
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type("## Desktop");
  await expect(editor.locator("h2")).toHaveText("Desktop");
  expect(errors).toEqual([]);
});

test("clicking the document accepts typing and markdown shortcuts", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://localhost:1420/tests/editor.html");
  const editor = page.getByRole("textbox", { name: "Scription 문서", exact: true });
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await editor.click();
  await page.keyboard.type("## Hello");
  await expect(editor.locator("h2")).toHaveText("Hello");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("한글 입력");
  await expect(editor).toContainText("한글 입력");
  await expect(page.getByTestId("saved")).toContainText("## Hello");
  expect(errors).toEqual([]);
});
