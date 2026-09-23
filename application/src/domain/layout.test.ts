import { expect, it } from "vitest";
import { resizeNode, linkPath, findFreePosition, type ResizeCorner } from "./layout";
import { createWorkspace, createFlow, createBlock, renameFlow, updateBlock } from "./flow";
import { snapshotFor, decodeWorkspace } from "../storage/repository";
import { deserializeLayout } from "../storage/serialization";

it("resizes all four corners, preserves the opposite corner, and clamps minimum size", () => {
  const rect = { x: 100, y: 100, width: 320, height: 200 };
  for (const corner of ["nw", "ne", "sw", "se"] as ResizeCorner[]) {
    const resized = resizeNode(rect, corner, corner.includes("w") ? -40 : 40, corner.includes("n") ? -30 : 30);
    expect(resized.width).toBe(360); expect(resized.height).toBe(230);
    expect(corner.includes("w") ? resized.x + resized.width : resized.x).toBe(corner.includes("w") ? 420 : 100);
    expect(corner.includes("n") ? resized.y + resized.height : resized.y).toBe(corner.includes("n") ? 300 : 100);
  }
  expect(resizeNode(rect, "nw", 999, 999)).toEqual({ x: 340, y: 228, width: 80, height: 72 });
  expect(linkPath({ x: 0, y: 0, width: 400 }, { x: 600, y: 0, width: 160 }, 200, 200)).toBe("M 400 100 L 600 100");
  expect(findFreePosition([{ x: 0, y: 0, width: 800, height: 400 }], { x: 500, y: 0 }).y).toBeGreaterThan(400);
});

it("round-trips cleared titles, whitespace and resized geometry without reintroducing defaults", () => {
  const flow = createFlow(createWorkspace());
  const block = createBlock(flow.workspace, flow.flowId);
  expect(block.workspace.blocks.get(block.blockId)?.title).toBe("");
  for (const title of ["", " two words "]) {
    const workspace = updateBlock(renameFlow(block.workspace, flow.flowId, title).workspace, block.blockId, { title, markdown: "" }).workspace;
    const geometry = { x: -20, y: 80, width: 540, height: 270 };
    const snapshot = snapshotFor(workspace, { [flow.flowId]: { [block.blockId]: geometry } });
    const loaded = decodeWorkspace({ ...snapshot, workspaceRoot: "D:/test" });
    expect(loaded.workspace.flows.get(flow.flowId)?.title).toBe(title);
    expect(loaded.workspace.blocks.get(block.blockId)?.title).toBe(title);
    expect(loaded.nodePositionsByFlow[flow.flowId][block.blockId]).toEqual(geometry);
  }
  for (const width of [-1, 0, NaN, Infinity, "320"]) {
    expect(() => deserializeLayout({ version: 2, nodePositionsByFlow: { f: { b: { x: 0, y: 0, width } } } })).toThrow();
  }
});
