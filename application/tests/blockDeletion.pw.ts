import { expect, test, type Page } from "@playwright/test";
import { installNativeFlowMock, savedSnapshot } from "./nativeFlowMock";

const start = async (page: Page) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("http://localhost:1420");
  await page.getByRole("button", { name: "+ 새 플로우", exact: true }).click();
  await page.locator(".flow-canvas-scroll").hover({ position: { x: 200, y: 230 } });
  for (const name of ["A", "B", "C"]) {
    await page.keyboard.press(name === "A" ? "Control+t" : "Control+Shift+t");
    await page.keyboard.press("Enter");
    await page.getByRole("textbox", { name: "블록 요약 편집" }).fill(name);
    await page.keyboard.press("Escape");
  }
};
const node = (page: Page, name: string) => page.getByRole("button", { name: `${name} 편집`, exact: true });
const focusedSelection = async (page: Page, name: string) => {
  await expect(node(page, name)).toBeFocused();
  await expect(page.locator(".flow-node.is-selected")).toHaveCount(1);
  await expect(node(page, name)).toHaveClass(/is-selected/);
};

test("deletion walks actual focus history and the empty canvas can create again", async ({ page }) => {
  await start(page);
  await node(page, "B").click();
  await node(page, "A").click();
  await page.keyboard.press("ArrowRight");
  await focusedSelection(page, "B");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Delete");
  await focusedSelection(page, "B");
  await page.keyboard.press("Delete");
  await focusedSelection(page, "A");
  await page.keyboard.press("Delete");
  await expect(page.locator(".flow-node")).toHaveCount(0);
  await expect(page.locator(".graph-canvas")).toBeFocused();
  await page.keyboard.press("Control+t");
  await expect(page.locator(".flow-node")).toHaveCount(1);
  await expect(page.locator(".flow-node")).toBeFocused();
});

test("Tab and programmatic focus are recorded; deleting another block returns to the survivor", async ({ page }) => {
  await start(page);
  await node(page, "B").focus();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator('[data-block-id]').filter({ has: node(page, "A") }).locator(".node-resize-se")).toBeFocused();
  await node(page, "C").focus();
  await page.keyboard.press("Delete");
  await focusedSelection(page, "A");
  await node(page, "B").click({ button: "right" });
  await page.getByRole("menuitem", { name: "삭제", exact: false }).click();
  await focusedSelection(page, "A");
  await expect(page.locator(".flow-node")).toHaveCount(1);
});

test("reload clears history so deletion chooses the nearest surviving block", async ({ page }) => {
  await installNativeFlowMock(page);
  await start(page);
  await expect.poll(async () => JSON.stringify(await savedSnapshot(page, "D:/Library"))).toContain('C');
  await page.reload();
  await expect(page.locator(".flow-node")).toHaveCount(3);
  await node(page, "C").click({ button: "right" });
  await page.getByRole("menuitem", { name: "삭제", exact: false }).click();
  await focusedSelection(page, "B");
});

test("cutting multiple selected blocks restores the surviving focus history", async ({ page }) => {
  await start(page);
  await node(page, "A").click();
  await node(page, "B").click();
  const b = await node(page, "B").boundingBox();
  const c = await node(page, "C").boundingBox();
  if (!b || !c) throw new Error("Blocks missing");
  await page.mouse.move(b.x - 8, b.y - 8);
  await page.mouse.down();
  await page.mouse.move(c.x + c.width + 8, c.y + c.height + 8, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator(".flow-node.is-selected")).toHaveCount(2);
  await page.keyboard.press("Control+x");
  await focusedSelection(page, "A");
  await expect(page.locator(".flow-node")).toHaveCount(1);
});
