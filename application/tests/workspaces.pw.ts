import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Browser UI coverage with simulated IPC; native window behavior needs desktop QA.
  await page.addInitScript(() => {
    let callbackId = 0;
    const callbacks = new Map<number, (event: unknown) => void>();
    Object.assign(window, {
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        transformCallback(callback: (event: unknown) => void) { callbacks.set(++callbackId, callback); return callbackId; },
        unregisterCallback(id: number) { callbacks.delete(id); },
        async invoke(command: string, args: Record<string, any> = {}) {
          if (command === "recent_workspaces") return ["D:/A", "D:/B"];
          if (command === "workspace_session") {
            if (args.session) localStorage.setItem("test-workspace-session", JSON.stringify(args.session));
            return JSON.parse(localStorage.getItem("test-workspace-session") ?? '{"openWorkspaceRoots":[],"activeWorkspaceRoot":null}');
          }
          if (command === "resolve_workspace_root") {
            if (args.workspaceRoot === "D:/missing") throw new Error("작업공간 폴더가 존재하지 않습니다.");
            return args.workspaceRoot;
          }
          if (command === "plugin:window|get_all_windows") return ["main", "editor"];
          if (command === "plugin:event|listen") return ++callbackId;
          if (command === "plugin:dialog|open") return "D:/B";
          if (command === "load_workspace_preferences") return { sidebarWidth: 292 };
          if (command === "open_workspace") return { workspaceRoot: args.workspaceRoot, blockFiles: [], flowFiles: [] };
        },
      },
    });
  });
  await page.setViewportSize({ width: 1280, height: 850 });
});

test("workspace tabs add, switch, deduplicate and close through the rendered UI", async ({ page }) => {
  await page.goto("http://localhost:1420");
  await page.getByRole("button", { name: "D:/A", exact: true }).click();
  await page.getByRole("textbox", { name: "새 Flow", exact: true }).fill("A flow");
  await page.getByRole("button", { name: "만들기", exact: true }).click();
  await page.getByRole("button", { name: "작업공간 추가하기", exact: true }).click();
  await expect(page.getByRole("region", { name: "작업공간 추가", exact: true })).toBeVisible();
  await page.getByRole("region", { name: "작업공간 추가", exact: true }).getByRole("button", { name: "D:/B", exact: true }).click();
  await expect(page.locator(".workspace-tab")).toHaveCount(2);
  await page.getByRole("textbox", { name: "새 Flow", exact: true }).fill("B flow");
  await page.getByRole("button", { name: "만들기", exact: true }).click();
  await page.locator('.workspace-tab button[title="D:/A"]').click();
  await expect(page.getByRole("textbox", { name: "Flow 이름", exact: true })).toHaveValue("A flow");
  await page.getByRole("button", { name: "작업공간 추가하기", exact: true }).click();
  await page.getByRole("button", { name: "다른 폴더 선택", exact: true }).click();
  await expect(page.locator(".workspace-tab")).toHaveCount(2);
  await expect(page.getByRole("textbox", { name: "Flow 이름", exact: true })).toHaveValue("B flow");
  await expect(page.locator(".workspace-tabs")).toBeVisible();
  expect((await page.locator(".workspace-tabs").boundingBox())!.y).toBe(0);
  await page.screenshot({ path: "test-results/workspace-tabs.png" });
  await page.getByRole("button", { name: "D:/B 작업공간 닫기", exact: true }).click();
  await expect(page.locator(".workspace-tab")).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "Flow 이름", exact: true })).toHaveValue("A flow");
});

test("open tabs and the active workspace survive reloads, including closing the last tab", async ({ page }) => {
  await page.goto("http://localhost:1420");
  await page.getByRole("button", { name: "D:/A", exact: true }).click();
  await page.getByRole("button", { name: "작업공간 추가하기", exact: true }).click();
  await page.getByRole("region", { name: "작업공간 추가" }).getByRole("button", { name: "D:/B", exact: true }).click();
  await page.locator('.workspace-tab button[title="D:/A"]').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("test-workspace-session") ?? "null"))).toEqual({
    openWorkspaceRoots: ["D:/A", "D:/B"], activeWorkspaceRoot: "D:/A",
  });
  await page.reload();
  await expect(page.locator(".workspace-tab button[title]")).toHaveText(["A", "B"]);
  await expect(page.locator('.workspace-tab button[title="D:/A"]')).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "D:/A 작업공간 닫기", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("test-workspace-session") ?? "null"))).toEqual({
    openWorkspaceRoots: ["D:/B"], activeWorkspaceRoot: "D:/B",
  });
  await page.reload();
  await expect(page.locator(".workspace-tab button[title]")).toHaveText(["B"]);
  await page.getByRole("button", { name: "D:/B 작업공간 닫기", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("test-workspace-session") ?? "null"))).toEqual({
    openWorkspaceRoots: [], activeWorkspaceRoot: null,
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "생각을 저장할 폴더를 선택하세요." })).toBeVisible();
  await expect(page.locator(".workspace-tab")).toHaveCount(0);
});

test("an unavailable active workspace does not prevent the other tabs from restoring", async ({ page }) => {
  await page.goto("http://localhost:1420");
  await expect(page.getByRole("heading", { name: "생각을 저장할 폴더를 선택하세요." })).toBeVisible();
  await page.evaluate(() => localStorage.setItem("test-workspace-session", JSON.stringify({
    openWorkspaceRoots: ["D:/A", "D:/missing", "D:/B", "D:/A"], activeWorkspaceRoot: "D:/missing",
  })));
  await page.reload();
  await expect(page.locator(".workspace-tab button[title]")).toHaveText(["A", "B"]);
  await expect(page.locator('.workspace-tab button[title="D:/A"]')).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("alert")).toContainText("D:/missing");
});

test("mouse reordering preserves active workspace and persists across reload", async ({ page }) => {
  await page.goto("http://localhost:1420");
  await page.getByRole("button", { name: "D:/A", exact: true }).click();
  await page.getByRole("textbox", { name: "새 Flow", exact: true }).fill("A flow");
  await page.getByRole("button", { name: "만들기", exact: true }).click();
  await page.getByRole("button", { name: "작업공간 추가하기", exact: true }).click();
  await page.getByRole("region", { name: "작업공간 추가" }).getByRole("button", { name: "D:/B", exact: true }).click();
  const a = page.locator('.workspace-tab button[title="D:/A"]');
  const b = page.locator('.workspace-tab button[title="D:/B"]');
  const drag = async (after: boolean) => {
    const start = (await a.boundingBox())!;
    const end = (await b.locator("..").boundingBox())!;
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(end.x + (after ? end.width - 3 : 3), end.y + end.height / 2, { steps: 10 });
    await page.mouse.up();
  };
  await drag(true);
  await expect(page.locator(".workspace-tab button[title]")).toHaveText(["B", "A"]);
  await expect(b).toHaveAttribute("aria-current", "page");
  await a.click();
  await expect(page.getByRole("textbox", { name: "Flow 이름", exact: true })).toHaveValue("A flow");
  await drag(false);
  await expect(page.locator(".workspace-tab button[title]")).toHaveText(["A", "B"]);
  await drag(true);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("test-workspace-session") ?? "null"))).toEqual({
    openWorkspaceRoots: ["D:/B", "D:/A"], activeWorkspaceRoot: "D:/A",
  });
  await page.reload();
  await expect(page.locator(".workspace-tab button[title]")).toHaveText(["B", "A"]);
  await expect(a).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "D:/B 작업공간 닫기", exact: true }).click();
  await expect(page.locator(".workspace-tab button[title]")).toHaveText(["A"]);
});
