import { describe, expect, it } from "vitest";
import {
  createBlockAfter,
  createBranchWithBlock,
  createFlow,
  createWorkspace,
  updateBlock,
  validateWorkspace,
} from "../domain/flow";
import {
  deserializeBlock,
  deserializeFlow,
  deserializeLayout,
  deserializeWorkspaceMetadata,
  emptyLayout,
  restoreWorkspace,
  serializeBlock,
  serializeFlow,
  serializeWorkspaceMetadata,
} from "./serialization";

describe("storage serialization", () => {
  it("round-trips Markdown frontmatter without changing the body", () => {
    const block = {
      id: "blk_a",
      title: "따옴표 \" 제목",
      markdown: "# 본문\n\n- 항목",
      createdAt: "2026-07-21T01:00:00.000Z",
      updatedAt: "2026-07-21T02:00:00.000Z",
    };

    expect(deserializeBlock(serializeBlock(block))).toEqual(block);
  });

  it("round-trips Flow branch order into the runtime Map model", () => {
    let workspace = createWorkspace();
    const createdFlow = createFlow(workspace, "저장 테스트");
    workspace = createdFlow.workspace;
    const first = createBlockAfter(workspace, createdFlow.flowId);
    workspace = updateBlock(first.workspace, first.blockId, { title: "첫 Block", markdown: "본문" }).workspace;
    const second = createBlockAfter(workspace, createdFlow.flowId, first.blockId);
    workspace = second.workspace;
    const child = createBranchWithBlock(workspace, createdFlow.flowId, first.blockId);
    workspace = child.workspace;

    const restored = restoreWorkspace(
      [...workspace.blocks.values()].map((block) => deserializeBlock(serializeBlock(block))),
      [...workspace.flows.values()].map((flow) => deserializeFlow(serializeFlow(flow))),
      deserializeWorkspaceMetadata(serializeWorkspaceMetadata(workspace)),
    );

    expect(validateWorkspace(restored)).toEqual([]);
    const restoredFlow = restored.flows.get(createdFlow.flowId)!;
    const root = restoredFlow.branches.get(restoredFlow.rootBranchId)!;
    expect(root.itemIds).toEqual([first.blockId, second.blockId]);
    expect(root.childBranchIdsByBlockId.get(first.blockId)).toEqual([child.branchId]);
  });

  it("validates layout data", () => {
    const layout = deserializeLayout({ version: 1, nodePositionsByFlow: { flow_a: { blk_a: { x: 12, y: -3 } } } });
    expect(layout.nodePositionsByFlow.flow_a.blk_a).toEqual({ x: 12, y: -3 });
    expect(emptyLayout()).toEqual({ version: 1, nodePositionsByFlow: {} });
    expect(() => deserializeLayout({ version: 99, nodePositionsByFlow: {} })).toThrow("버전");
  });
});
