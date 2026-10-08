import { expect, it } from "vitest";
import { connectBlocks, createBlock, createFlow, createWorkspace, updateBlock } from "./domain/flow";
import { transferFlow } from "./flowTransfer";

it("moves one complete flow in both directions while preserving identity, content, links, geometry and viewport", () => {
  const first = createFlow(createWorkspace(), "기획");
  const a = createBlock(first.workspace, first.flowId);
  const b = createBlock(a.workspace, first.flowId);
  const workspace = connectBlocks(updateBlock(b.workspace, a.blockId, { title: "첫 블록", markdown: "# 원본", color: "blue" }).workspace, first.flowId, a.blockId, b.blockId).workspace;
  const positions = { [a.blockId]: { x: -40, y: 80, width: 400, height: 230 }, [b.blockId]: { x: 600, y: 90 } };
  const viewport = { zoom: 0.75, scrollLeft: 300, scrollTop: 100 };
  const source = { workspace, nodePositionsByFlow: { [first.flowId]: positions }, viewportByFlow: { [first.flowId]: viewport } };
  const target = { workspace: createWorkspace(), nodePositionsByFlow: {}, viewportByFlow: {} };
  const moved = transferFlow(source, target, first.flowId);
  expect(moved.source.workspace.blocks.size).toBe(0);
  expect(moved.source.workspace.flows.size).toBe(0);
  expect(moved.target.workspace.blocks.get(a.blockId)).toEqual(workspace.blocks.get(a.blockId));
  expect(moved.target.workspace.flows.get(first.flowId)).toEqual(workspace.flows.get(first.flowId));
  expect(moved.target.nodePositionsByFlow[first.flowId]).toEqual(positions);
  expect(moved.target.viewportByFlow[first.flowId]).toEqual(viewport);
  expect(source.workspace.blocks.size).toBe(2);
  const returned = transferFlow(moved.target, moved.source, first.flowId);
  expect(returned.target).toEqual(source);
});

it("rejects flow and block ID collisions without changing either container", () => {
  const first = createFlow(createWorkspace());
  const a = createBlock(first.workspace, first.flowId);
  const source = { workspace: a.workspace, nodePositionsByFlow: {}, viewportByFlow: {} };
  expect(() => transferFlow(source, source, first.flowId)).toThrow("같은 ID");
  const other = createFlow(createWorkspace());
  const target = { workspace: { ...other.workspace, blocks: new Map(a.workspace.blocks), flows: new Map(other.workspace.flows) }, nodePositionsByFlow: {}, viewportByFlow: {} };
  target.workspace.flows.get(other.flowId)!.blockIds.push(a.blockId);
  expect(() => transferFlow(source, target, first.flowId)).toThrow("같은 ID");
  expect(source.workspace.flows.has(first.flowId)).toBe(true);
  expect(target.workspace.flows.has(first.flowId)).toBe(false);
});
