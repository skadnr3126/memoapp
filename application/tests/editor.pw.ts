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

test("toggles collapse, expand with keyboard, and save edited content as markdown", async ({ page }) => {
  await page.goto("http://localhost:1420/tests/editor.html");
  await page.getByRole("button", { name: "마크다운 원문", exact: true }).click();
  const original = ":::toggle 제목\n\n**중요한 내용**\n\n:::";
  await page.getByRole("textbox", { name: "Scription 마크다운 원문", exact: true }).fill(original);
  await page.getByRole("button", { name: "문서 보기", exact: true }).click();
  const body = page.locator(".scription-toggle-body");
  await expect(body).toBeHidden();
  const expand = page.getByRole("button", { name: "토글 펼치기", exact: true });
  await expand.focus();
  await page.keyboard.press("Enter");
  await expect(body).toBeVisible();
  await expect(body.locator("strong")).toHaveText("중요한 내용");
  await expect(page.getByTestId("saved")).toHaveText(original);
  await body.locator("p").click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(" 수정");
  await expect(page.getByTestId("saved")).toContainText("수정");
  await expect(page.getByTestId("saved")).toContainText(":::toggle 제목");
  await page.getByRole("button", { name: "토글 접기", exact: true }).click();
  await expect(body).toBeHidden();
  await page.getByRole("button", { name: "마크다운 원문", exact: true }).click();
  const saved = await page.getByRole("textbox", { name: "Scription 마크다운 원문", exact: true }).inputValue();
  await page.reload();
  await page.getByRole("button", { name: "마크다운 원문", exact: true }).click();
  await page.getByRole("textbox", { name: "Scription 마크다운 원문", exact: true }).fill(saved);
  await page.getByRole("button", { name: "문서 보기", exact: true }).click();
  await page.getByRole("button", { name: "토글 펼치기", exact: true }).click();
  await expect(page.locator(".scription-toggle-body")).toContainText("수정");
});

test("creates a toggle by typing > and space, then edits its title and body", async ({ page }) => {
  await page.goto("http://localhost:1420/tests/editor.html");
  await page.getByRole("textbox", { name: "Scription 문서", exact: true }).click();
  await page.keyboard.type("> ");
  await page.keyboard.insertText("새 토글");
  await expect(page.locator(".scription-toggle-title")).toHaveText("새 토글");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("토글 안의 본문");
  await expect(page.locator(".scription-toggle-body")).toBeVisible();
  await expect(page.locator(".scription-toggle-body")).toHaveText("토글 안의 본문");
  await expect(page.getByTestId("saved")).toHaveText(":::toggle 새 토글\n\n토글 안의 본문\n\n:::");
});
