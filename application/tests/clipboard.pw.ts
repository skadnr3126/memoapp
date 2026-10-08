import { expect, test } from "@playwright/test";

test("summary text copies the current selection even while a block remains selected", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    let callbackId = 0;
    Object.assign(window, {
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        transformCallback() { return ++callbackId; },
        unregisterCallback() {},
        async invoke(command: string, args: Record<string, unknown> = {}) {
          if (command === "independent_workspace_root") return "D:/summary-test";
          if (command === "recent_workspaces") return ["D:/summary-test"];
          if (command === "workspace_session") return { openWorkspaceRoots: [], activeWorkspaceRoot: null };
          if (command === "resolve_workspace_root") return args.workspaceRoot;
          if (command === "open_workspace") return { workspaceRoot: args.workspaceRoot, blockFiles: [], flowFiles: [] };
          if (command === "load_ui_preferences") return { sidebarWidth: 292, sidebarCollapsed: false };
          if (command === "load_flow_summary") return { path: "D:/summary-test/.memo/ai/summaries/test.md", markdown: "First summary passage.\nSecond summary passage." };
          if (command === "plugin:window|get_all_windows") return ["main", "editor"];
          if (command === "plugin:event|listen") return ++callbackId;
        },
      },
    });
  });
  await page.goto("http://localhost:1420");
  await page.getByRole("button", { name: "+ 새 플로우", exact: true }).click();
  await page.locator(".flow-canvas-scroll").hover({ position: { x: 300, y: 250 } });
  await page.keyboard.press("Control+t");
  await expect(page.locator(".flow-node.is-selected")).toHaveCount(1);
  await page.getByText("요약 Markdown 보기", { exact: true }).click();
  const summary = page.locator(".flow-summary-result pre");
  await expect(summary).toContainText("Second summary passage.");
  for (const [index, text] of ["First summary passage.", "Second summary passage."].entries()) {
    if (index === 0) await summary.evaluate(element => { element.tabIndex = 0; element.focus(); });
    else await page.locator(".flow-node").focus();
    await summary.evaluate((element, text) => {
      const node = element.firstChild;
      if (!node) throw new Error("Summary text missing");
      const start = (node.textContent ?? "").indexOf(text);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + text.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }, text);
    await page.keyboard.press("Control+c");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(text);
  }
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.locator(".flow-node").focus();
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(page.locator(".flow-node")).toHaveCount(2);
});

test("pastes at the pointer even when an existing block occupies that position", async ({ page }) => {
  await page.goto("http://localhost:1420");
  await page.getByRole("button", { name: "+ 새 플로우", exact: true }).click();
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
  await page.getByRole("button", { name: "+ 새 플로우", exact: true }).click();
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
