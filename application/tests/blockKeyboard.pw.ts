import { expect, test, type Page } from "@playwright/test";
import { installNativeFlowMock, savedSnapshot } from "./nativeFlowMock";

const start = async (page: Page) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("http://localhost:1420");
  await page.getByRole("button", { name: "+ 새 플로우", exact: true }).click();
  await page.locator(".flow-canvas-scroll").hover({ position: { x: 350, y: 230 } });
};
const positions = (page: Page) => page.locator(".graph-node-wrap").evaluateAll(elements => elements.map(element => {
  if (!(element instanceof HTMLElement)) throw new Error("Block element missing");
  return { x: parseFloat(element.style.left), y: parseFloat(element.style.top) };
}));
const pastePair = async (page: Page) => {
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("application/x-flow-memo-block+json", JSON.stringify({ version: 2,
      blocks: [{ id: "first", title: "첫 복사", markdown: "", x: 0, y: 0 }, { id: "second", title: "둘째 복사", markdown: "", x: 420, y: 150 }],
      links: [{ source: "first", target: "second" }],
    }));
    document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  });
};

test("every creation route focuses the new article, so Enter immediately edits its summary", async ({ page }) => {
  await start(page);
  const nodes = page.locator(".flow-node");
  await page.keyboard.press("Control+t");
  await expect(nodes).toHaveCount(1);
  await expect(nodes.first()).toBeFocused();
  await page.keyboard.press("Enter");
  const summary = page.getByRole("textbox", { name: "블록 요약 편집" });
  await expect(summary).toBeFocused();
  await summary.fill("즉시 입력");
  await page.keyboard.press("Control+Shift+t");
  await page.keyboard.press("Control+t");
  await expect(nodes).toHaveCount(1);
  await expect(summary).toBeFocused();
  await page.keyboard.press("Escape");
  await page.locator(".flow-canvas-scroll").click({ button: "right", position: { x: 750, y: 440 } });
  await page.getByRole("menuitem", { name: "새 노드 생성" }).click();
  await expect(nodes).toHaveCount(2);
  await expect(nodes.last()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(nodes.last().locator("textarea")).toBeFocused();
  await summary.fill("우클릭 입력");
  await page.keyboard.press("Escape");
  await nodes.first().click();
  await page.keyboard.press("Control+Shift+t");
  await expect(nodes).toHaveCount(3);
  await expect(nodes.last()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(nodes.last().locator("textarea")).toBeFocused();
  await summary.fill("연결 생성 입력");
  await page.keyboard.press("Escape");
  await expect(nodes.last()).toContainText("연결 생성 입력");
  await page.screenshot({ path: "test-results/block-keyboard.png" });
});

test("connected creation via menu or keyboard creates one link and undo removes both atomically", async ({ page }) => {
  await start(page);
  await page.keyboard.press("Control+t");
  const nodes = page.locator(".flow-node");
  const original = await positions(page);
  for (const route of ["menu", "keyboard"]) {
    if (route === "menu") {
      await nodes.first().click({ button: "right" });
      await page.getByRole("menuitem", { name: "연결된 블록 생성" }).click();
    } else {
      await nodes.first().click();
      await page.mouse.move(1, 1);
      await page.keyboard.press("Control+Shift+t");
    }
    await expect(nodes).toHaveCount(2);
    await expect(page.locator(".link-hit")).toHaveCount(1);
    await expect(page.locator(".flow-node.is-selected")).toHaveCount(1);
    await expect(nodes.last()).toBeFocused();
    const result = await positions(page);
    expect(result[1]).toEqual({ x: original[0].x + 368, y: original[0].y });
    await page.keyboard.press("Control+z");
    await expect(nodes).toHaveCount(1);
    await expect(page.locator(".link-hit")).toHaveCount(0);
    expect(await positions(page)).toEqual(original);
  }
  await nodes.first().click();
  await page.keyboard.press("Control+d");
  await page.keyboard.press("Control+Shift+t");
  await page.keyboard.press("Control+ArrowRight");
  await expect(nodes).toHaveCount(1);
  expect(await positions(page)).toEqual(original);
});

test("multiple pasted blocks retain selection and the first receives focus and immediate Enter editing", async ({ page }) => {
  await start(page);
  await pastePair(page);
  const nodes = page.locator(".flow-node");
  await expect(nodes).toHaveCount(2);
  await expect(page.locator(".flow-node.is-selected")).toHaveCount(2);
  await expect(nodes.first()).toBeFocused();
  await expect(page.locator(".link-hit")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(nodes.first().locator("textarea")).toBeFocused();
  await expect(page.getByRole("textbox", { name: "블록 요약 편집" })).toHaveValue("첫 복사");
  await page.keyboard.press("Escape");
  await page.keyboard.press("ArrowRight");
  await expect(nodes.last()).toBeFocused();
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(nodes).toHaveCount(3);
  await expect(nodes.last()).toBeFocused();
});

test("Ctrl+arrows move marquee selections together at the origin, undo, and preserve navigation and text input", async ({ page }) => {
  await start(page);
  await page.locator(".flow-canvas-scroll").hover({ position: { x: 500, y: 300 } });
  await pastePair(page);
  const nodes = page.locator(".flow-node");
  const first = await nodes.first().boundingBox();
  const last = await nodes.last().boundingBox();
  if (!first || !last) throw new Error("Blocks missing");
  await page.mouse.move(first.x - 12, first.y - 12);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width + 12, last.y + last.height + 12, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator(".flow-node.is-selected")).toHaveCount(2);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  const before = await positions(page);
  await page.keyboard.press("Control+ArrowRight");
  expect(await positions(page)).toEqual(before.map(point => ({ ...point, x: point.x + 10 })));
  await page.keyboard.press("Control+z");
  expect(await positions(page)).toEqual(before);
  // Select again because undo clears interaction state.
  await page.mouse.move(first.x - 12, first.y - 12);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width + 12, last.y + last.height + 12, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator(".flow-node.is-selected")).toHaveCount(2);
  for (let i = 0; i < 50; i++) await page.keyboard.press("Control+ArrowLeft");
  for (let i = 0; i < 40; i++) await page.keyboard.press("Control+ArrowUp");
  expect(await positions(page)).toEqual([{ x: 0, y: 0 }, { x: 420, y: 150 }]);
  await page.keyboard.press("Control+ArrowDown");
  expect(await positions(page)).toEqual([{ x: 0, y: 10 }, { x: 420, y: 160 }]);
  await nodes.first().click();
  await page.keyboard.press("ArrowRight");
  await expect(nodes.last()).toBeFocused();
  await page.keyboard.press("Enter");
  const field = page.getByRole("textbox", { name: "블록 요약 편집" });
  await field.fill("one two three");
  const stationary = await positions(page);
  await page.keyboard.press("Control+ArrowLeft");
  expect(await positions(page)).toEqual(stationary);
  await expect(field).toBeFocused();
  expect(await field.evaluate(element => element instanceof HTMLTextAreaElement ? element.selectionStart : -1)).toBeLessThan(13);
  await page.getByRole("textbox", { name: "Flow 이름", exact: true }).click();
  await page.keyboard.press("Control+ArrowDown");
  expect(await positions(page)).toEqual(stationary);
  const separator = page.getByRole("separator");
  await separator.focus();
  const sidebarWidth = await page.locator(".sidebar").evaluate(element => element.clientWidth);
  await page.keyboard.press("Control+ArrowRight");
  expect(await positions(page)).toEqual(stationary);
  expect(await page.locator(".sidebar").evaluate(element => element.clientWidth)).toBe(sidebarWidth + 16);
});

test("connected blocks and keyboard placement persist, while reload and flow switching do not replay focus", async ({ page }) => {
  await installNativeFlowMock(page);
  await start(page);
  await page.keyboard.press("Control+t");
  await page.keyboard.press("Control+Shift+t");
  await expect(page.locator(".flow-node")).toHaveCount(2);
  await page.keyboard.press("Control+ArrowDown");
  const expected = await positions(page);
  await expect.poll(async () => {
    const snapshot = await savedSnapshot(page, "D:/Library");
    const layoutFile = snapshot?.flowFiles.find(file => file.relativePath.endsWith("/layout.json"));
    return layoutFile?.content;
  }).toContain(`"y": ${expected[1].y}`);
  await page.reload();
  await expect(page.locator(".flow-node")).toHaveCount(2);
  await expect(page.locator(".link-hit")).toHaveCount(1);
  expect(await positions(page)).toEqual(expected);
  expect(await page.locator(".flow-node:focus").count()).toBe(0);
  await page.getByRole("textbox", { name: "Flow 이름", exact: true }).fill("첫 플로우");
  await page.getByRole("button", { name: "+ 새 플로우", exact: true }).click();
  await expect(page.locator(".flow-node")).toHaveCount(0);
  await page.getByRole("region", { name: "독립 플로우", exact: true }).locator("[data-flow-id]").filter({ hasText: "첫 플로우" }).click();
  await expect(page.locator(".flow-node")).toHaveCount(2);
  expect(await page.locator(".flow-node:focus").count()).toBe(0);
});
