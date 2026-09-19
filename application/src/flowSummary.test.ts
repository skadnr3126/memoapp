import { expect, it } from "vitest";
import { createWorkspace, createFlow, createBlock, updateBlock, connectBlocks } from "./domain/flow";
import { flowSummaryInput } from "./flowSummary";

it("extracts only the requested flow, preserving content, order and links", () => {
  const first = createFlow(createWorkspace(), "첫 Flow");
  const a = createBlock(first.workspace, first.flowId);
  const b = createBlock(a.workspace, first.flowId);
  const linked = connectBlocks(b.workspace, first.flowId, a.blockId, b.blockId);
  const edited = updateBlock(linked.workspace, a.blockId, { title: "핵심", markdown: "# 한글\n본문" });
  const other = createFlow(edited.workspace, "다른 Flow");
  const unrelated = createBlock(other.workspace, other.flowId);
  const input = flowSummaryInput(unrelated.workspace, first.flowId);
  expect(input.title).toBe("첫 Flow");
  expect(input.blocks.map(b => b.id)).toEqual([a.blockId, b.blockId]);
  expect(input.blocks[0].markdown).toBe("# 한글\n본문");
  expect(input.links).toMatchObject([{ source: a.blockId, target: b.blockId }]);
  expect(() => flowSummaryInput(unrelated.workspace, "missing")).toThrow();
});
