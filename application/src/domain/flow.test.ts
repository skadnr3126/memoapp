import { describe, expect, it } from "vitest";
import {
  createBlockAfter,
  createBranchWithBlock,
  createFlow,
  createWorkspace,
  deleteBlockSubtree,
  getDisplayTitle,
  moveBlock,
  moveBranch,
  updateBlock,
  validateWorkspace,
} from "./flow";

describe("Flow domain commands", () => {
  it("creates, moves, branches, and removes a Block subtree without breaking the tree", () => {
    let workspace = createWorkspace();
    const createdFlow = createFlow(workspace, "구조 검증");
    workspace = createdFlow.workspace;
    const { flowId } = createdFlow;

    const first = createBlockAfter(workspace, flowId);
    workspace = first.workspace;
    const second = createBlockAfter(workspace, flowId, first.blockId);
    workspace = second.workspace;
    const third = createBlockAfter(workspace, flowId, second.blockId);
    workspace = third.workspace;

    const firstBranch = createBranchWithBlock(workspace, flowId, second.blockId);
    workspace = firstBranch.workspace;
    const branchSecondBlock = createBlockAfter(workspace, flowId, firstBranch.blockId);
    workspace = branchSecondBlock.workspace;
    const nestedBranch = createBranchWithBlock(workspace, flowId, firstBranch.blockId);
    workspace = nestedBranch.workspace;
    const siblingBranch = createBranchWithBlock(workspace, flowId, second.blockId);
    workspace = siblingBranch.workspace;

    workspace = moveBlock(workspace, flowId, third.blockId, workspace.flows.get(flowId)!.rootBranchId, 1).workspace;
    workspace = moveBranch(workspace, flowId, firstBranch.branchId, third.blockId).workspace;

    expect(validateWorkspace(workspace)).toEqual([]);

    workspace = deleteBlockSubtree(workspace, flowId, firstBranch.blockId).workspace;

    expect(workspace.blocks.has(firstBranch.blockId)).toBe(false);
    expect(workspace.blocks.has(branchSecondBlock.blockId)).toBe(false);
    expect(workspace.blocks.has(nestedBranch.blockId)).toBe(false);
    expect(workspace.blocks.has(siblingBranch.blockId)).toBe(true);

    const secondFlow = createFlow(workspace, "독립 Flow");
    workspace = secondFlow.workspace;
    workspace = createBlockAfter(workspace, secondFlow.flowId).workspace;

    expect(validateWorkspace(workspace)).toEqual([]);
  });

  it("rejects moving a Block into one of its own child branches", () => {
    let workspace = createWorkspace();
    const createdFlow = createFlow(workspace, "순환 방지");
    workspace = createdFlow.workspace;

    const parent = createBlockAfter(workspace, createdFlow.flowId);
    workspace = parent.workspace;
    const childBranch = createBranchWithBlock(workspace, createdFlow.flowId, parent.blockId);
    workspace = childBranch.workspace;

    expect(() =>
      moveBlock(workspace, createdFlow.flowId, parent.blockId, childBranch.branchId, 0),
    ).toThrow("하위 Branch");
  });

  it("keeps an explicit title separate from Markdown and derives a title when absent", () => {
    let workspace = createWorkspace();
    const createdFlow = createFlow(workspace, "제목 정책");
    workspace = createdFlow.workspace;
    const createdBlock = createBlockAfter(workspace, createdFlow.flowId);
    workspace = createdBlock.workspace;

    workspace = updateBlock(workspace, createdBlock.blockId, {
      title: "명시적 제목",
      markdown: "본문의 첫 줄\n두 번째 줄",
    }).workspace;
    expect(getDisplayTitle(workspace.blocks.get(createdBlock.blockId)!)).toBe("명시적 제목");

    workspace = updateBlock(workspace, createdBlock.blockId, {
      title: "",
      markdown: "# Markdown 제목\n본문",
    }).workspace;
    expect(getDisplayTitle(workspace.blocks.get(createdBlock.blockId)!)).toBe("Markdown 제목");
  });

  it("rejects moving a Branch under a Block within its own subtree", () => {
    let workspace = createWorkspace();
    const createdFlow = createFlow(workspace, "Branch 순환 방지");
    workspace = createdFlow.workspace;
    const parent = createBlockAfter(workspace, createdFlow.flowId);
    workspace = parent.workspace;
    const branch = createBranchWithBlock(workspace, createdFlow.flowId, parent.blockId);
    workspace = branch.workspace;

    expect(() => moveBranch(workspace, createdFlow.flowId, branch.branchId, branch.blockId)).toThrow(
      "하위 Branch",
    );
  });
});
