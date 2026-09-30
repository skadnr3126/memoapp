import { expect, test } from "@playwright/test";

test("pastes at the pointer even when an existing block occupies that position", async ({ page }) => {
  await page.goto("http://localhost:1420");
  await page.getByRole("button", { name: "만들기", exact: true }).click();
  await page.locator(".flow-canvas-scroll").hover({ position: { x: 300, y: 250 } });
  await page.keyboard.press("Control+t");
  const nodes = page.locator(".flow-node");
  await expect(nodes).toHaveCount(1);
  await nodes.first().click();
  const original = (await nodes.first().boundingBox())!;
  await page.keyboard.press("Control+c");
  await page.mouse.move(original.x + original.width / 2, original.y + original.height / 2);
  for (const count of [2, 3]) {
    await page.keyboard.press("Control+v");
    await expect(nodes).toHaveCount(count);
    const pasted = (await nodes.last().boundingBox())!;
    expect(pasted.x).toBeCloseTo(original.x, 0);
    expect(pasted.y).toBeCloseTo(original.y, 0);
    expect(pasted.width).toBeCloseTo(original.width, 0);
    expect(pasted.height).toBeCloseTo(original.height, 0);
  }
});

test("marquee selection copies and cuts multiple blocks with keyboard shortcuts", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("http://localhost:1420");
  await page.getByRole("button", { name: "만들기", exact: true }).click();
  const canvas = page.locator(".flow-canvas-scroll");
  await canvas.hover({ position: { x: 250, y: 200 } });
  await page.keyboard.press("Control+t");
  await canvas.hover({ position: { x: 750, y: 200 } });
  await page.keyboard.press("Control+t");
  const nodes = page.locator(".flow-node");
  await expect(nodes).toHaveCount(2);
  const a = (await nodes.nth(0).boundingBox())!;
  const b = (await nodes.nth(1).boundingBox())!;
  await page.mouse.move(Math.min(a.x, b.x) - 20, Math.min(a.y, b.y) - 20);
  await page.mouse.down();
  await page.mouse.move(Math.max(a.x + a.width, b.x + b.width) + 20, Math.max(a.y + a.height, b.y + b.height) + 20, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".flow-node.is-selected")).toHaveCount(2);
  await page.keyboard.press("Control+c");
  await canvas.hover({ position: { x: 650, y: 600 } });
  await page.keyboard.press("Control+v");
  await expect(nodes).toHaveCount(4);
  await expect(page.locator(".flow-node.is-selected")).toHaveCount(2);
  const pastedA = (await nodes.nth(2).boundingBox())!;
  const pastedB = (await nodes.nth(3).boundingBox())!;
  expect(pastedB.x - pastedA.x).toBeCloseTo(b.x - a.x, 0);
  expect(pastedB.y - pastedA.y).toBeCloseTo(b.y - a.y, 0);
  await page.keyboard.press("Control+x");
  await expect(nodes).toHaveCount(2);
  await page.keyboard.press("Control+z");
  await expect(nodes).toHaveCount(4);
});
