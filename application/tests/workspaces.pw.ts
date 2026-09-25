import { expect, test } from "@playwright/test";

test("workspace tabs add, switch, deduplicate and close through the rendered UI", async ({ page }) => {
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
          if (command === "resolve_workspace_root") return args.workspaceRoot;
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
