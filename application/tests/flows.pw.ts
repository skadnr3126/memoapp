import { expect, test } from "@playwright/test";
import { addWorkspace, dragFlow, installNativeFlowMock, savedSnapshot } from "./nativeFlowMock";

test.beforeEach(async ({ page }) => {
  await installNativeFlowMock(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("http://localhost:1420");
});

test("a standalone flow can be created immediately and restored without selecting a workspace", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "생각을 저장할 폴더를 선택하세요." })).toHaveCount(0);
  await page.getByRole("button", { name: "+ 새 플로우", exact: true }).click();
  const title = page.getByRole("textbox", { name: "Flow 이름", exact: true });
  await expect(title).toHaveValue("새 플로우");
  await title.fill("독립 아이디어");
  const independent = page.getByRole("region", { name: "독립 플로우", exact: true });
  await expect(independent.locator("[data-flow-id]")).toHaveText("독립 아이디어0 nodes");
  await expect.poll(async () => (await savedSnapshot(page, "D:/Library"))?.flowFiles.find(file => file.relativePath.endsWith("/flow.json"))?.content).toContain('"title": "독립 아이디어"');
  await page.reload();
  await expect(title).toHaveValue("독립 아이디어");
  await expect(page.locator(".workspace-tab")).toHaveCount(0);
});

test("independent flows stay above workspaces and every group can be folded", async ({ page }) => {
  await page.getByRole("button", { name: "+ 새 플로우", exact: true }).click();
  await page.getByRole("textbox", { name: "Flow 이름", exact: true }).fill("독립 목록");
  await addWorkspace(page, "D:/A");
  await page.getByRole("button", { name: "A에 새 플로우", exact: true }).click();
  await page.getByRole("textbox", { name: "Flow 이름", exact: true }).fill("작업공간 목록");
  const independent = page.getByRole("region", { name: "독립 플로우", exact: true });
  const workspace = page.getByRole("region", { name: "A", exact: true });
  const independentBounds = await independent.boundingBox(); const workspaceBounds = await workspace.boundingBox();
  if (!independentBounds || !workspaceBounds) throw new Error("플로우 그룹이 보이지 않습니다.");
  expect(independentBounds.y).toBeLessThan(workspaceBounds.y);
  await independent.getByRole("button", { name: /독립 플로우/ }).click();
  await expect(independent.locator("[data-flow-id]")).toHaveCount(0);
  await expect(independent.getByRole("button", { name: /독립 플로우/ })).toHaveAttribute("aria-expanded", "false");
  await independent.getByRole("button", { name: /독립 플로우/ }).click();
  await expect(independent.locator("[data-flow-id]")).toContainText("독립 목록");
  await workspace.locator(".flow-group-toggle").click();
  await expect(workspace.locator("[data-flow-id]")).toHaveCount(0);
  await workspace.locator(".flow-group-toggle").click();
  await expect(workspace.locator("[data-flow-id]")).toContainText("작업공간 목록");
  await page.locator(".workspace-groups-toggle").click();
  await expect(workspace).toHaveCount(0);
  await expect(independent).toBeVisible();
  await page.locator(".workspace-groups-toggle").click();
  await expect(workspace.locator("[data-flow-id]")).toContainText("작업공간 목록");
});

test("pointer moves require confirmation, save pending editing, block the canvas and preserve data in both directions", async ({ page }) => {
  await addWorkspace(page, "D:/A");
  await page.getByRole("button", { name: "+ 새 플로우", exact: true }).click();
  await page.getByRole("textbox", { name: "Flow 이름", exact: true }).fill("옮길 아이디어");
  await page.keyboard.press("Tab");
  await page.locator(".flow-canvas-scroll").hover({ position: { x: 250, y: 180 } });
  await page.keyboard.press("Control+t");
  const node = page.locator(".flow-node");
  await expect(node).toHaveCount(1);
  await node.dblclick();
  await page.getByRole("textbox", { name: "블록 요약 편집" }).fill("보존할 블록");
  await page.keyboard.press("Escape");
  const before = await node.boundingBox();
  const independent = page.getByRole("region", { name: "독립 플로우", exact: true });
  const workspace = page.getByRole("region", { name: "A", exact: true });
  const flowId = await independent.locator("[data-flow-id]").getAttribute("data-flow-id");
  if (!flowId) throw new Error("플로우 ID가 없습니다.");

  const cancelled = page.waitForEvent("dialog");
  const cancelledDrag = dragFlow(page, independent.locator("[data-flow-id]"), workspace);
  const cancelDialog = await cancelled;
  expect(cancelDialog.type()).toBe("confirm");
  expect(cancelDialog.message()).toContain('"옮길 아이디어" 플로우를 "A"로 정말 옮기겠습니까?');
  await cancelDialog.dismiss(); await cancelledDrag;
  await expect(independent.locator("[data-flow-id]")).toHaveCount(1);
  await expect(workspace.locator("[data-flow-id]")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("test-command-log"))).not.toContain("move_flow");

  await page.evaluate(() => {
    localStorage.setItem("test-move-delay", "1200");
    localStorage.setItem("test-pending-editor-markdown", "# 이동 직전의 편집 내용\n반드시 보존");
    localStorage.setItem("test-command-log", "[]");
  });
  page.once("dialog", dialog => dialog.accept());
  await dragFlow(page, independent.locator("[data-flow-id]"), workspace);
  await expect(page.locator(".flow-transfer-overlay")).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveAttribute("inert", "");
  await expect(page.locator(".app-shell")).toHaveAttribute("aria-busy", "true");
  await page.screenshot({ path: "test-results/flow-move-progress.png" });
  await expect(page.locator(".flow-transfer-overlay")).toBeHidden();
  await expect(independent.locator("[data-flow-id]")).toHaveCount(0);
  await expect(workspace.locator("[data-flow-id]")).toHaveAttribute("data-flow-id", flowId);
  await expect(page.getByRole("textbox", { name: "Flow 이름", exact: true })).toHaveValue("옮길 아이디어");
  await expect(node.locator(".node-summary-text")).toHaveText("보존할 블록");
  const inWorkspace = await savedSnapshot(page, "D:/A");
  expect(inWorkspace.blockFiles).toHaveLength(1);
  expect(inWorkspace.blockFiles[0].relativePath).toMatch(new RegExp(`^flows/${flowId}/blocks/`));
  expect(inWorkspace.blockFiles[0].content).toContain("# 이동 직전의 편집 내용\n반드시 보존");
  const commands: string[] = await page.evaluate(() => JSON.parse(localStorage.getItem("test-command-log") ?? "[]"));
  expect(commands.indexOf("editor:flush:suspend")).toBeLessThan(commands.indexOf("save:D:/Library"));
  expect(commands.indexOf("save:D:/Library")).toBeLessThan(commands.indexOf("move_flow"));
  const after = await node.boundingBox();
  expect(after).toEqual(before);

  await page.evaluate(() => localStorage.setItem("test-move-delay", "0"));
  await independent.locator(".flow-group-toggle").click();
  page.once("dialog", async dialog => {
    expect(dialog.message()).toContain('"독립 플로우"로 정말 옮기겠습니까?'); await dialog.accept();
  });
  await dragFlow(page, workspace.locator("[data-flow-id]"), independent);
  await expect(workspace.locator("[data-flow-id]")).toHaveCount(0);
  await expect(page.locator(".flow-transfer-overlay")).toBeHidden();
  await independent.locator(".flow-group-toggle").click();
  await expect(independent.locator("[data-flow-id]")).toHaveAttribute("data-flow-id", flowId);
  const returned = await savedSnapshot(page, "D:/Library");
  expect(returned.blockFiles).toEqual(inWorkspace.blockFiles);
  expect(returned.flowFiles).toEqual(inWorkspace.flowFiles);
  expect((await savedSnapshot(page, "D:/A")).blockFiles).toHaveLength(0);
  await page.reload();
  await expect(independent.locator("[data-flow-id]")).toHaveAttribute("data-flow-id", flowId);
  await expect(node.locator(".node-summary-text")).toHaveText("보존할 블록");
  expect(await node.boundingBox()).toEqual(before);
});

test("a native move failure leaves the source available without duplicating the flow", async ({ page }) => {
  await addWorkspace(page, "D:/A");
  await page.getByRole("button", { name: "A에 새 플로우", exact: true }).click();
  await page.getByRole("textbox", { name: "Flow 이름", exact: true }).fill("실패해도 보존");
  await page.evaluate(() => localStorage.setItem("test-move-fail", "true"));
  page.once("dialog", dialog => dialog.accept());
  const independent = page.getByRole("region", { name: "독립 플로우", exact: true });
  const workspace = page.getByRole("region", { name: "A", exact: true });
  await dragFlow(page, workspace.locator("[data-flow-id]"), independent);
  await expect(page.getByRole("alert")).toContainText("플로우 이동 실패");
  await expect(workspace.locator("[data-flow-id]")).toContainText("실패해도 보존");
  await expect(independent.locator("[data-flow-id]")).toHaveCount(0);
  await expect(page.locator(".app-shell")).not.toHaveAttribute("inert", "");
  await expect(page.getByRole("textbox", { name: "Flow 이름", exact: true })).toHaveValue("실패해도 보존");
  await page.reload();
  await expect(workspace.locator("[data-flow-id]")).toContainText("실패해도 보존");
  await expect(independent.locator("[data-flow-id]")).toHaveCount(0);
});

test("long lists scroll while group toggles and creation remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 760 });
  for (let index = 1; index <= 9; index++) {
    await page.getByRole("button", { name: "+ 새 플로우", exact: true }).click();
    await page.getByRole("textbox", { name: "Flow 이름", exact: true }).fill(`아이디어 ${index}`);
  }
  await addWorkspace(page, "D:/A");
  for (let index = 1; index <= 6; index++) {
    await page.getByRole("button", { name: "A에 새 플로우", exact: true }).click();
    await page.getByRole("textbox", { name: "Flow 이름", exact: true }).fill(`프로젝트 메모 ${index}`);
  }
  expect(await page.locator(".flow-list").evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await expect(page.getByRole("button", { name: "+ 새 플로우", exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: "작업공간 추가하기", exact: true })).toBeInViewport();
  await page.locator(".flow-list").evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: "test-results/new-flow-sidebar-expanded.png" });
  await page.getByRole("region", { name: "독립 플로우", exact: true }).locator(".flow-group-toggle").click();
  await expect(page.getByRole("region", { name: "A", exact: true }).locator("[data-flow-id]")).toHaveCount(6);
  await page.screenshot({ path: "test-results/new-flow-sidebar.png" });
});
