import { expect, test } from "@playwright/test";
import { addWorkspace, dragFlow, installNativeFlowMock } from "./nativeFlowMock";

test.beforeEach(async ({ page }) => {
  await installNativeFlowMock(page);
  await page.setViewportSize({ width: 1280, height: 850 });
});

test("app UI preferences stay shared through workspace switches, flow moves and reload", async ({ page }) => {
  await page.goto("http://localhost:1420");
  await page.getByRole("button", { name: "+ 새 플로우", exact: true }).click();
  await page.getByRole("textbox", { name: "Flow 이름", exact: true }).fill("독립 메모");
  await addWorkspace(page, "D:/A");
  await page.getByRole("button", { name: "A에 새 플로우", exact: true }).click();
  await addWorkspace(page, "D:/B");
  const separator = page.getByRole("separator", { name: "사이드바 너비 조절" });
  await separator.focus(); await separator.press("ArrowRight"); await separator.press("ArrowRight");
  await expect(page.locator(".app-shell")).toHaveCSS("--sidebar-width", "324px");
  await page.getByRole("button", { name: "사이드바 접기", exact: true }).click();
  await page.locator('.workspace-tab button[title="D:/A"]').click();
  await expect(page.locator(".app-shell")).toHaveClass(/sidebar-collapsed/);
  await expect(page.locator(".app-shell")).toHaveCSS("--sidebar-width", "324px");
  await page.locator('.workspace-tab button[title="D:/B"]').click();
  await expect(page.locator(".app-shell")).toHaveClass(/sidebar-collapsed/);
  await page.getByRole("button", { name: "사이드바 펼치기", exact: true }).click();
  await page.getByRole("region", { name: "독립 플로우", exact: true }).getByRole("button", { name: "독립 메모 0 nodes", exact: true }).click();
  page.once("dialog", dialog => dialog.accept());
  await dragFlow(page, page.locator('[data-flow-target="D:/Library"] .flow-list-item').first(), page.getByRole("region", { name: "A", exact: true }));
  await expect(page.getByRole("region", { name: "A", exact: true }).getByRole("button", { name: "독립 메모 0 nodes", exact: true })).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCSS("--sidebar-width", "324px");
  const restorations = () => page.evaluate(() => JSON.parse(localStorage.getItem("test-command-log") ?? "[]").filter((command: string) => command === "load_ui_preferences" || command === "restore_editor_preferences"));
  expect(await restorations()).toEqual(["load_ui_preferences"]);
  await page.getByRole("button", { name: "사이드바 접기", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("test-ui-preferences") ?? "null"))).toEqual({ sidebarWidth: 324, sidebarCollapsed: true });
  await page.reload();
  await expect(page.locator(".app-shell")).toHaveClass(/sidebar-collapsed/);
  await expect(page.locator(".app-shell")).toHaveCSS("--sidebar-width", "324px");
  expect(await restorations()).toEqual(["load_ui_preferences", "load_ui_preferences"]);
});

test("workspace tabs add, switch, deduplicate and close through the rendered UI", async ({ page }) => {
  await page.goto("http://localhost:1420");
  await addWorkspace(page, "D:/A");
  await page.getByRole("button", { name: "A에 새 플로우", exact: true }).click();
  await page.getByRole("textbox", { name: "Flow 이름", exact: true }).fill("A flow");
  await page.getByRole("button", { name: "작업공간 추가하기", exact: true }).click();
  await expect(page.getByRole("region", { name: "작업공간 추가", exact: true })).toBeVisible();
  await page.getByRole("region", { name: "작업공간 추가", exact: true }).getByRole("button", { name: "D:/B", exact: true }).click();
  await expect(page.locator(".workspace-tab")).toHaveCount(2);
  await page.getByRole("button", { name: "B에 새 플로우", exact: true }).click();
  await page.getByRole("textbox", { name: "Flow 이름", exact: true }).fill("B flow");
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
  await addWorkspace(page, "D:/A");
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
  await expect(page.getByRole("button", { name: "+ 새 플로우", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "독립 플로우", exact: true })).toBeVisible();
  await expect(page.locator(".workspace-tab")).toHaveCount(0);
});

test("an unavailable active workspace does not prevent the other tabs from restoring", async ({ page }) => {
  await page.goto("http://localhost:1420");
  await expect(page.getByRole("button", { name: "+ 새 플로우", exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.setItem("test-workspace-session", JSON.stringify({
    openWorkspaceRoots: ["D:/A", "D:/missing", "D:/B", "D:/A"], activeWorkspaceRoot: "D:/missing",
  })));
  await page.reload();
  await expect(page.locator(".workspace-tab button[title]")).toHaveText(["A", "B"]);
  await expect(page.getByRole("region", { name: "독립 플로우", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("D:/missing");
});

test("mouse reordering preserves active workspace and persists across reload", async ({ page }) => {
  await page.goto("http://localhost:1420");
  await addWorkspace(page, "D:/A");
  await page.getByRole("button", { name: "A에 새 플로우", exact: true }).click();
  await page.getByRole("textbox", { name: "Flow 이름", exact: true }).fill("A flow");
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
