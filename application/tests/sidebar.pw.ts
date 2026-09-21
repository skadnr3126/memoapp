import { expect, test } from "@playwright/test";

test("collapsing expands the canvas and preserves sidebar input, width and blocks", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("http://localhost:1420");
  const sidebar = page.locator("#flow-sidebar");
  const draft = page.getByRole("textbox", { name: "새 Flow", exact: true });
  await draft.fill("첫 Flow");
  await page.getByRole("button", { name: "만들기", exact: true }).click();
  await draft.fill("작성 중인 이름");
  const resizer = page.getByRole("separator", { name: "사이드바 너비 조절" });
  await resizer.focus();
  await page.keyboard.press("ArrowRight");
  const sidebarWidth = (await sidebar.boundingBox())!.width;
  const canvas = page.locator(".flow-canvas-scroll");
  await canvas.hover({ position: { x: 100, y: 100 } });
  await page.keyboard.press("Control+t");
  await expect(page.locator(".flow-node")).toHaveCount(1);
  const originalWidth = (await canvas.boundingBox())!.width;
  await page.getByRole("button", { name: "사이드바 접기" }).click();
  await expect(sidebar).toBeHidden();
  await expect(resizer).toBeHidden();
  await expect(page.getByRole("button", { name: "사이드바 펼치기" })).toHaveAttribute("aria-expanded", "false");
  expect((await canvas.boundingBox())!.width).toBeGreaterThan(originalWidth + 250);
  await expect(page.getByRole("button", { name: "Codex CLI 열기" })).toBeVisible();
  await expect(page.getByRole("button", { name: "VS Code 열기" })).toBeVisible();
  await page.getByRole("button", { name: "사이드바 펼치기" }).click();
  await expect(draft).toHaveValue("작성 중인 이름");
  expect((await sidebar.boundingBox())!.width).toBe(sidebarWidth);
  await expect(page.locator(".flow-node")).toHaveCount(1);
  await expect(page.locator(".runtime-badge")).toHaveCount(0);
});

test("sidebar can reopen without a flow and on a narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 800 });
  await page.goto("http://localhost:1420");
  await page.getByRole("button", { name: "사이드바 접기" }).click();
  await expect(page.locator("#flow-sidebar")).toBeHidden();
  await page.getByRole("button", { name: "사이드바 펼치기" }).click();
  await expect(page.getByRole("button", { name: "만들기", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "만들기", exact: true }).click();
  await page.getByRole("button", { name: "사이드바 접기" }).click();
  await expect(page.getByRole("textbox", { name: "Flow 이름", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
