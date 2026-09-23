import { expect, test } from "@playwright/test";

test("cleared text stays empty; all corners resize and moving retains size", async ({ page }) => {
  await page.goto("http://localhost:1420");
  await page.getByRole("button", { name: "만들기", exact: true }).click();
  const title = page.getByRole("textbox", { name: "Flow 이름", exact: true });
  await title.fill("");
  await expect(title).toHaveValue("");
  await title.fill("space works");
  await expect(title).toHaveValue("space works");
  await page.keyboard.press("Tab");
  await page.locator(".flow-canvas-scroll").hover({ position: { x: 400, y: 300 } });
  await page.keyboard.press("Control+t");
  const node = page.locator(".flow-node").first();
  const southeast = page.getByRole("button", { name: "se 모서리 크기 조절" });
  await expect(southeast).toHaveCSS("opacity", "0");
  await node.hover();
  await expect(southeast).toHaveCSS("opacity", "1");
  await node.dblclick();
  await page.getByRole("textbox", { name: "블록 요약 편집" }).fill("");
  await page.keyboard.press("Escape");
  await expect(node.locator(".node-summary-text")).toHaveText("");
  for (const corner of ["se", "ne", "sw", "nw"]) {
    const before = (await node.boundingBox())!;
    const handle = (await page.getByRole("button", { name: `${corner} 모서리 크기 조절` }).boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + (corner.includes("w") ? -20 : 20), handle.y + handle.height / 2 + (corner.includes("n") ? -20 : 20), { steps: 5 });
    await page.mouse.up();
    const after = (await node.boundingBox())!;
    expect(after.width).toBeCloseTo(before.width + 20, 0);
    expect(after.height).toBeCloseTo(before.height + 20, 0);
    expect(corner.includes("w") ? after.x + after.width : after.x).toBeCloseTo(corner.includes("w") ? before.x + before.width : before.x, 0);
    expect(corner.includes("n") ? after.y + after.height : after.y).toBeCloseTo(corner.includes("n") ? before.y + before.height : before.y, 0);
    const focusButton = (await page.locator(".node-editor-focus").first().boundingBox())!;
    expect(after.x + after.width - (focusButton.x + focusButton.width)).toBeCloseTo(16, 0);
    expect(after.y + after.height - (focusButton.y + focusButton.height)).toBeCloseTo(12, 0);
  }
  const before = (await node.boundingBox())!;
  await page.mouse.move(before.x + 40, before.y + 40);
  await page.mouse.down();
  await page.mouse.move(before.x + 140, before.y + 100, { steps: 5 });
  await page.mouse.up();
  const after = (await node.boundingBox())!;
  expect(after.width).toBe(before.width); expect(after.height).toBe(before.height);
  expect(after.x).toBeCloseTo(before.x + 100, 0);
});

test("overflowing block text remains readable and editable with an inner scrollbar", async ({ page }) => {
  await page.goto("http://localhost:1420");
  await page.getByRole("button", { name: "만들기", exact: true }).click();
  await page.locator(".flow-canvas-scroll").hover({ position: { x: 100, y: 100 } });
  await page.keyboard.press("Control+t");
  const node = page.locator(".flow-node").first();
  await node.dblclick();
  const input = page.getByRole("textbox", { name: "블록 요약 편집" });
  await input.fill(Array.from({ length: 14 }, (_, index) => `${index + 1}번째 줄의 긴 블록 내용`).join("\n"));
  await page.keyboard.press("Escape");

  await node.hover();
  const southeast = page.getByRole("button", { name: "se 모서리 크기 조절" });
  const handle = (await southeast.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y - 120, { steps: 5 });
  await page.mouse.up();

  const text = node.locator(".node-summary-text");
  expect(await text.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await text.evaluate(element => { element.scrollTop = element.scrollHeight; });
  expect(await text.evaluate(element => element.scrollTop)).toBeGreaterThan(0);

  await node.dblclick();
  expect(await input.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await input.evaluate(element => { element.scrollTop = element.scrollHeight; });
  expect(await input.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
});
