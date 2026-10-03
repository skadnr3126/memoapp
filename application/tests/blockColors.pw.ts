import { expect, test } from "@playwright/test";

test("right-click palette changes colors, supports undo, and preserves color when copying blocks", async ({ page }) => {
  await page.goto("http://localhost:1420");
  await page.getByRole("button", { name: "만들기", exact: true }).click();
  await page.locator(".flow-canvas-scroll").hover({ position: { x: 300, y: 250 } });
  await page.keyboard.press("Control+t");
  const nodes = page.locator(".flow-node");
  await expect(nodes).toHaveCount(1);
  const defaultColor = await nodes.first().evaluate(element => getComputedStyle(element).backgroundColor);
  const colors = [
    ["빨강", "rgb(251, 228, 227)"], ["노랑", "rgb(255, 242, 204)"],
    ["초록", "rgb(226, 240, 220)"], ["파랑", "rgb(224, 237, 250)"], ["보라", "rgb(238, 226, 246)"],
  ];
  for (const [name, background] of colors) {
    await nodes.first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "색상 변경", exact: true }).click();
    await page.getByRole("menuitemradio", { name, exact: true }).click();
    await expect(nodes.first()).toHaveCSS("background-color", background);
    await expect(page.getByRole("menu", { name: "블록 작업" })).toHaveCount(0);
    await page.keyboard.press("Control+z");
    await expect(nodes.first()).toHaveCSS("background-color", defaultColor);
  }
  await nodes.first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "색상 변경", exact: true }).click();
  await expect(page.getByRole("menuitemradio", { name: "기본색" })).toHaveAttribute("aria-checked", "true");
  await page.screenshot({ path: "test-results/block-color-palette.png" });
  await page.getByRole("menuitemradio", { name: "파랑", exact: true }).click();
  await nodes.first().click();
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(nodes).toHaveCount(2);
  await expect(nodes.nth(0)).toHaveCSS("background-color", "rgb(224, 237, 250)");
  await expect(nodes.nth(1)).toHaveCSS("background-color", "rgb(224, 237, 250)");
  await nodes.last().click({ button: "right" });
  await page.getByRole("menuitem", { name: "색상 변경", exact: true }).click();
  await expect(page.getByRole("menuitemradio", { name: "파랑", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemradio", { name: "기본색" }).click();
  await expect(nodes.last()).toHaveCSS("background-color", defaultColor);
  await expect(nodes.first()).toHaveCSS("background-color", "rgb(224, 237, 250)");
});
