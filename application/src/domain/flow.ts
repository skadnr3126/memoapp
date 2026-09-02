export type BlockId = string;
export type BranchId = string;
export type FlowId = string;

export type Block = {
  id: BlockId;
  title?: string;
  markdown: string;
  createdAt: string;
  updatedAt: string;
};

export type Branch = {
  id: BranchId;
  title?: string;
  parentBranchId?: BranchId;
  parentBlockId?: BlockId;
  itemIds: BlockId[];
  childBranchIdsByBlockId: Map<BlockId, BranchId[]>;
};

export type Flow = {
  id: FlowId;
  title: string;
  rootBranchId: BranchId;
  branches: Map<BranchId, Branch>;
};

export type WorkspaceState = {
  blocks: Map<BlockId, Block>;
  flows: Map<FlowId, Flow>;
  activeFlowId?: FlowId;
  selectedBlockId?: BlockId;
};

export type BlockLocation = {
  flowId: FlowId;
  branchId: BranchId;
  index: number;
};

export type CommandResult = {
  workspace: WorkspaceState;
};

export type BlockCommandResult = CommandResult & {
  blockId: BlockId;
};

export type BranchCommandResult = BlockCommandResult & {
  branchId: BranchId;
};

const now = () => new Date().toISOString();

const createId = (prefix: string) => {
  const random = globalThis.crypto?.randomUUID?.().split("-").join("") ?? Math.random().toString(36).slice(2);
  return `${prefix}_${random.slice(0, 12)}`;
};

const cloneBranch = (branch: Branch): Branch => ({
  ...branch,
  itemIds: [...branch.itemIds],
  childBranchIdsByBlockId: new Map(
    [...branch.childBranchIdsByBlockId].map(([blockId, branchIds]) => [
      blockId,
      [...branchIds],
    ]),
  ),
});

const cloneFlow = (flow: Flow): Flow => ({
  ...flow,
  branches: new Map([...flow.branches].map(([id, branch]) => [id, cloneBranch(branch)])),
});

const cloneWorkspace = (workspace: WorkspaceState): WorkspaceState => ({
  ...workspace,
  blocks: new Map([...workspace.blocks].map(([id, block]) => [id, { ...block }])),
  flows: new Map([...workspace.flows].map(([id, flow]) => [id, cloneFlow(flow)])),
});

const getFlow = (workspace: WorkspaceState, flowId: FlowId): Flow => {
  const flow = workspace.flows.get(flowId);
  if (!flow) throw new Error("Flow를 찾을 수 없습니다.");
  return flow;
};

const getBranch = (flow: Flow, branchId: BranchId): Branch => {
  const branch = flow.branches.get(branchId);
  if (!branch) throw new Error("Branch를 찾을 수 없습니다.");
  return branch;
};

export const createWorkspace = (): WorkspaceState => ({
  blocks: new Map(),
  flows: new Map(),
});

export const getDisplayTitle = (block: Block): string => {
  const explicitTitle = block.title?.trim();
  if (explicitTitle) return explicitTitle;

  const firstLine = block.markdown
    .split("\n")
    .map((line) => line.replace(/^#{1,6}\s*/, "").trim())
    .find(Boolean);

  return firstLine || "제목 없음";
};

export const buildLocationIndex = (workspace: WorkspaceState): Map<BlockId, BlockLocation> => {
  const locations = new Map<BlockId, BlockLocation>();

  for (const [flowId, flow] of workspace.flows) {
    for (const [branchId, branch] of flow.branches) {
      branch.itemIds.forEach((blockId, index) => {
        locations.set(blockId, { flowId, branchId, index });
      });
    }
  }

  return locations;
};

export const createFlow = (workspace: WorkspaceState, title = "새 Flow"): CommandResult & { flowId: FlowId } => {
  const next = cloneWorkspace(workspace);
  const flowId = createId("flow");
  const rootBranchId = createId("root");

  next.flows.set(flowId, {
    id: flowId,
    title: title.trim() || "제목 없는 Flow",
    rootBranchId,
    branches: new Map([
      [
        rootBranchId,
        {
          id: rootBranchId,
          itemIds: [],
          childBranchIdsByBlockId: new Map(),
        },
      ],
    ]),
  });
  next.activeFlowId = flowId;

  return { workspace: next, flowId };
};

export const renameFlow = (workspace: WorkspaceState, flowId: FlowId, title: string): CommandResult => {
  const next = cloneWorkspace(workspace);
  getFlow(next, flowId).title = title.trim() || "제목 없는 Flow";
  return { workspace: next };
};

export const renameBranch = (
  workspace: WorkspaceState,
  flowId: FlowId,
  branchId: BranchId,
  title: string,
): CommandResult => {
  const next = cloneWorkspace(workspace);
  getBranch(getFlow(next, flowId), branchId).title = title.trim() || undefined;
  return { workspace: next };
};

export const updateBlock = (
  workspace: WorkspaceState,
  blockId: BlockId,
  changes: Pick<Block, "title" | "markdown">,
): CommandResult => {
  const next = cloneWorkspace(workspace);
  const block = next.blocks.get(blockId);
  if (!block) throw new Error("Block을 찾을 수 없습니다.");

  block.title = changes.title?.trim() || undefined;
  block.markdown = changes.markdown;
  block.updatedAt = now();

  return { workspace: next };
};

export const createBlockAfter = (
  workspace: WorkspaceState,
  flowId: FlowId,
  afterBlockId?: BlockId,
): BlockCommandResult => {
  const next = cloneWorkspace(workspace);
  const flow = getFlow(next, flowId);
  const locations = buildLocationIndex(next);
  const location = afterBlockId ? locations.get(afterBlockId) : undefined;

  if (location && location.flowId !== flowId) {
    throw new Error("다른 Flow의 Block 뒤에는 추가할 수 없습니다.");
  }

  const targetBranch = getBranch(flow, location?.branchId ?? flow.rootBranchId);
  const blockId = createId("blk");
  const timestamp = now();
  const insertAt = location ? location.index + 1 : targetBranch.itemIds.length;

  targetBranch.itemIds.splice(insertAt, 0, blockId);
  next.blocks.set(blockId, {
    id: blockId,
    markdown: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  next.selectedBlockId = blockId;

  return { workspace: next, blockId };
};

export const createBranchWithBlock = (
  workspace: WorkspaceState,
  flowId: FlowId,
  parentBlockId: BlockId,
): BranchCommandResult => {
  const next = cloneWorkspace(workspace);
  const flow = getFlow(next, flowId);
  const location = buildLocationIndex(next).get(parentBlockId);

  if (!location || location.flowId !== flowId) {
    throw new Error("현재 Flow에 없는 Block입니다.");
  }

  const parentBranch = getBranch(flow, location.branchId);
  const branchId = createId("branch");
  const blockId = createId("blk");
  const timestamp = now();

  flow.branches.set(branchId, {
    id: branchId,
    parentBranchId: parentBranch.id,
    parentBlockId,
    itemIds: [blockId],
    childBranchIdsByBlockId: new Map(),
  });
  parentBranch.childBranchIdsByBlockId.set(parentBlockId, [
    ...(parentBranch.childBranchIdsByBlockId.get(parentBlockId) ?? []),
    branchId,
  ]);
  next.blocks.set(blockId, {
    id: blockId,
    markdown: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  next.selectedBlockId = blockId;

  return { workspace: next, branchId, blockId };
};

const descendantBranchIds = (flow: Flow, branchId: BranchId): Set<BranchId> => {
  const result = new Set<BranchId>();
  const visit = (currentBranchId: BranchId) => {
    if (result.has(currentBranchId)) return;
    result.add(currentBranchId);
    const branch = getBranch(flow, currentBranchId);
    for (const childBranchIds of branch.childBranchIdsByBlockId.values()) {
      childBranchIds.forEach(visit);
    }
  };
  visit(branchId);
  return result;
};

const blockChildBranchIds = (flow: Flow, blockId: BlockId): Set<BranchId> => {
  const location = [...flow.branches.values()].find((branch) => branch.itemIds.includes(blockId));
  if (!location) return new Set();

  const result = new Set<BranchId>();
  for (const branchId of location.childBranchIdsByBlockId.get(blockId) ?? []) {
    descendantBranchIds(flow, branchId).forEach((id) => result.add(id));
  }
  return result;
};

export const moveBlock = (
  workspace: WorkspaceState,
  flowId: FlowId,
  blockId: BlockId,
  targetBranchId: BranchId,
  targetIndex: number,
): CommandResult => {
  const next = cloneWorkspace(workspace);
  const flow = getFlow(next, flowId);
  const location = buildLocationIndex(next).get(blockId);

  if (!location || location.flowId !== flowId) throw new Error("현재 Flow에 없는 Block입니다.");
  if (blockChildBranchIds(flow, blockId).has(targetBranchId)) {
    throw new Error("자신의 하위 Branch로 Block을 옮길 수 없습니다.");
  }

  const sourceBranch = getBranch(flow, location.branchId);
  const targetBranch = getBranch(flow, targetBranchId);
  sourceBranch.itemIds.splice(location.index, 1);

  const adjustedIndex =
    sourceBranch.id === targetBranch.id && location.index < targetIndex
      ? targetIndex - 1
      : targetIndex;
  const insertionIndex = Math.max(0, Math.min(adjustedIndex, targetBranch.itemIds.length));
  targetBranch.itemIds.splice(insertionIndex, 0, blockId);
  next.selectedBlockId = blockId;

  return { workspace: next };
};

export const moveBlockByOffset = (
  workspace: WorkspaceState,
  flowId: FlowId,
  blockId: BlockId,
  offset: -1 | 1,
): CommandResult => {
  const location = buildLocationIndex(workspace).get(blockId);
  if (!location || location.flowId !== flowId) throw new Error("현재 Flow에 없는 Block입니다.");

  const flow = getFlow(workspace, flowId);
  const branch = getBranch(flow, location.branchId);
  const targetIndex = location.index + offset;
  if (targetIndex < 0 || targetIndex >= branch.itemIds.length) return { workspace };

  return moveBlock(workspace, flowId, blockId, location.branchId, targetIndex + (offset > 0 ? 1 : 0));
};

export const moveBranch = (
  workspace: WorkspaceState,
  flowId: FlowId,
  branchId: BranchId,
  newParentBlockId: BlockId,
): CommandResult => {
  const next = cloneWorkspace(workspace);
  const flow = getFlow(next, flowId);
  const branch = getBranch(flow, branchId);
  if (!branch.parentBranchId || !branch.parentBlockId) throw new Error("root Branch는 이동할 수 없습니다.");

  const targetLocation = buildLocationIndex(next).get(newParentBlockId);
  if (!targetLocation || targetLocation.flowId !== flowId) {
    throw new Error("현재 Flow에 없는 대상 Block입니다.");
  }

  const ownBranchIds = descendantBranchIds(flow, branchId);
  if (ownBranchIds.has(targetLocation.branchId)) {
    throw new Error("자신의 하위 Branch 아래로 이동할 수 없습니다.");
  }

  const oldParentBranch = getBranch(flow, branch.parentBranchId);
  const oldSiblings = oldParentBranch.childBranchIdsByBlockId.get(branch.parentBlockId) ?? [];
  oldParentBranch.childBranchIdsByBlockId.set(
    branch.parentBlockId,
    oldSiblings.filter((id) => id !== branchId),
  );

  const newParentBranch = getBranch(flow, targetLocation.branchId);
  newParentBranch.childBranchIdsByBlockId.set(newParentBlockId, [
    ...(newParentBranch.childBranchIdsByBlockId.get(newParentBlockId) ?? []),
    branchId,
  ]);
  branch.parentBranchId = newParentBranch.id;
  branch.parentBlockId = newParentBlockId;

  return { workspace: next };
};

const collectBranchContents = (
  flow: Flow,
  branchId: BranchId,
  blockIds: Set<BlockId>,
  branchIds: Set<BranchId>,
) => {
  if (branchIds.has(branchId)) return;
  branchIds.add(branchId);
  const branch = getBranch(flow, branchId);
  branch.itemIds.forEach((blockId) => {
    blockIds.add(blockId);
    (branch.childBranchIdsByBlockId.get(blockId) ?? []).forEach((childBranchId) =>
      collectBranchContents(flow, childBranchId, blockIds, branchIds),
    );
  });
};

export const deleteBlockSubtree = (
  workspace: WorkspaceState,
  flowId: FlowId,
  blockId: BlockId,
): CommandResult => {
  const next = cloneWorkspace(workspace);
  const flow = getFlow(next, flowId);
  const location = buildLocationIndex(next).get(blockId);
  if (!location || location.flowId !== flowId) throw new Error("현재 Flow에 없는 Block입니다.");

  const branch = getBranch(flow, location.branchId);
  const deletedBlockIds = new Set<BlockId>();
  const deletedBranchIds = new Set<BranchId>();
  const removedItemIds = branch.itemIds.slice(location.index);

  removedItemIds.forEach((removedBlockId) => {
    deletedBlockIds.add(removedBlockId);
    (branch.childBranchIdsByBlockId.get(removedBlockId) ?? []).forEach((childBranchId) =>
      collectBranchContents(flow, childBranchId, deletedBlockIds, deletedBranchIds),
    );
  });

  branch.itemIds = branch.itemIds.slice(0, location.index);
  removedItemIds.forEach((removedBlockId) => branch.childBranchIdsByBlockId.delete(removedBlockId));
  deletedBlockIds.forEach((id) => next.blocks.delete(id));
  deletedBranchIds.forEach((id) => flow.branches.delete(id));

  if (branch.id !== flow.rootBranchId && branch.itemIds.length === 0) {
    const parentBranch = getBranch(flow, branch.parentBranchId as BranchId);
    const siblings = parentBranch.childBranchIdsByBlockId.get(branch.parentBlockId as BlockId) ?? [];
    parentBranch.childBranchIdsByBlockId.set(
      branch.parentBlockId as BlockId,
      siblings.filter((id) => id !== branch.id),
    );
    flow.branches.delete(branch.id);
  }

  next.selectedBlockId = undefined;
  return { workspace: next };
};

export const validateWorkspace = (workspace: WorkspaceState): string[] => {
  const errors: string[] = [];
  const seenBlockIds = new Set<BlockId>();

  for (const [flowId, flow] of workspace.flows) {
    if (!flow.branches.has(flow.rootBranchId)) {
      errors.push(`Flow ${flowId}에 root Branch가 없습니다.`);
      continue;
    }

    const reachableBranches = descendantBranchIds(flow, flow.rootBranchId);
    if (reachableBranches.size !== flow.branches.size) {
      errors.push(`Flow ${flow.title}에 연결되지 않은 Branch가 있습니다.`);
    }

    for (const [branchId, branch] of flow.branches) {
      if (branchId !== flow.rootBranchId) {
        if (!branch.parentBranchId || !branch.parentBlockId) {
          errors.push(`Branch ${branchId}에 부모 정보가 없습니다.`);
        } else {
          const parent = flow.branches.get(branch.parentBranchId);
          if (!parent?.itemIds.includes(branch.parentBlockId)) {
            errors.push(`Branch ${branchId}의 부모 Block이 올바르지 않습니다.`);
          }
        }
      }

      branch.itemIds.forEach((blockId) => {
        if (!workspace.blocks.has(blockId)) errors.push(`Block ${blockId}의 데이터가 없습니다.`);
        if (seenBlockIds.has(blockId)) errors.push(`Block ${blockId}가 두 번 배치되었습니다.`);
        seenBlockIds.add(blockId);
      });

      for (const [parentBlockId, childBranchIds] of branch.childBranchIdsByBlockId) {
        if (!branch.itemIds.includes(parentBlockId)) {
          errors.push(`Branch ${branchId}가 없는 부모 Block ${parentBlockId}을 참조합니다.`);
        }
        childBranchIds.forEach((childBranchId) => {
          const child = flow.branches.get(childBranchId);
          if (!child) {
            errors.push(`Branch ${branchId}가 없는 하위 Branch를 참조합니다.`);
          } else if (child.parentBranchId !== branchId || child.parentBlockId !== parentBlockId) {
            errors.push(`Branch ${childBranchId}의 부모 정보가 일치하지 않습니다.`);
          }
        });
      }
    }
  }

  workspace.blocks.forEach((_, blockId) => {
    if (!seenBlockIds.has(blockId)) errors.push(`Block ${blockId}가 Flow tree에 없습니다.`);
  });

  return errors;
};
